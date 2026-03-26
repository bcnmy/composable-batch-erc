import {
  type Abi,
  type Address,
  type Hex,
  encodeFunctionData,
  encodeAbiParameters,
} from 'viem'
import { type DynamicParam, type MaybeDynamic } from './types.js'
import { createDynamic } from './params.js'
import { encodeStep } from './encode.js'
import type { ComposableExecution } from './types.js'

// ────────────────────────────────────────────────────────────
// StepDescriptor — opaque wrapper around ComposableExecution
// ────────────────────────────────────────────────────────────

export interface StepDescriptor {
  /** @internal */
  readonly __encoded: ComposableExecution
}

// ────────────────────────────────────────────────────────────
// BoundContract — contract with address + ABI bound
// ────────────────────────────────────────────────────────────

export interface BoundContract<abi extends Abi = Abi> {
  readonly address: Address
  readonly abi: abi

  /**
   * Create a state-changing call step.
   * Returns a StepDescriptor for batch.add().
   *
   * @example
   * ```ts
   * aave.call('supply', [WETH, weth.balance(), account, 0])
   * ```
   */
  call(functionName: string, args: readonly unknown[]): StepDescriptor

  /**
   * Create a runtime read (STATIC_CALL fetcher).
   * Returns a DynamicParam for injection into other call args.
   *
   * @example
   * ```ts
   * lens.read('getHealthFactor', [pool, account]).gte(parseEther('1.5'))
   * ```
   */
  read(functionName: string, args: readonly unknown[]): DynamicParam<bigint>
}

/**
 * Bind a contract address and ABI for reuse.
 *
 * @example
 * ```ts
 * const aave = contract(AAVE_POOL, aavePoolAbi)
 * batch.add(aave, 'supply', [...])          // form 2
 * batch.add(aave.call('supply', [...]))     // form 1
 * lens.read('getHealthFactor', [...]).gte(min)  // dynamic param
 * ```
 */
export function contract<const abi extends Abi>(
  address: Address,
  abi: abi,
): BoundContract<abi> {
  return {
    address,
    abi,

    call(functionName: string, args: readonly unknown[]): StepDescriptor {
      return {
        __encoded: encodeStep({
          to: address,
          abi: abi as Abi,
          functionName,
          args,
        }),
      }
    },

    read(functionName: string, args: readonly unknown[]): DynamicParam<bigint> {
      const callData = encodeFunctionData({
        abi: abi as Abi,
        functionName: functionName as any,
        args: args as any,
      })
      const fetcherData = encodeAbiParameters(
        [{ type: 'address' }, { type: 'bytes' }],
        [address, callData],
      )
      return createDynamic<bigint>('staticCall', fetcherData)
    },
  }
}
