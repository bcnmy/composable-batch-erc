import {
  type Abi,
  type Address,
  type Hex,
  encodeFunctionData,
  encodeAbiParameters,
} from 'viem'
import { type DynamicParam, type OutputParam, OutputParamFetcherType } from './types.js'
import type { ComposableExecution } from './types.js'
import { createDynamic } from './params.js'
import { encodeStep } from './encode.js'
import type { CaptureConfig } from './storage.js'

// ────────────────────────────────────────────────────────────
// StepDescriptor — opaque wrapper around ComposableExecution
// ────────────────────────────────────────────────────────────

export interface StepDescriptor {
  /** @internal */
  readonly __encoded: ComposableExecution
}

// ────────────────────────────────────────────────────────────
// CallOptions — optional config for contract.call()
// ────────────────────────────────────────────────────────────

export interface CallOptions {
  /** ETH to forward with the call. */
  value?: bigint | DynamicParam<bigint>
  /** Capture return values to Storage. */
  capture?: CaptureConfig
}

// ────────────────────────────────────────────────────────────
// BoundContract — contract with address + ABI bound
// ────────────────────────────────────────────────────────────

export interface BoundContract<abi extends Abi = Abi> {
  readonly address: Address
  readonly abi: abi

  /**
   * Create a state-changing call step.
   *
   * @example
   * ```ts
   * aave.call('supply', [WETH, weth.balance(), account, 0])
   * aave.call('swap', args, { capture: store.capture('0x01', 2) })
   * ```
   */
  call(functionName: string, args: readonly unknown[], options?: CallOptions): StepDescriptor

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
 * batch.add(aave, 'supply', [...])
 * batch.add(aave.call('supply', [...]))
 * batch.add(aave.call('swap', args, { capture: store.capture('0x01', 2) }))
 * lens.read('getHealthFactor', [...]).gte(min)
 * ```
 */
export function contract<const abi extends Abi>(
  address: Address,
  abi: abi,
): BoundContract<abi> {
  return {
    address,
    abi,

    call(functionName: string, args: readonly unknown[], options?: CallOptions): StepDescriptor {
      const outputParams: OutputParam[] = []

      if (options?.capture) {
        const { storage, slot, count } = options.capture
        outputParams.push({
          fetcherType: OutputParamFetcherType.EXEC_RESULT,
          paramData: encodeAbiParameters(
            [{ type: 'uint256' }, { type: 'address' }, { type: 'bytes32' }],
            [BigInt(count), storage, slot],
          ),
        })
      }

      return {
        __encoded: encodeStep({
          to: address,
          abi: abi as Abi,
          functionName,
          args,
          value: options?.value,
          outputParams,
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
