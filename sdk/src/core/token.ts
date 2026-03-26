import { type Address, zeroAddress, encodePacked } from 'viem'
import type { DynamicParam } from './types.js'
import { createDynamic } from './params.js'

// ────────────────────────────────────────────────────────────
// BoundToken — ERC-20 token bound to an account
// ────────────────────────────────────────────────────────────

export interface BoundToken {
  readonly address: Address

  /** Runtime balance of this token for the bound account. */
  balance(): DynamicParam<bigint>
}

/**
 * Create a bound ERC-20 token.
 *
 * @example
 * ```ts
 * const weth = token(WETH, account)
 * weth.balance()            // DynamicParam — full runtime balance
 * weth.balance().gte(100n)  // with minimum constraint
 * ```
 */
export function token(address: Address, account: Address): BoundToken {
  const fetcherData = encodePacked(['address', 'address'], [address, account])
  return {
    address,
    balance: () => createDynamic<bigint>('balance', fetcherData),
  }
}

/**
 * Create a bound native ETH token.
 *
 * @example
 * ```ts
 * const eth = native(account)
 * eth.balance()  // native ETH balance at execution time
 * ```
 */
export function native(account: Address): BoundToken {
  const fetcherData = encodePacked(['address', 'address'], [zeroAddress, account])
  return {
    address: zeroAddress,
    balance: () => createDynamic<bigint>('balance', fetcherData),
  }
}
