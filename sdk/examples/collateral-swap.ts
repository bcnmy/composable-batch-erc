/**
 * Example 3: Collateral Swap — Move ETH collateral to wstETH on Aave
 *
 * Today: requires flash loan + custom contract (DeFi Saver recipe).
 * With smart batching: iterative withdraw/swap/deposit, no flash loan.
 *
 * Demonstrates: AaveLens safe withdraw amount, iterative position migration,
 * health factor safety guard.
 */
import { parseEther, type Address } from 'viem'
import { composableBatch, token, contract, approve } from '@erc-xxxx/sdk'

export function collateralSwap(account: Address, iterations: number, minHF: bigint) {
  const weth   = token(WETH, account)
  const wsteth = token(WSTETH, account)

  const aave   = contract(AAVE_POOL, aavePoolAbi)
  const lens   = contract(AAVE_LENS, aaveLensAbi)
  const router = contract(SWAP_ROUTER, swapRouterAbi)

  const batch = composableBatch({ account })

  for (let i = 0; i < iterations; i++) {
    // Withdraw safe amount of WETH — lens reads collateral/debt, computes safe amount
    batch.add(aave, 'withdraw', [
      WETH,
      lens.read('getSafeWithdrawAmount', [AAVE_POOL, account, 18, 50n, 100n]).gte(1n),
      account,
    ])

    // Swap WETH → wstETH (0.01% fee pool — tight spread for correlated pair)
    batch.add(approve(weth, SWAP_ROUTER, weth.balance()))
    batch.add(router, 'exactInputSingle', [{
      tokenIn: WETH, tokenOut: WSTETH, fee: 100, recipient: account,
      amountIn: weth.balance(), amountOutMinimum: 1n, sqrtPriceLimitX96: 0n,
    }])

    // Deposit wstETH as new collateral
    batch.add(approve(wsteth, AAVE_POOL, wsteth.balance()))
    batch.add(aave, 'supply', [WSTETH, wsteth.balance(), account, 0])
  }

  // Safety: health factor must stay healthy throughout
  batch.check(lens.read('getHealthFactor', [AAVE_POOL, account]).gte(minHF))

  return batch
}

declare const WETH: Address, WSTETH: Address, AAVE_POOL: Address, SWAP_ROUTER: Address, AAVE_LENS: Address
declare const aavePoolAbi: any, aaveLensAbi: any, swapRouterAbi: any
