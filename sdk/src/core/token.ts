import { type Address, zeroAddress, encodePacked, encodeFunctionData, encodeAbiParameters } from 'viem'
import type { DynamicParam } from './types.js'
import { createDynamic } from './params.js'

// ────────────────────────────────────────────────────────────
// BoundToken — ERC-20 token bound to an account
// ────────────────────────────────────────────────────────────

export interface BoundToken {
  readonly address: Address

  /** Runtime balance of this token for the bound account. */
  balance(): DynamicParam<bigint>

  /** Runtime allowance of this token for the bound account and a given spender. */
  allowance(spender: Address): DynamicParam<bigint>
}

const ALLOWANCE_ABI = [
  {
    name: 'allowance',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'spender', type: 'address' },
    ],
    outputs: [{ type: 'uint256' }],
  },
] as const

/**
 * Create a bound ERC-20 token.
 *
 * @example
 * ```ts
 * const weth = token(WETH, account)
 * weth.balance()                    // runtime balance
 * weth.balance().gte(100n)          // with constraint
 * weth.allowance(AAVE_POOL)         // runtime allowance
 * weth.allowance(AAVE_POOL).gte(1n) // with constraint
 * ```
 */
export function token(address: Address, account: Address): BoundToken {
  const balanceFetcherData = encodePacked(['address', 'address'], [address, account])

  return {
    address,

    balance: () => createDynamic<bigint>('balance', balanceFetcherData),

    allowance: (spender: Address) => {
      const callData = encodeFunctionData({
        abi: ALLOWANCE_ABI,
        functionName: 'allowance',
        args: [account, spender],
      })
      const fetcherData = encodeAbiParameters(
        [{ type: 'address' }, { type: 'bytes' }],
        [address, callData],
      )
      return createDynamic<bigint>('staticCall', fetcherData)
    },
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
    allowance: () => { throw new Error('Native ETH has no allowance') },
  }
}
