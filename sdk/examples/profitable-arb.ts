/**
 * Example 4: Atomic Arbitrage with Profitability Check
 *
 * Today: requires custom contract deployed per arb path.
 * With smart batching: agent compiles the path, post-condition reverts if not profitable.
 *
 * Demonstrates: multi-DEX routing, post-condition as profitability switch,
 * struct flattening with static amounts.
 */
import { type Address } from 'viem'
import { composableBatch, token, contract, approve } from '@erc-xxxx/sdk'

export function atomicArb(account: Address, inputAmount: bigint, minProfit: bigint) {
  const weth = token(WETH, account)
  const usdc = token(USDC, account)

  const uniswap = contract(UNISWAP_ROUTER, swapRouterAbi)
  const sushi   = contract(SUSHI_ROUTER, swapRouterAbi)

  const batch = composableBatch({ account })

  // 1. Buy cheap on Uniswap: USDC → WETH
  batch.add(approve(usdc, UNISWAP_ROUTER, usdc.balance()))
  batch.add(uniswap, 'exactInputSingle', [{
    tokenIn: USDC, tokenOut: WETH, fee: 500, recipient: account,
    amountIn: inputAmount, amountOutMinimum: 1n, sqrtPriceLimitX96: 0n,
  }])

  // 2. Sell expensive on Sushi: WETH → USDC (full balance from step 1)
  batch.add(approve(weth, SUSHI_ROUTER, weth.balance()))
  batch.add(sushi, 'exactInputSingle', [{
    tokenIn: WETH, tokenOut: USDC, fee: 3000, recipient: account,
    amountIn: weth.balance(), amountOutMinimum: 1n, sqrtPriceLimitX96: 0n,
  }])

  // 3. Profitability check — revert entire batch if not profitable
  batch.check(usdc.balance().gte(inputAmount + minProfit))

  return batch
}

declare const WETH: Address, USDC: Address, UNISWAP_ROUTER: Address, SUSHI_ROUTER: Address
declare const swapRouterAbi: any
