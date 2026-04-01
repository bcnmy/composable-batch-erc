import {
  type Address,
  type Hex,
  encodePacked,
  encodeFunctionData,
  encodeAbiParameters,
  keccak256,
} from 'viem'
import type { DynamicParam, StorageReadParams } from './types.js'
import { createDynamic } from './params.js'

// ────────────────────────────────────────────────────────────
// CaptureConfig — passed to contract.call() options
// ────────────────────────────────────────────────────────────

export interface CaptureConfig {
  storage: Address
  slot: Hex
  count: number
}

// ────────────────────────────────────────────────────────────
// BoundStorage — Storage contract bound to account + caller
// ────────────────────────────────────────────────────────────

export interface BoundStorage {
  readonly address: Address

  /** Read a captured value — returns DynamicParam for injection into args. */
  read(slot: Hex, index: number): DynamicParam<bigint>

  /** Create a CaptureConfig — for passing to contract.call() options. */
  capture(slot: Hex, count: number): CaptureConfig
}

const STORAGE_READ_ABI = [
  {
    name: 'readStorage',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'namespace', type: 'bytes32' },
      { name: 'slot', type: 'bytes32' },
    ],
    outputs: [{ type: 'bytes32' }],
  },
] as const

/**
 * Bind a Storage contract to an account + caller pair.
 *
 * @example
 * ```ts
 * const store = storage(STORAGE_CONTRACT, { account, caller: MODULE_ADDRESS })
 *
 * // Capture return values from a call
 * batch.add(someContract.call('swap', args, { capture: store.capture('0x01', 2) }))
 *
 * // Read captured value in a later step
 * batch.add(otherContract, 'deposit', [store.read('0x01', 0).gte(minAmount)])
 * ```
 */
export function storage(
  address: Address,
  context: { account: Address; caller: Address },
): BoundStorage {
  const namespace = keccak256(encodePacked(['address', 'address'], [context.account, context.caller]))

  return {
    address,

    read(slot: Hex, index: number): DynamicParam<bigint> {
      const derivedSlot = keccak256(encodePacked(['bytes32', 'uint256'], [slot, BigInt(index)]))
      const callData = encodeFunctionData({
        abi: STORAGE_READ_ABI,
        functionName: 'readStorage',
        args: [namespace, derivedSlot],
      })
      const fetcherData = encodeAbiParameters(
        [{ type: 'address' }, { type: 'bytes' }],
        [address, callData],
      )
      return createDynamic<bigint>('staticCall', fetcherData)
    },

    capture(slot: Hex, count: number): CaptureConfig {
      return { storage: address, slot, count }
    },
  }
}

/**
 * Standalone read from Storage — for one-off reads without binding.
 *
 * @example
 * ```ts
 * fromStorage({ storage: STORAGE_CONTRACT, account, caller: MODULE, slot: '0x01', index: 0 })
 * ```
 */
export function fromStorage(params: StorageReadParams): DynamicParam<bigint> {
  const store = storage(params.storage, { account: params.account, caller: params.caller })
  return store.read(params.slot, params.index)
}
