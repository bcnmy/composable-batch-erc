/**
 * Example 5: Cross-Protocol Debt Refinancing (Morpho → Aave)
 *
 * Move a lending position from Morpho Blue to Aave V3 for better rates.
 * Today: requires Instadapp DSA or flash loan + custom contract.
 * With smart batching: iterative unwind/rebuild, zero flash loan fees.
 */
import { type Address } from 'viem'
import { composableBatch, token, contract, approve } from '@erc-xxxx/sdk'

const weth = token(WETH, account)
const usdc = token(USDC, account)

const morpho = contract(MORPHO_BLUE, morphoAbi)
const aave   = contract(AAVE_POOL, aavePoolAbi)
const lens   = contract(AAVE_LENS, aaveLensAbi)

export function refinanceToAave(account: Address, iterations: number, minHF: bigint) {
  const batch = composableBatch({ account })

  for (let i = 0; i < iterations; i++) {
    // Repay partial USDC debt on Morpho (frees collateral)
    batch.add(approve(usdc, MORPHO_BLUE, usdc.balance()))
    batch.add(morpho, 'repay', [MORPHO_MARKET_PARAMS, usdc.balance(), 0, account, '0x'])

    // Withdraw freed WETH collateral from Morpho
    batch.add(morpho, 'withdrawCollateral', [MORPHO_MARKET_PARAMS, weth.balance(), account, account])

    // Deposit WETH into Aave
    batch.add(approve(weth, AAVE_POOL, weth.balance()))
    batch.add(aave, 'supply', [WETH, weth.balance(), account, 0])

    // Borrow USDC from Aave (for next Morpho repayment iteration)
    batch.add(aave, 'borrow', [
      USDC,
      lens.read('getSafeBorrowAmount', [AAVE_POOL, account, 6, 80n, 100n]).gte(1n),
      2n, 0, account,
    ])
  }

  // Final: repay remaining Morpho debt
  batch.add(approve(usdc, MORPHO_BLUE, usdc.balance()))
  batch.add(morpho, 'repay', [MORPHO_MARKET_PARAMS, usdc.balance(), 0, account, '0x'])

  // Safety: Aave health factor must be healthy
  batch.check(lens.read('getHealthFactor', [AAVE_POOL, account]).gte(minHF))

  return batch
}
