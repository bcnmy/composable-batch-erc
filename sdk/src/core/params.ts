import {
  type Hex,
  encodeAbiParameters,
} from 'viem'
import {
  type DynamicParam,
  type ConstrainedParam,
  type ConstraintDescriptor,
  ConstraintType,
  DYNAMIC,
} from './types.js'

// ────────────────────────────────────────────────────────────
// DynamicParam factory (used by token.ts, contract.ts, storage.ts)
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
