/**
 * Leverage Loop Example — 3x Long ETH on Aave via Smart Batching
 *
 * This shows the complete developer experience:
 * one file, no Solidity, no custom contracts (except the thin AaveLens).
 */
import { parseEther, parseUnits, type Address } from 'viem'
import { composableBatch, balance, staticRead } from '@erc-xxxx/sdk'
import { composableActions } from '@erc-xxxx/sdk/viem'

// ── Addresses (Base mainnet) ───────────────────────────────
const WETH = '0x4200000000000000000000000000000000000006' as Address
const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' as Address
const AAVE_POOL = '0xA238Dd80C259a72e81d7e4664a9801593F98d1c5' as Address
const SWAP_ROUTER = '0x2626664c2603336E57B271c5C0b26F421741e481' as Address
const AAVE_LENS = '0x...' as Address // Deployed AaveLens

// ── ABIs (minimal, only functions we call) ─────────────────
const aavePoolAbi = [
  {
    name: 'supply',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'asset', type: 'address' },
      { name: 'amount', type: 'uint256' },
      { name: 'onBehalfOf', type: 'address' },
      { name: 'referralCode', type: 'uint16' },
    ],
    outputs: [],
  },
  {
    name: 'borrow',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'asset', type: 'address' },
      { name: 'amount', type: 'uint256' },
      { name: 'interestRateMode', type: 'uint256' },
      { name: 'referralCode', type: 'uint16' },
      { name: 'onBehalfOf', type: 'address' },
    ],
    outputs: [],
  },
] as const

const aaveLensAbi = [
  {
    name: 'getSafeBorrowAmount',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'pool', type: 'address' },
      { name: 'user', type: 'address' },
      { name: 'assetDecimals', type: 'uint8' },
      { name: 'numerator', type: 'uint256' },
      { name: 'denominator', type: 'uint256' },
    ],
    outputs: [{ type: 'uint256' }],
  },
  {
    name: 'getHealthFactor',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'pool', type: 'address' },
      { name: 'user', type: 'address' },
    ],
    outputs: [{ type: 'uint256' }],
  },
] as const

const swapRouterAbi = [
  {
    name: 'exactInputSingle',
    type: 'function',
    stateMutability: 'payable',
    inputs: [
      {
        name: 'params',
        type: 'tuple',
        components: [
          { name: 'tokenIn', type: 'address' },
          { name: 'tokenOut', type: 'address' },
          { name: 'fee', type: 'uint24' },
          { name: 'recipient', type: 'address' },
          { name: 'amountIn', type: 'uint256' },
          { name: 'amountOutMinimum', type: 'uint256' },
          { name: 'sqrtPriceLimitX96', type: 'uint160' },
        ],
      },
    ],
    outputs: [{ type: 'uint256' }],
  },
] as const

// ── Build the leverage loop ────────────────────────────────

export function buildLeverageLoop(params: {
  account: Address
  loopCount: number           // 1-5 iterations
  borrowFraction: number      // e.g. 80 for 80%
  minHealthFactor: bigint     // e.g. parseEther('1.5')
  minWethPerSwap: bigint      // slippage protection per swap
}) {
  const { account, loopCount, borrowFraction, minHealthFactor, minWethPerSwap } = params

  const batch = composableBatch({
    account,
    chainId: 8453,
    weth: WETH,
  })

  // ── Step 0: Wrap all native ETH to WETH ────────────────
  batch.wrap({
    value: balance({ native: true, account }),
  })

  // ── Loop iterations ────────────────────────────────────
  for (let i = 0; i < loopCount; i++) {
    // Approve WETH for Aave (runtime balance — exact amount)
    batch.approve({
      token: WETH,
      spender: AAVE_POOL,
      amount: balance({ token: WETH, account }),
    })

    // Supply all WETH to Aave
    batch.step({
      to: AAVE_POOL,
      abi: aavePoolAbi,
      functionName: 'supply',
      args: [
        WETH,
        balance({ token: WETH, account }).gte(1n), // must have something
        account,
        0,
      ],
    })

    // Borrow USDC — amount computed by AaveLens at runtime
    batch.step({
      to: AAVE_POOL,
      abi: aavePoolAbi,
      functionName: 'borrow',
      args: [
        USDC,
        staticRead({
          to: AAVE_LENS,
          abi: aaveLensAbi,
          functionName: 'getSafeBorrowAmount',
          args: [AAVE_POOL, account, 6, BigInt(borrowFraction), 100n],
        }).gte(parseUnits('1', 6)), // at least 1 USDC
        2n,      // variable rate
        0,       // referral
        account, // onBehalfOf
      ],
    })

    // Approve USDC for Uniswap
    batch.approve({
      token: USDC,
      spender: SWAP_ROUTER,
      amount: balance({ token: USDC, account }),
    })

    // Swap all USDC → WETH
    batch.step({
      to: SWAP_ROUTER,
      abi: swapRouterAbi,
      functionName: 'exactInputSingle',
      args: [
        {
          tokenIn: USDC,
          tokenOut: WETH,
          fee: 3000,
          recipient: account,
          // Dynamic: full USDC balance goes into swap
          amountIn: balance({ token: USDC, account }),
          amountOutMinimum: minWethPerSwap,
          sqrtPriceLimitX96: 0n,
        },
      ],
    })
  }

  // ── Final: deposit remaining WETH ──────────────────────
  batch.approve({
    token: WETH,
    spender: AAVE_POOL,
    amount: balance({ token: WETH, account }),
  })

  batch.step({
    to: AAVE_POOL,
    abi: aavePoolAbi,
    functionName: 'supply',
    args: [
      WETH,
      balance({ token: WETH, account }),
      account,
      0,
    ],
  })

  // ── Safety guard: health factor check ──────────────────
  batch.predicate(
    staticRead({
      to: AAVE_LENS,
      abi: aaveLensAbi,
      functionName: 'getHealthFactor',
      args: [AAVE_POOL, account],
    }).gte(minHealthFactor),
  )

  return batch
}

// ── Usage ──────────────────────────────────────────────────

async function main() {
  // const client = createWalletClient({ ... }).extend(composableActions)

  const account = '0x...' as Address

  const batch = buildLeverageLoop({
    account,
    loopCount: 3,
    borrowFraction: 80,
    minHealthFactor: parseEther('1.5'),
    minWethPerSwap: parseEther('0.001'),
  })

  console.log(`Built leverage loop: ${batch.length} steps`)

  // Encode for inspection
  const executions = batch.encode()
  console.log(`ComposableExecution entries: ${executions.length}`)

  // Send via smart account
  // const hash = await client.sendComposableBatch({ batch })
  // console.log(`Transaction: ${hash}`)
}
