import { parseEther, encodeAbiParameters, encodePacked } from 'viem'
import {
  runtimeERC20BalanceOf,

  runtimeParamViaCustomStaticCall,
  greaterThanOrEqualTo,
} from '@biconomy/abstractjs'
import type { MultichainSmartAccount } from '@biconomy/abstractjs'
import type { ChainConfig } from '../config/chains'
import { simulateLoopsFromState } from './leverage-math'
import { aavePoolAbi } from '../abis/aavePool'
import { aaveLensAbi } from '../abis/aaveLens'
import { swapRouterAbi } from '../abis/swapRouter'
import { erc20Abi } from '../abis/erc20'

// Per-call gas limits based on typical on-chain costs + composable module overhead.
// The SDK sums these into the userOp's callGasLimit automatically.
const GAS = {
  wrapDeposit:  200_000n,  // WETH.deposit ~28k + module overhead
  approve:      20_000n,   // ERC20.approve ~46k + balance read
  aaveSupply:   130_000n,  // Aave supply ~220k + balance read + constraint
  aaveBorrow:   130_000n,  // Aave borrow ~220k + lens static call + constraint
  uniswapSwap:  100_000n,  // Uniswap exactInputSingle ~150k + balance read + struct encoding
  healthCheck:  30_000n,  // approve + lens static call + constraint
} as const

