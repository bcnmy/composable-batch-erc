/**
 * Example 2: Claim Rewards → Swap → Reinvest (Auto-Compound)
 *
 * Today: Beefy/Yearn vaults need custom strategy contracts per farm.
 * With smart batching: any user or agent can auto-compound any farm.
 *
 * Demonstrates: unknown claim amount resolved at runtime, pre-condition
 * to skip dust harvests, full-balance swap and deposit.
 */
import { type Address } from 'viem'
import { composableBatch, token, contract, approve } from '@erc-xxxx/sdk'

export function harvestAndReinvest(account: Address, minReward: bigint) {
  const reward = token(REWARD_TOKEN, account)
  const want   = token(LP_TOKEN, account)

  const farm   = contract(FARM_ADDRESS, farmAbi)
  const router = contract(SWAP_ROUTER, routerAbi)

  const batch = composableBatch({ account })

  // 1. Claim — reward amount unknown until execution
  batch.add(farm, 'harvest', [])

  // 2. Only continue if reward is worth compounding
  batch.check(reward.balance().gte(minReward))

  // 3. Swap all rewards → want token
  batch.add(approve(reward, SWAP_ROUTER, reward.balance()))
  batch.add(router, 'swapExactTokensForTokens', [
    reward.balance(), 1n, [REWARD_TOKEN, LP_TOKEN], account, MaxUint256,
  ])

  // 4. Deposit all want tokens back into the farm
  batch.add(approve(want, FARM_ADDRESS, want.balance()))
  batch.add(farm, 'deposit', [want.balance()])

  return batch
}

declare const REWARD_TOKEN: Address, LP_TOKEN: Address, FARM_ADDRESS: Address, SWAP_ROUTER: Address
declare const farmAbi: any, routerAbi: any
declare const MaxUint256: bigint
