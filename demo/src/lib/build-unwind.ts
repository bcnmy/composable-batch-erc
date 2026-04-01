import { encodeAbiParameters, encodePacked } from 'viem'
import {
  runtimeERC20BalanceOf,
  runtimeParamViaCustomStaticCall,
  greaterThanOrEqualTo,
} from '@biconomy/abstractjs'
import type { MultichainSmartAccount } from '@biconomy/abstractjs'
import type { ChainConfig } from '../config/chains'
import { aavePoolAbi } from '../abis/aavePool'
import { aaveLensAbi } from '../abis/aaveLens'
import { swapRouterAbi } from '../abis/swapRouter'
import { erc20Abi } from '../abis/erc20'

// Per-call gas limits based on typical on-chain costs + composable module overhead.
const GAS = {
  approve:       80_000n,
  aaveWithdraw:  400_000n,  // Aave withdraw ~250k + lens static call + constraint
  aaveRepay:     300_000n,  // Aave repay ~200k + balance read
  uniswapSwap:   300_000n,  // Uniswap exactInputSingle ~150k + balance read
  wethWithdraw:  100_000n,  // WETH.withdraw ~30k + balance read
} as const

/**
 * Build instructions to fully unwind a leveraged ETH position:
 *
 * Each iteration:
 *   1. Withdraw safe WETH from Aave (via AaveLens)
 *   2. Swap WETH → USDC on Uniswap
 *   3. Repay USDC debt to Aave
 *
 * After iterations:
 *   4. Withdraw all remaining WETH
 *   5. Unwrap WETH → ETH via WETH.withdraw()
 *
 * More iterations = safer for larger positions (each step only withdraws
 * what keeps HF > 1). 3 iterations covers up to ~4x leverage.
 */
export async function buildUnwindInstructions(
  account: MultichainSmartAccount,
  chain: ChainConfig,
  iterations: number,
) {
  const addr = account.addressOn(chain.chainId, true)!
  const instructions: any[] = []

  for (let i = 0; i < iterations; i++) {
    // Withdraw safe WETH amount from Aave using the oracle-aware lens.
    // Reads the real ETH price from Aave's oracle for accurate USD→WETH conversion.
    // 90% of safe amount — leaves buffer for rounding.
    const withdraw = await account.buildComposable({
      type: 'default',
      data: {
        chainId: chain.chainId,
        to: chain.aavePool,
        abi: aavePoolAbi,
        functionName: 'withdraw',
        args: [
          chain.weth,
          runtimeParamViaCustomStaticCall({
            targetContractAddress: chain.aaveLens,
            functionAbi: aaveLensAbi,
            functionName: 'getSafeWithdrawAmountWithOracle',
            args: [chain.aavePool, addr, chain.weth, 18, 80n, 100n],
            constraints: [greaterThanOrEqualTo(1n)],
          }),
          addr,
        ],
        gasLimit: GAS.aaveWithdraw,
      },
    })
    instructions.push(...withdraw)

    // Approve WETH for Uniswap
    const approveWeth = await account.buildComposable({
      type: 'default',
      data: {
        chainId: chain.chainId,
        to: chain.weth,
        abi: erc20Abi,
        functionName: 'approve',
        args: [
          chain.swapRouter,
          runtimeERC20BalanceOf({ targetAddress: addr, tokenAddress: chain.weth }),
        ],
        gasLimit: GAS.approve,
      },
    })
    instructions.push(...approveWeth)

    // Swap all WETH → USDC
    const swap = await account.buildComposable({
      type: 'default',
      data: {
        chainId: chain.chainId,
        to: chain.swapRouter,
        abi: swapRouterAbi,
        functionName: 'exactInputSingle',
        args: [
          {
            tokenIn: chain.weth,
            tokenOut: chain.usdc,
            fee: chain.uniswapFee,
            recipient: addr,
            amountIn: runtimeERC20BalanceOf({
              targetAddress: addr,
              tokenAddress: chain.weth,
            }),
            amountOutMinimum: 1n,
            sqrtPriceLimitX96: 0n,
          },
        ],
        gasLimit: GAS.uniswapSwap,
      },
    })
    instructions.push(...swap)

    // Approve USDC for Aave repay
    const approveUsdc = await account.buildComposable({
      type: 'default',
      data: {
        chainId: chain.chainId,
        to: chain.usdc,
        abi: erc20Abi,
        functionName: 'approve',
        args: [
          chain.aavePool,
          runtimeERC20BalanceOf({ targetAddress: addr, tokenAddress: chain.usdc }),
        ],
        gasLimit: GAS.approve,
      },
    })
    instructions.push(...approveUsdc)

    // Repay all USDC debt (use balance — Aave caps at actual debt)
    const repay = await account.buildComposable({
      type: 'default',
      data: {
        chainId: chain.chainId,
        to: chain.aavePool,
        abi: aavePoolAbi,
        functionName: 'repay',
        args: [
          chain.usdc,
          runtimeERC20BalanceOf({ targetAddress: addr, tokenAddress: chain.usdc }),
          2n,
          addr,
        ],
        gasLimit: GAS.aaveRepay,
      },
    })
    instructions.push(...repay)
  }

  // Withdraw remaining WETH collateral.
  // Use the oracle-aware lens at 100% instead of uint256.max — if any dust debt
  // remains (from swap slippage), uint256.max would revert by dropping HF below 1.
  // The lens safely returns only what can be withdrawn.
  const finalWithdraw = await account.buildComposable({
    type: 'default',
    data: {
      chainId: chain.chainId,
      to: chain.aavePool,
      abi: aavePoolAbi,
      functionName: 'withdraw',
      args: [
        chain.weth,
        runtimeParamViaCustomStaticCall({
          targetContractAddress: chain.aaveLens,
          functionAbi: aaveLensAbi,
          functionName: 'getSafeWithdrawAmountWithOracle',
          args: [chain.aavePool, addr, chain.weth, 18, 100n, 100n],
        }),
        addr,
      ],
      gasLimit: GAS.aaveWithdraw,
    },
  })
  instructions.push(...finalWithdraw)

  // Convert leftover USDC → WETH.
  // The last repay iteration always leaves excess USDC because Aave caps repayment
  // at the actual debt amount. This step converts it back so the user receives ETH only.
  const usdcToWeth_approve = await account.buildComposable({
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
  instructions.push(...usdcToWeth_approve)

  const usdcToWeth_swap = await account.buildComposable({
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
  instructions.push(...usdcToWeth_swap)

  // Unwrap all WETH → ETH: call WETH.withdraw(balance)
  // Built manually because WETH.withdraw(uint256) needs a BALANCE fetcher arg
  instructions.push({
    calls: [{
      functionSig: '0x2e1a7d4d', // withdraw(uint256)
      gasLimit: GAS.wethWithdraw,
      inputParams: [
        {
          paramType: 0, // TARGET
          fetcherType: 0, // RAW_BYTES
          paramData: encodeAbiParameters([{ type: 'address' }], [chain.weth]),
          constraints: [],
        },
        {
          paramType: 2, // CALL_DATA
          fetcherType: 2, // BALANCE
          paramData: encodePacked(['address', 'address'], [chain.weth, addr]),
          constraints: [],
        },
      ],
      outputParams: [],
    }],
    chainId: chain.chainId,
    isComposable: true,
  })

  return instructions
}
