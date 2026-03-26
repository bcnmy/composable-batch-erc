import type { Abi, AbiFunction, Address, Hex } from 'viem'

// ────────────────────────────────────────────────────────────
// On-chain enum mirrors (match ComposabilityDataTypes.sol)
// ────────────────────────────────────────────────────────────

export enum InputParamType {
  TARGET = 0,
  VALUE = 1,
  CALL_DATA = 2,
}

export enum InputParamFetcherType {
  RAW_BYTES = 0,
  STATIC_CALL = 1,
  BALANCE = 2,
}

export enum OutputParamFetcherType {
  EXEC_RESULT = 0,
  STATIC_CALL = 1,
}

export enum ConstraintType {
  EQ = 0,
  GTE = 1,
  LTE = 2,
  IN = 3,
}

// ────────────────────────────────────────────────────────────
// On-chain struct mirrors
// ────────────────────────────────────────────────────────────

export type Constraint = {
  constraintType: ConstraintType
  referenceData: Hex
}

export type InputParam = {
  paramType: InputParamType
  fetcherType: InputParamFetcherType
  paramData: Hex
  constraints: Constraint[]
}

export type OutputParam = {
  fetcherType: OutputParamFetcherType
  paramData: Hex
}

export type ComposableExecution = {
  functionSig: Hex
  inputParams: InputParam[]
  outputParams: OutputParam[]
}

// ────────────────────────────────────────────────────────────
// Dynamic parameter system
// ────────────────────────────────────────────────────────────

/** Brand symbol — never leaks to runtime, just type discrimination */
export const DYNAMIC = Symbol.for('smartbatch.dynamic')

export type ConstraintDescriptor = {
  type: ConstraintType
  referenceData: Hex
}

/**
 * A value that is resolved at execution time on-chain.
 * Drop-in replacement for a static value anywhere in `args`.
 */
export interface DynamicParam<_T = unknown> {
  readonly [DYNAMIC]: true
  readonly __kind: 'balance' | 'staticCall'
  readonly __fetcherData: Hex
  readonly __constraints: ConstraintDescriptor[]

  /** Resolved value must be ≥ ref */
  gte(ref: bigint): ConstrainedParam<_T>
  /** Resolved value must be ≤ ref */
  lte(ref: bigint): ConstrainedParam<_T>
  /** Resolved value must equal ref */
  eq(ref: bigint): ConstrainedParam<_T>
  /** Resolved value must be in [lower, upper] */
  inRange(lower: bigint, upper: bigint): ConstrainedParam<_T>
}

/** A DynamicParam that already carries one or more constraints. */
export interface ConstrainedParam<_T = unknown> extends DynamicParam<_T> {}

// ────────────────────────────────────────────────────────────
// MaybeDynamic — allows each arg to be static OR dynamic
// ────────────────────────────────────────────────────────────

/**
 * For a tuple of ABI-inferred types, allow each element
 * to be either the literal type or a DynamicParam of that type.
 *
 * Example:
 *   ABI says args = [Address, bigint, bigint]
 *   MaybeDynamic<[Address, bigint, bigint]> =
 *     [Address | DynamicParam<Address>, bigint | DynamicParam<bigint>, bigint | DynamicParam<bigint>]
 */
export type MaybeDynamic<T> = T extends readonly [infer Head, ...infer Tail]
  ? [Head | DynamicParam<Head>, ...MaybeDynamic<Tail>]
  : T extends readonly []
    ? []
    : T extends Record<string, unknown>
      ? { [K in keyof T]: T[K] | DynamicParam<T[K]> }
      : T

// ────────────────────────────────────────────────────────────
// Step descriptor (what the user passes to batch.step())
// ────────────────────────────────────────────────────────────

export type StepParams<
  abi extends Abi = Abi,
  functionName extends string = string,
  args extends readonly unknown[] = readonly unknown[],
> = {
  to: Address | DynamicParam<Address>
  abi: abi
  functionName: functionName
  args: MaybeDynamic<args>
  value?: bigint | DynamicParam<bigint>
}

// ────────────────────────────────────────────────────────────
// Capture descriptor (for output params / storage)
// ────────────────────────────────────────────────────────────

export type CaptureParams = {
  storage: Address
  slot: Hex
  count: number
}

export type StorageReadParams = {
  storage: Address
  account: Address
  caller: Address
  slot: Hex
  index: number
}
