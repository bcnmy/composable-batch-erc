/**
 * Example 1: Leverage Loop — 3x Long ETH on Aave
 *
 * Today: requires DeFi Saver, Instadapp, or a custom contract with flash loans.
 * With smart batching: one batch, one signature, no custom Solidity.
 *
 * Demonstrates: runtime balance reads, STATIC_CALL via lens for computed borrow
 * amounts, struct flattening for Uniswap, health factor post-condition.
 *
 * Shows both batch.add() forms: contract.call() and contract + fn + args.
 */
import { parseEther, parseUnits, encodeFunctionData, type Address } from 'viem'
import { composableBatch, token, native, contract } from '@erc-xxxx/sdk'

const WETH = '0x4200000000000000000000000000000000000006' as Address
const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' as Address
const AAVE_POOL = '0xA238Dd80C259a72e81d7e4664a9801593F98d1c5' as Address
const SWAP_ROUTER = '0x2626664c2603336E57B271c5C0b26F421741e481' as Address
const AAVE_LENS = '0x...' as Address
const COMPOSABLE_LENS = '0x...' as Address

export function leverageLoop(account: Address, loops: number, minHF: bigint) {
  const weth = token(WETH, account)
  const usdc = token(USDC, account)
  const eth  = native(account)

  const aave   = contract(AAVE_POOL, aavePoolAbi)
  const lens   = contract(AAVE_LENS, aaveLensAbi)
  const router = contract(SWAP_ROUTER, swapRouterAbi)

  const batch = composableBatch({ account, chainId: 8453, weth: WETH })

  // Wrap all native ETH
  batch.wrap(eth.balance())

  for (let i = 0; i < loops; i++) {
    // Approve + supply — using Form 2 (contract + fn + args)
    batch.approve(weth, AAVE_POOL, weth.balance())
    batch.add(aave, 'supply', [WETH, weth.balance().gte(1n), account, 0])

    // Borrow — AaveLens computes 80% of capacity in USDC decimals at runtime
    batch.add(aave, 'borrow', [
      USDC,
      lens.read('getSafeBorrowAmount', [AAVE_POOL, account, 6, 80n, 100n]).gte(1n),
      2n, 0, account,
    ])

    // Swap all USDC → WETH — struct with dynamic amountIn field
    batch.approve(usdc, SWAP_ROUTER, usdc.balance())
    batch.add(router, 'exactInputSingle', [{
      tokenIn: USDC, tokenOut: WETH, fee: 3000, recipient: account,
      amountIn: usdc.balance(), amountOutMinimum: 1n, sqrtPriceLimitX96: 0n,
    }])
  }

  // Final deposit
  batch.approve(weth, AAVE_POOL, weth.balance())
  batch.add(aave, 'supply', [WETH, weth.balance(), account, 0])

  // Safety guard: revert everything if health factor is too low
  batch.check(lens.read('getHealthFactor', [AAVE_POOL, account]).gte(minHF))

  return batch
}

/**
 * Alternative: same flow using ComposableLens instead of AaveLens.
 * No protocol-specific lens needed — just the generic readWordMulDiv.
 */
export function leverageLoopGeneric(account: Address, loops: number, minHF: bigint) {
  const weth = token(WETH, account)
  const usdc = token(USDC, account)
  const eth  = native(account)

  const aave   = contract(AAVE_POOL, aavePoolAbi)
  const cLens  = contract(COMPOSABLE_LENS, composableLensAbi)
  const router = contract(SWAP_ROUTER, swapRouterAbi)

  // Pre-encode Aave's getUserAccountData calldata (reused in every iteration)
  const aaveCalldata = encodeFunctionData({
    abi: aavePoolAbi, functionName: 'getUserAccountData', args: [account],
  })

  const batch = composableBatch({ account, chainId: 8453, weth: WETH })
  batch.wrap(eth.balance())

  for (let i = 0; i < loops; i++) {
    batch.approve(weth, AAVE_POOL, weth.balance())
    batch.add(aave, 'supply', [WETH, weth.balance().gte(1n), account, 0])

    // Generic lens: read word 2 (availableBorrowsBase), apply 80% + decimal conversion
    // numerator = 80 * 10^6 = 80_000_000 (80% × USDC decimals)
    // denominator = 100 * 10^8 = 10_000_000_000 (100% × Aave base decimals)
    batch.add(aave, 'borrow', [
      USDC,
      cLens.read('readWordMulDiv', [AAVE_POOL, aaveCalldata, 2n, 80_000_000n, 10_000_000_000n]).gte(1n),
      2n, 0, account,
    ])

    batch.approve(usdc, SWAP_ROUTER, usdc.balance())
    batch.add(router, 'exactInputSingle', [{
      tokenIn: USDC, tokenOut: WETH, fee: 3000, recipient: account,
      amountIn: usdc.balance(), amountOutMinimum: 1n, sqrtPriceLimitX96: 0n,
    }])
  }

  batch.approve(weth, AAVE_POOL, weth.balance())
  batch.add(aave, 'supply', [WETH, weth.balance(), account, 0])

  // Health factor is word 5 of getUserAccountData return
  batch.check(cLens.read('readWord', [AAVE_POOL, aaveCalldata, 5n]).gte(minHF))

  return batch
}

// ABIs omitted for brevity — see full definitions in examples/abis/
declare const aavePoolAbi: any
declare const aaveLensAbi: any
declare const swapRouterAbi: any
declare const composableLensAbi: any
