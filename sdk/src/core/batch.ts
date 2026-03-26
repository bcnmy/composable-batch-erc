import {
  type Abi,
  type Address,
  type Hex,
  encodeAbiParameters,
  parseAbi,
} from 'viem'
import {
  type ComposableExecution,
  type DynamicParam,
  type ConstrainedParam,
  type MaybeDynamic,
  type StepParams,
  type CaptureParams,
  type OutputParam,
  OutputParamFetcherType,
} from './types.js'
import { encodeStep, encodePredicate } from './encode.js'
import { balance } from './params.js'

// ────────────────────────────────────────────────────────────
// Batch builder
// ────────────────────────────────────────────────────────────

export type BatchConfig = {
  account: Address
  chainId?: number
  /** WETH address for wrap/unwrap helpers. */
  weth?: Address
}

type StepDescriptor = {
  type: 'step' | 'predicate'
  encoded: ComposableExecution
}

/**
 * Build a composable batch step-by-step.
 *
 * @example
 * ```ts
 * const batch = composableBatch({ account })
 *   .step({ to: pool, abi, functionName: 'supply', args: [token, balance({ token, account }), account, 0] })
 *   .predicate(staticRead({ ... }).gte(minHealthFactor))
 *
 * const calldata = batch.toCalldata()
 * ```
 */
export class BatchBuilder {
  private readonly _steps: StepDescriptor[] = []
  private readonly _config: BatchConfig

  constructor(config: BatchConfig) {
    this._config = config
  }

  // ── Generic step ─────────────────────────────────────────

  step<
    const abi extends Abi,
    functionName extends string,
    args extends readonly unknown[],
  >(params: {
    to: Address | DynamicParam<Address>
    abi: abi
    functionName: functionName
    args: MaybeDynamic<args>
    value?: bigint | DynamicParam<bigint>
  }): this {
    const encoded = encodeStep({
      to: params.to as Address | DynamicParam<Address>,
      abi: params.abi as Abi,
      functionName: params.functionName,
      args: params.args as readonly unknown[],
      value: params.value as bigint | DynamicParam<bigint> | undefined,
    })
    this._steps.push({ type: 'step', encoded })
    return this
  }

  // ── Predicate (condition check, no call) ─────────────────

  predicate(...conditions: ConstrainedParam[]): this {
    const encoded = encodePredicate(conditions)
    this._steps.push({ type: 'predicate', encoded })
    return this
  }

  // ── Convenience: ERC-20 approve ──────────────────────────

  approve(params: {
    token: Address
    spender: Address
    amount: bigint | DynamicParam<bigint>
  }): this {
    return this.step({
      to: params.token,
      abi: parseAbi(['function approve(address spender, uint256 amount) returns (bool)']),
      functionName: 'approve',
      args: [params.spender, params.amount],
    })
  }

  // ── Convenience: WETH wrap ───────────────────────────────

  wrap(params: { value: bigint | DynamicParam<bigint> }): this {
    const weth = this._config.weth
    if (!weth) throw new Error('Set `weth` in batch config to use wrap()')
    return this.step({
      to: weth,
      abi: parseAbi(['function deposit() payable']),
      functionName: 'deposit',
      args: [],
      value: params.value,
    })
  }

  // ── Convenience: WETH unwrap ─────────────────────────────

  unwrap(params: { amount: bigint | DynamicParam<bigint> }): this {
    const weth = this._config.weth
    if (!weth) throw new Error('Set `weth` in batch config to use unwrap()')
    return this.step({
      to: weth,
      abi: parseAbi(['function withdraw(uint256 amount)']),
      functionName: 'withdraw',
      args: [params.amount],
    })
  }

  // ── Convenience: ERC-20 transfer ─────────────────────────

  transfer(params: {
    token: Address
    to: Address
    amount: bigint | DynamicParam<bigint>
  }): this {
    return this.step({
      to: params.token,
      abi: parseAbi(['function transfer(address to, uint256 amount) returns (bool)']),
      functionName: 'transfer',
      args: [params.to, params.amount],
    })
  }

  // ── Output ───────────────────────────────────────────────

  /** Get the encoded ComposableExecution array. */
  encode(): ComposableExecution[] {
    return this._steps.map((s) => s.encoded)
  }

  /** ABI-encode the full batch as calldata for executeComposable(). */
  toCalldata(): Hex {
    const executions = this.encode()
    // This would use the full ComposableExecution[] ABI encoding
    // For now, return a placeholder — real implementation uses
    // encodeAbiParameters with the ComposableExecution struct array
    return encodeComposableExecutions(executions)
  }

  // ── Inspection ───────────────────────────────────────────

  get steps(): readonly StepDescriptor[] {
    return this._steps
  }

  get length(): number {
    return this._steps.length
  }

  get account(): Address {
    return this._config.account
  }

  get chainId(): number | undefined {
    return this._config.chainId
  }
}

// ────────────────────────────────────────────────────────────
// Factory
// ────────────────────────────────────────────────────────────

export function composableBatch(config: BatchConfig): BatchBuilder {
  return new BatchBuilder(config)
}

// ────────────────────────────────────────────────────────────
// ABI encoding of ComposableExecution[]
// (Matches the on-chain IComposableExecution.executeComposable)
// ────────────────────────────────────────────────────────────

function encodeComposableExecutions(executions: ComposableExecution[]): Hex {
  // The full ABI type for ComposableExecution[]
  // This maps to: abi.encode(ComposableExecution[])
  // which is how the on-chain function receives it
  //
  // Real implementation: use viem's encodeAbiParameters with
  // the full nested struct definition. Stubbed here for clarity.
  throw new Error('TODO: implement full ABI encoding of ComposableExecution[]')
}
