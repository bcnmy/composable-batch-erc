/**
 * Example 7: Dustless Token Migration
 *
 * Swap entire balance of one token to another with zero dust left behind.
 * Today: users manually check balance, paste into swap UI, often leave dust.
 * With smart batching: BALANCE fetcher guarantees exact full amount.
 *
 * Demonstrates: simplest possible flow — pre-condition, approve, swap, post-condition.
 * Good introduction example for developers new to the SDK.
 */
import { type Address } from 'viem'
import { composableBatch, token, contract, approve } from '@erc-xxxx/sdk'

export function migrateToken(account: Address, minOutput: bigint) {
  const dai  = token(DAI, account)
  const usdc = token(USDC, account)

  const router = contract(SWAP_ROUTER, swapRouterAbi)

  const batch = composableBatch({ account })

  // Pre-condition: only run if we have DAI to migrate
  batch.check(dai.balance().gte(1n))

  // Approve exact runtime balance — not infinite, not a guess
  batch.add(approve(dai, SWAP_ROUTER, dai.balance()))

  // Swap full balance — zero dust
  batch.add(router, 'exactInputSingle', [{
    tokenIn: DAI, tokenOut: USDC, fee: 100, recipient: account,
    amountIn: dai.balance(), amountOutMinimum: minOutput, sqrtPriceLimitX96: 0n,
  }])

  // Post-condition: DAI is fully gone
  batch.check(dai.balance().lte(0n))

  return batch
}

declare const DAI: Address, USDC: Address, SWAP_ROUTER: Address
declare const swapRouterAbi: any
