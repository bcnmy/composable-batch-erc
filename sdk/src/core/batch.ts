import {
  type Abi,
  type Address,
  type Hex,
  parseAbi,
} from 'viem'
import {
  type ComposableExecution,
  type DynamicParam,
  type ConstrainedParam,
  type MaybeDynamic,
} from './types.js'
import { encodeStep, encodePredicate } from './encode.js'
import type { BoundContract, StepDescriptor } from './contract.js'
import type { BoundToken } from './token.js'

// ────────────────────────────────────────────────────────────
// Batch config
// ────────────────────────────────────────────────────────────

export type BatchConfig = {
  account: Address
  chainId?: number
  weth?: Address
}

type StepEntry = {
  type: 'step' | 'predicate'
  encoded: ComposableExecution
}

// ────────────────────────────────────────────────────────────
// Batch builder
// ────────────────────────────────────────────────────────────

export class BatchBuilder {
  private readonly _steps: StepEntry[] = []
  private readonly _config: BatchConfig

  constructor(config: BatchConfig) {
    this._config = config
  }

  // ── add() — two overloads ─────────────────────────────────

  /** Form 1: add a pre-built step descriptor */
  add(step: StepDescriptor): this

  /** Form 2: contract + function name + args (viem-style) */
  add<const abi extends Abi, functionName extends string>(
    target: BoundContract<abi>,
    functionName: functionName,
    args: readonly unknown[],
  ): this

  /** Implementation */
  add(
    stepOrContract: StepDescriptor | BoundContract<any>,
    functionName?: string,
    args?: readonly unknown[],
  ): this {
    let encoded: ComposableExecution

    if (functionName !== undefined && args !== undefined) {
      // Form 2: contract + fn + args
      const ct = stepOrContract as BoundContract<any>
      encoded = ct.call(functionName, args as any).__encoded
    } else {
      // Form 1: pre-built step
      encoded = (stepOrContract as StepDescriptor).__encoded
    }

    this._steps.push({ type: 'step', encoded })
    return this
  }

  // ── check() — predicate entry ────────────────────────────

  check(...conditions: ConstrainedParam[]): this {
    this._steps.push({ type: 'predicate', encoded: encodePredicate(conditions) })
    return this
  }

  // ── Convenience shortcuts ────────────────────────────────

  approve(token: BoundToken, spender: Address, amount: bigint | DynamicParam<bigint>): this {
    return this.add(approve(token, spender, amount))
  }

  wrap(amount: bigint | DynamicParam<bigint>): this {
    return this.add(wrap(this._config.weth!, amount))
  }

  transfer(token: BoundToken, to: Address, amount: bigint | DynamicParam<bigint>): this {
    return this.add(transfer(token, to, amount))
  }

  // ── Output ───────────────────────────────────────────────

  encode(): ComposableExecution[] {
    return this._steps.map((s) => s.encoded)
  }

  toCalldata(): Hex {
    throw new Error('TODO: implement full ABI encoding of ComposableExecution[]')
  }

  get length(): number { return this._steps.length }
  get account(): Address { return this._config.account }
  get chainId(): number | undefined { return this._config.chainId }
}

// ────────────────────────────────────────────────────────────
// Factory
// ────────────────────────────────────────────────────────────

export function composableBatch(config: BatchConfig): BatchBuilder {
  return new BatchBuilder(config)
}

// ────────────────────────────────────────────────────────────
// Standalone action functions (tree-shakable)
// ────────────────────────────────────────────────────────────

/** Standalone ERC-20 approve step */
export function approve(
  token: BoundToken,
  spender: Address,
  amount: bigint | DynamicParam<bigint>,
): StepDescriptor {
  const abi = parseAbi(['function approve(address spender, uint256 amount) returns (bool)'])
  return {
    __encoded: encodeStep({
      to: token.address,
      abi,
      functionName: 'approve',
      args: [spender, amount],
    }),
  }
}

/** Standalone WETH wrap step */
export function wrap(
  weth: Address,
  amount: bigint | DynamicParam<bigint>,
): StepDescriptor {
  const abi = parseAbi(['function deposit() payable'])
  return {
    __encoded: encodeStep({
      to: weth,
      abi,
      functionName: 'deposit',
      args: [],
      value: amount,
    }),
  }
}

/** Standalone ERC-20 transfer step */
export function transfer(
  token: BoundToken,
  to: Address,
  amount: bigint | DynamicParam<bigint>,
): StepDescriptor {
  const abi = parseAbi(['function transfer(address to, uint256 amount) returns (bool)'])
  return {
    __encoded: encodeStep({
      to: token.address,
      abi,
      functionName: 'transfer',
      args: [to, amount],
    }),
  }
}
