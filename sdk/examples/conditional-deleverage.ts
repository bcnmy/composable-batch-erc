/**
 * Example 8: Conditional Deleverage (Stop-Loss)
 *
 * Reduce leverage only if health factor drops below threshold.
 * A relayer simulates this batch — if the pre-condition fails, it waits.
 * When HF drops, simulation passes and the relayer submits.
 *
 * Today: requires DeFi Saver automation + keeper network.
 * With smart batching: a pre-signed batch that executes when conditions are met.
 *
 * Demonstrates: pre-condition (LTE trigger), runtime lens reads,
 * post-condition (GTE target), relayer simulation pattern.
 */
import { parseEther, type Address } from 'viem'
import { composableBatch, token, contract, approve } from '@erc-xxxx/sdk'

export function stopLoss(account: Address, triggerHF: bigint, targetHF: bigint) {
  const weth = token(WETH, account)
  const usdc = token(USDC, account)

  const aave   = contract(AAVE_POOL, aavePoolAbi)
  const lens   = contract(AAVE_LENS, aaveLensAbi)
  const router = contract(SWAP_ROUTER, swapRouterAbi)

  const batch = composableBatch({ account })

  // Pre-condition: only execute when health factor DROPS BELOW trigger
  // Relayer simulates periodically — this fails when HF is healthy, passes when HF drops
  batch.check(lens.read('getHealthFactor', [AAVE_POOL, account]).lte(triggerHF))

  // Withdraw safe amount of collateral — Form 2 style
  batch.add(aave, 'withdraw', [
    WETH,
    lens.read('getSafeWithdrawAmount', [AAVE_POOL, account, 18, 30n, 100n]),
    account,
  ])

  // Swap WETH → USDC to repay debt — Form 1 style with standalone approve
  batch.add(approve(weth, SWAP_ROUTER, weth.balance()))
  batch.add(router.call('exactInputSingle', [{
    tokenIn: WETH, tokenOut: USDC, fee: 500, recipient: account,
    amountIn: weth.balance(), amountOutMinimum: 1n, sqrtPriceLimitX96: 0n,
  }]))

  // Repay USDC debt
  batch.add(approve(usdc, AAVE_POOL, usdc.balance()))
  batch.add(aave, 'repay', [USDC, usdc.balance(), 2, account])

  // Post-condition: health factor must now be ABOVE target — position is safe
  batch.check(lens.read('getHealthFactor', [AAVE_POOL, account]).gte(targetHF))

  return batch
}

declare const WETH: Address, USDC: Address, AAVE_POOL: Address, SWAP_ROUTER: Address, AAVE_LENS: Address
declare const aavePoolAbi: any, aaveLensAbi: any, swapRouterAbi: any
