import {
  type Abi,
  type Address,
  type Hex,
  encodeFunctionData,
  encodePacked,
  encodeAbiParameters,
  zeroAddress,
  toFunctionSelector,
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
// Internal: create a DynamicParam with fluent constraint methods
// ────────────────────────────────────────────────────────────

function createDynamic<T>(
  kind: 'balance' | 'staticCall',
  fetcherData: Hex,
  constraints: ConstraintDescriptor[] = [],
): DynamicParam<T> {
  const param: DynamicParam<T> = {
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
            [encodeAbiParameters([{ type: 'uint256' }], [lower]), encodeAbiParameters([{ type: 'uint256' }], [upper])],
          ),
        },
      ]) as ConstrainedParam<T>
    },
  }

  return param
}

// ────────────────────────────────────────────────────────────
// balance() — BALANCE fetcher
// ────────────────────────────────────────────────────────────

export type BalanceParams = {
  /** ERC-20 token address. Omit or pass zeroAddress for native ETH. */
  token?: Address
  /** Shorthand: set to true for native ETH balance. */
  native?: true
  /** Account whose balance to read. */
  account: Address
}

/**
 * Read a token or native ETH balance at execution time.
 *
 * @example
 * ```ts
 * // Full WETH balance with minimum constraint
 * balance({ token: WETH, account }).gte(parseEther('0.01'))
 *
 * // Native ETH balance
 * balance({ native: true, account })
 * ```
 */
export function balance(params: BalanceParams): DynamicParam<bigint> {
  const token = params.native ? zeroAddress : (params.token ?? zeroAddress)
  // BALANCE paramData = abi.encodePacked(address token, address account) → 40 bytes
  const fetcherData = encodePacked(['address', 'address'], [token, params.account])
  return createDynamic<bigint>('balance', fetcherData)
}

// ────────────────────────────────────────────────────────────
// staticRead() — STATIC_CALL fetcher
// ────────────────────────────────────────────────────────────

export type StaticReadParams<
  abi extends Abi = Abi,
  functionName extends string = string,
  args extends readonly unknown[] = readonly unknown[],
> = {
  to: Address
  abi: abi
  functionName: functionName
  args: args
}

/**
 * Read any on-chain state via staticcall at execution time.
 *
 * @example
 * ```ts
 * // Read Aave borrow capacity via lens contract
 * staticRead({
 *   to: AAVE_LENS,
 *   abi: aaveLensAbi,
 *   functionName: 'getSafeBorrowAmount',
 *   args: [AAVE_POOL, account, 6, 80n, 100n],
 * }).gte(minBorrow)
 * ```
 */
export function staticRead<
  const abi extends Abi,
  functionName extends string,
  args extends readonly unknown[],
>(params: StaticReadParams<abi, functionName, args>): DynamicParam<bigint> {
  const callData = encodeFunctionData({
    abi: params.abi,
    functionName: params.functionName as any,
    args: params.args as any,
  })
  // STATIC_CALL paramData = abi.encode(address contractAddr, bytes callData)
  const fetcherData = encodeAbiParameters(
    [{ type: 'address' }, { type: 'bytes' }],
    [params.to, callData],
  )
  return createDynamic<bigint>('staticCall', fetcherData)
}

// ────────────────────────────────────────────────────────────
// fromStorage() — Sugar for reading from Storage contract
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

/**
 * Read a previously captured value from the Storage contract.
 * Computes namespace and derived slot automatically.
 *
 * @example
 * ```ts
 * fromStorage({
 *   storage: STORAGE_CONTRACT,
 *   account: myAccount,
 *   caller: MODULE_ADDRESS,
 *   slot: toBytes32('swap_result'),
 *   index: 0,
 * })
 * ```
 */
export function fromStorage(params: StorageReadParams): DynamicParam<bigint> {
  const namespace = encodePacked(['address', 'address'], [params.account, params.caller])
  // Derive the actual slot: keccak256(abi.encodePacked(baseSlot, uint256(index)))
  // We use encodePacked to match the Solidity implementation
  const derivedSlot = encodePacked(['bytes32', 'uint256'], [params.slot, BigInt(params.index)])

  return staticRead({
    to: params.storage,
    abi: STORAGE_ABI,
    functionName: 'readStorage',
    args: [namespace, derivedSlot],
  })
}
