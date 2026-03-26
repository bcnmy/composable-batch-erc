import {
  type Address,
  type Hex,
  encodeAbiParameters,
  encodePacked,
  keccak256,
  zeroAddress,
  encodeFunctionData,
} from 'viem'
import {
  type DynamicParam,
  type ConstrainedParam,
  type ConstraintDescriptor,
  type StorageReadParams,
  ConstraintType,
  DYNAMIC,
} from './types.js'

// ────────────────────────────────────────────────────────────
// DynamicParam factory (used by token.ts and contract.ts)
// ────────────────────────────────────────────────────────────

export function createDynamic<T>(
  kind: 'balance' | 'staticCall',
  fetcherData: Hex,
  constraints: ConstraintDescriptor[] = [],
): DynamicParam<T> {
  return {
    [DYNAMIC]: true as const,
    __kind: kind,
    __fetcherData: fetcherData,
    __constraints: constraints,

    gte(ref: bigint) {
      return createDynamic<T>(kind, fetcherData, [
        ...constraints,
        { type: ConstraintType.GTE, referenceData: encodeAbiParameters([{ type: 'uint256' }], [ref]) },
      ]) as ConstrainedParam<T>
    },
    lte(ref: bigint) {
      return createDynamic<T>(kind, fetcherData, [
        ...constraints,
        { type: ConstraintType.LTE, referenceData: encodeAbiParameters([{ type: 'uint256' }], [ref]) },
      ]) as ConstrainedParam<T>
    },
    eq(ref: bigint) {
      return createDynamic<T>(kind, fetcherData, [
        ...constraints,
        { type: ConstraintType.EQ, referenceData: encodeAbiParameters([{ type: 'uint256' }], [ref]) },
      ]) as ConstrainedParam<T>
    },
    inRange(lower: bigint, upper: bigint) {
      return createDynamic<T>(kind, fetcherData, [
        ...constraints,
        {
          type: ConstraintType.IN,
          referenceData: encodeAbiParameters(
            [{ type: 'bytes32' }, { type: 'bytes32' }],
            [
              encodeAbiParameters([{ type: 'uint256' }], [lower]),
              encodeAbiParameters([{ type: 'uint256' }], [upper]),
            ],
          ),
        },
      ]) as ConstrainedParam<T>
    },
  }
}

// ────────────────────────────────────────────────────────────
// fromStorage() — read from Storage contract (with correct hashing)
// ────────────────────────────────────────────────────────────

const STORAGE_ABI = [
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

export function fromStorage(params: StorageReadParams): DynamicParam<bigint> {
  // Hash the namespace and slot — matches Storage.sol derivation
  const namespace = keccak256(encodePacked(['address', 'address'], [params.account, params.caller]))
  const derivedSlot = keccak256(encodePacked(['bytes32', 'uint256'], [params.slot, BigInt(params.index)]))

  const callData = encodeFunctionData({
    abi: STORAGE_ABI,
    functionName: 'readStorage',
    args: [namespace, derivedSlot],
  })
  const fetcherData = encodeAbiParameters(
    [{ type: 'address' }, { type: 'bytes' }],
    [params.storage, callData],
  )
  return createDynamic<bigint>('staticCall', fetcherData)
}