export async function buildLeverageLoopInstructions(
  account: MultichainSmartAccount,
  chain: ChainConfig,
  loops: number,
  borrowFraction: number,
  /** ETH amount in wei. If undefined, uses full native balance. */
  amount?: bigint,
  /** Existing USDC balance in the wallet (from a previous unwind). If > 0, adds a cleanup swap first. */
  existingUsdcBalance?: bigint,
  /** Existing Aave position (8-decimal USD base). Used to project HF after adding loops. */
  existingCollateralBase?: bigint,
  existingDebtBase?: bigint,
  /** Current ETH price in USD */
  ethPriceUsd?: number,
) {
  // Simulate loops from the actual Aave state to project the final HF.
  // This uses the real borrow dynamics (80% of TOTAL available borrows per iteration).
  const existCollUsd = Number(existingCollateralBase ?? 0n) / 1e8
  const existDebtUsd = Number(existingDebtBase ?? 0n) / 1e8
  const price = ethPriceUsd || 2000
  const newDepositUsd = amount ? Number(amount) / 1e18 * price : 0

  const { projHF } = simulateLoopsFromState(loops, newDepositUsd, existCollUsd, existDebtUsd)

  // Guard at 95% of projected HF, floor at 1.02
  const guard = Math.max(projHF * 0.95, 1.02)
  const minHealthFactor = parseEther(guard.toFixed(4))

  const addr = account.addressOn(chain.chainId, true)!
  const instructions: any[] = []

  // Cleanup: if there's leftover USDC from a previous unwind, swap it to WETH first.
  // Without this, the USDC gets picked up by the first swap step and inflates the position.
  if (existingUsdcBalance && existingUsdcBalance > 0n) {
    const cleanupApprove = await account.buildComposable({
      type: 'default',
      data: {
        chainId: chain.chainId,
        to: chain.usdc,
        abi: erc20Abi,
        functionName: 'approve',
        args: [
          chain.swapRouter,
          runtimeERC20BalanceOf({ targetAddress: addr, tokenAddress: chain.usdc }),
        ],
        gasLimit: GAS.approve,
      },
    })
    instructions.push(...cleanupApprove)

    const cleanupSwap = await account.buildComposable({
      type: 'default',
      data: {
        chainId: chain.chainId,
        to: chain.swapRouter,
        abi: swapRouterAbi,
        functionName: 'exactInputSingle',
        args: [
          {
            tokenIn: chain.usdc,
            tokenOut: chain.weth,
            fee: chain.uniswapFee,
            recipient: addr,
            amountIn: runtimeERC20BalanceOf({
              targetAddress: addr,
              tokenAddress: chain.usdc,
            }),
            amountOutMinimum: 1n,
            sqrtPriceLimitX96: 0n,
          },
        ],
        gasLimit: GAS.uniswapSwap,
      },
    })
    instructions.push(...cleanupSwap)
  }

  // Wrap native ETH → WETH by calling deposit() directly on the WETH contract.
  // We build this instruction manually because:
  // 1. nativeTokenTransfer routes through EthForwarder, which breaks wrapping
  //    (WETH credits msg.sender=forwarder instead of the smart account)
  // 2. buildComposable rejects zero-arg functions like deposit()
  const isRuntimeBalance = amount === undefined
  const valueInputParam = isRuntimeBalance
    ? {
        paramType: 1 as const, // VALUE
        fetcherType: 2 as const, // BALANCE (native)
        paramData: encodePacked(['address', 'address'], ['0x0000000000000000000000000000000000000000', addr]),
        constraints: [{ constraintType: 1 as const, referenceData: encodeAbiParameters([{ type: 'uint256' }], [1n]) }],
      }
    : {
        paramType: 1 as const, // VALUE
        fetcherType: 0 as const, // RAW_BYTES
        paramData: encodeAbiParameters([{ type: 'uint256' }], [amount]),
        constraints: [],
      }

  instructions.push({
    calls: [{
      functionSig: '0xd0e30db0', // deposit()
      gasLimit: GAS.wrapDeposit,
      inputParams: [
        {
          paramType: 0, // TARGET
          fetcherType: 0, // RAW_BYTES
          paramData: encodeAbiParameters([{ type: 'address' }], [chain.weth]),
          constraints: [],
        },
        valueInputParam,
      ],
      outputParams: [],
    }],
    chainId: chain.chainId,
    isComposable: true,
  })

  for (let i = 0; i < loops; i++) {
    // Approve WETH for Aave (runtime balance)
    const approveWeth = await account.buildComposable({
      type: 'default',
      data: {
        chainId: chain.chainId,
        to: chain.weth,
        abi: erc20Abi,
        functionName: 'approve',
        args: [
          chain.aavePool,
          runtimeERC20BalanceOf({ targetAddress: addr, tokenAddress: chain.weth }),
        ],
        gasLimit: GAS.approve,
      },
    })
    instructions.push(...approveWeth)

    // Supply all WETH to Aave
    const supply = await account.buildComposable({
      type: 'default',
      data: {
        chainId: chain.chainId,
        to: chain.aavePool,
        abi: aavePoolAbi,
        functionName: 'supply',
        args: [
          chain.weth,
          runtimeERC20BalanceOf({
            targetAddress: addr,
            tokenAddress: chain.weth,
            constraints: [greaterThanOrEqualTo(1n)],
          }),
          addr,
          0,
        ],
        gasLimit: GAS.aaveSupply,
      },
    })
    instructions.push(...supply)

    // Borrow USDC — amount from AaveLens at runtime
    const borrow = await account.buildComposable({
      type: 'default',
      data: {
        chainId: chain.chainId,
        to: chain.aavePool,
        abi: aavePoolAbi,
        functionName: 'borrow',
        args: [
          chain.usdc,
          runtimeParamViaCustomStaticCall({
            targetContractAddress: chain.aaveLens,
            functionAbi: aaveLensAbi,
            functionName: 'getSafeBorrowAmount',
            args: [chain.aavePool, addr, 6, BigInt(borrowFraction), 100n],
            constraints: [greaterThanOrEqualTo(1n)],
          }),
          2n,
          0,
          addr,
        ],
        gasLimit: GAS.aaveBorrow,
      },
    })
    instructions.push(...borrow)

    // Approve USDC for Uniswap
    const approveUsdc = await account.buildComposable({
      type: 'default',
      data: {
        chainId: chain.chainId,
        to: chain.usdc,
        abi: erc20Abi,
        functionName: 'approve',
        args: [
          chain.swapRouter,
          runtimeERC20BalanceOf({ targetAddress: addr, tokenAddress: chain.usdc }),
        ],
        gasLimit: GAS.approve,
      },
    })
    instructions.push(...approveUsdc)

    // Swap all USDC → WETH
    const swap = await account.buildComposable({
      type: 'default',
      data: {
        chainId: chain.chainId,
        to: chain.swapRouter,
        abi: swapRouterAbi,
        functionName: 'exactInputSingle',
        args: [
          {
            tokenIn: chain.usdc,
            tokenOut: chain.weth,
            fee: chain.uniswapFee,
            recipient: addr,
            amountIn: runtimeERC20BalanceOf({
              targetAddress: addr,
              tokenAddress: chain.usdc,
              constraints: [greaterThanOrEqualTo(1n)],
            }),
            amountOutMinimum: 1n,
            sqrtPriceLimitX96: 0n,
          },
        ],
        gasLimit: GAS.uniswapSwap,
      },
    })
    instructions.push(...swap)
  }

  // Final approve + supply
  const finalApprove = await account.buildComposable({
    type: 'default',
    data: {
      chainId: chain.chainId,
      to: chain.weth,
      abi: erc20Abi,
      functionName: 'approve',
      args: [
        chain.aavePool,
        runtimeERC20BalanceOf({ targetAddress: addr, tokenAddress: chain.weth }),
      ],
      gasLimit: GAS.approve,
    },
  })
  instructions.push(...finalApprove)

  const finalSupply = await account.buildComposable({
    type: 'default',
    data: {
      chainId: chain.chainId,
      to: chain.aavePool,
      abi: aavePoolAbi,
      functionName: 'supply',
      args: [
        chain.weth,
        runtimeERC20BalanceOf({ targetAddress: addr, tokenAddress: chain.weth }),
        addr,
        0,
      ],
      gasLimit: GAS.aaveSupply,
    },
  })
  instructions.push(...finalSupply)

  // Safety guard: health factor must exceed auto-computed minimum.
  // Uses a no-op approve where the amount arg is the runtime HF read with a GTE constraint.
  // If HF < minimum, constraint fails → entire batch reverts atomically.
  const healthCheck = await account.buildComposable({
    type: 'default',
    data: {
      chainId: chain.chainId,
      to: chain.weth,
      abi: erc20Abi,
      functionName: 'approve',
      args: [
        chain.aavePool,
        runtimeParamViaCustomStaticCall({
          targetContractAddress: chain.aaveLens,
          functionAbi: aaveLensAbi,
          functionName: 'getHealthFactor',
          args: [chain.aavePool, addr],
          constraints: [greaterThanOrEqualTo(minHealthFactor)],
        }),
      ],
      gasLimit: GAS.healthCheck,
    },
  })
  instructions.push(...healthCheck)

  return instructions
}
