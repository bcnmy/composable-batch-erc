/**
 * Example 6: Portfolio Rebalance — Withdraw, Swap, Deposit Across Protocols
 *
 * An AI agent detects portfolio drift and rebalances in one atomic batch.
 * Today: 4+ separate transactions with MEV exposure between each.
 * With smart batching: atomic rebalance with post-condition.
 *
 * Demonstrates: cross-protocol composition (Aave + Morpho + Uniswap),
 * static withdraw amount + dynamic swap output + dynamic deposit.
 */
import { parseEther, type Address } from 'viem'
import { composableBatch, token, contract, approve } from '@erc-xxxx/sdk'

export function rebalanceToStables(account: Address, withdrawAmount: bigint, minUsdc: bigint) {
  const weth = token(WETH, account)
  const usdc = token(USDC, account)

  const aave   = contract(AAVE_POOL, aavePoolAbi)
  const morpho = contract(MORPHO_VAULT, morphoAbi)
  const router = contract(SWAP_ROUTER, swapRouterAbi)

  const batch = composableBatch({ account })

  // 1. Withdraw WETH from Aave (static amount — agent calculated off-chain)
  batch.add(aave, 'withdraw', [WETH, withdrawAmount, account])

  // 2. Swap WETH → USDC (full balance, dynamic output)
  batch.add(approve(weth, SWAP_ROUTER, weth.balance()))
  batch.add(router, 'exactInputSingle', [{
    tokenIn: WETH, tokenOut: USDC, fee: 500, recipient: account,
    amountIn: weth.balance(), amountOutMinimum: minUsdc, sqrtPriceLimitX96: 0n,
  }])

  // 3. Deposit all USDC into Morpho vault
  batch.add(approve(usdc, MORPHO_VAULT, usdc.balance()))
  batch.add(morpho, 'deposit', [usdc.balance(), account])

  // 4. Post-condition: got meaningful vault shares
  const shares = token(MORPHO_VAULT, account)
  batch.check(shares.balance().gte(1n))

  return batch
}

declare const WETH: Address, USDC: Address, AAVE_POOL: Address, MORPHO_VAULT: Address, SWAP_ROUTER: Address
declare const aavePoolAbi: any, morphoAbi: any, swapRouterAbi: any
