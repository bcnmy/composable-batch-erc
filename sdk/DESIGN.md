# SDK Design: Smart Batching TypeScript SDK

## Design Principles

1. **Viem-native** — extends viem clients via `.extend()`, reuses viem types (`Address`, `Hex`, `Abi`)
2. **Type-safe** — ABI-inferred argument types, compile-time errors for wrong args
3. **Dynamic params as first-class citizens** — `balance()` and `staticRead()` are drop-in replacements for literal values
4. **Constraints are fluent** — `.gte(minAmount)` chains naturally onto dynamic params
5. **Structs flatten transparently** — when a function takes a struct with a dynamic field, the SDK flattens it into individual `InputParam` entries automatically
6. **Encoding is invisible** — developers write familiar `{ to, abi, functionName, args }` calls; the SDK produces `ComposableExecution[]` calldata under the hood

## Developer Experience: The Leverage Loop

This is what a developer writes to build our demo:

```typescript
import { composableBatch, balance, staticRead } from '@erc-xxxx/sdk'
import { aavePoolAbi, aaveLensAbi, erc20Abi, wethAbi, swapRouterAbi } from './abis'

const batch = composableBatch({ account, chainId: 8453 })

// ── Setup ──────────────────────────────────────────────────
batch.wrap({
  value: balance({ native: true, account }),
})

batch.approve({
  token: WETH,
  spender: AAVE_POOL,
  amount: balance({ token: WETH, account }),
})

// ── Loop N times ───────────────────────────────────────────
for (let i = 0; i < loopCount; i++) {
  if (i > 0) {
    batch.approve({
      token: WETH,
      spender: AAVE_POOL,
      amount: balance({ token: WETH, account }),
    })
  }

  batch.step({
    to: AAVE_POOL,
    abi: aavePoolAbi,
    functionName: 'supply',
    args: [
      WETH,
      balance({ token: WETH, account }).gte(1n),
      account,
      0,
    ],
  })

  batch.step({
    to: AAVE_POOL,
    abi: aavePoolAbi,
    functionName: 'borrow',
    args: [
      USDC,
      staticRead({
        to: AAVE_LENS,
        abi: aaveLensAbi,
        functionName: 'getSafeBorrowAmount',
        args: [AAVE_POOL, account, 6, 80n, 100n],
      }).gte(1n),
      2n,
      0,
      account,
    ],
  })

  batch.approve({
    token: USDC,
    spender: SWAP_ROUTER,
    amount: balance({ token: USDC, account }),
  })

  batch.step({
    to: SWAP_ROUTER,
    abi: swapRouterAbi,
    functionName: 'exactInputSingle',
    args: [{
      tokenIn: USDC,
      tokenOut: WETH,
      fee: 3000,
      recipient: account,
      amountIn: balance({ token: USDC, account }),
      amountOutMinimum: minWethOut,
      sqrtPriceLimitX96: 0n,
    }],
  })
}

// ── Final deposit + safety check ───────────────────────────
batch.step({
  to: AAVE_POOL,
  abi: aavePoolAbi,
  functionName: 'supply',
  args: [
    WETH,
    balance({ token: WETH, account }),
    account,
    0,
  ],
})

batch.predicate(
  staticRead({
    to: AAVE_LENS,
    abi: aaveLensAbi,
    functionName: 'getHealthFactor',
    args: [AAVE_POOL, account],
  }).gte(parseEther('1.5'))
)

// ── Execute ────────────────────────────────────────────────
const hash = await client.sendComposableBatch({ batch })
```

## Core API Surface

### Dynamic Parameter Constructors

```typescript
// ── balance() ──────────────────────────────────────────────
// Creates a BALANCE fetcher InputParam.
// Drop-in replacement for a bigint value in args.

function balance(params: {
  token?: Address   // ERC-20 address. Omit or pass zeroAddress for native ETH.
  native?: true     // Shorthand for token = address(0)
  account: Address  // Account whose balance to read
}): DynamicParam<bigint>

// ── staticRead() ───────────────────────────────────────────
// Creates a STATIC_CALL fetcher InputParam.
// Calls any view function and injects the return value.

function staticRead<
  const abi extends Abi,
  functionName extends ContractFunctionName<abi, 'view' | 'pure'>,
  args extends ContractFunctionArgs<abi, 'view' | 'pure', functionName>,
>(params: {
  to: Address
  abi: abi
  functionName: functionName
  args: args
}): DynamicParam<ContractFunctionReturnType<abi, 'view' | 'pure', functionName>>
```

### Constraints (Fluent)

```typescript
// Every DynamicParam exposes constraint methods that return
// a new DynamicParam with the constraint attached.

interface DynamicParam<T> {
  gte(value: T): ConstrainedParam<T>
  lte(value: T): ConstrainedParam<T>
  eq(value: T): ConstrainedParam<T>
  inRange(lower: T, upper: T): ConstrainedParam<T>

  // Internal — used by the encoder
  readonly __kind: 'balance' | 'staticCall'
  readonly __data: Hex
  readonly __constraints: Constraint[]
}
```

### Batch Builder

```typescript
function composableBatch(config: {
  account: Address
  chainId?: number
}): BatchBuilder

interface BatchBuilder {
  // ── Generic step ─────────────────────────────────────────
  step<
    const abi extends Abi,
    functionName extends ContractFunctionName<abi, 'nonpayable' | 'payable'>,
    args extends ContractFunctionArgs<abi, 'nonpayable' | 'payable', functionName>,
  >(params: {
    to: Address | DynamicParam<Address>
    abi: abi
    functionName: functionName
    args: MaybeDynamic<args>             // Each arg can be static or dynamic
    value?: bigint | DynamicParam<bigint>
  }): BatchBuilder

  // ── Predicate (no call, just check condition) ────────────
  predicate(...conditions: ConstrainedParam<any>[]): BatchBuilder

  // ── Convenience shortcuts ────────────────────────────────
  approve(params: {
    token: Address
    spender: Address
    amount: bigint | DynamicParam<bigint>
  }): BatchBuilder

  wrap(params: {
    value: bigint | DynamicParam<bigint>
  }): BatchBuilder

  unwrap(params: {
    amount: bigint | DynamicParam<bigint>
  }): BatchBuilder

  transfer(params: {
    token: Address
    to: Address
    amount: bigint | DynamicParam<bigint>
  }): BatchBuilder

  // ── Output ───────────────────────────────────────────────
  encode(): ComposableExecution[]
  toCalldata(): Hex                      // ABI-encoded ComposableExecution[]

  // ── Inspection ───────────────────────────────────────────
  readonly steps: readonly StepDescriptor[]
  readonly length: number
}
```

### Viem Client Extension

```typescript
import type { Client, Transport, Chain, Account, Hash } from 'viem'

function composableActions<
  transport extends Transport = Transport,
  chain extends Chain | undefined = Chain | undefined,
  account extends Account | undefined = Account | undefined,
>(client: Client<transport, chain, account>) {
  return {
    sendComposableBatch: (params: {
      batch: BatchBuilder
    }) => Promise<Hash>,

    simulateComposableBatch: (params: {
      batch: BatchBuilder
    }) => Promise<SimulationResult>,
  }
}

// Usage:
const client = createWalletClient({ ... })
  .extend(composableActions)

const hash = await client.sendComposableBatch({ batch })
```

## Type System: How Dynamic Params Work

The key insight: where the ABI says `uint256`, the developer can pass either `bigint` (static) or `DynamicParam<bigint>` (resolved at runtime). The SDK's type system accepts both.

```typescript
// ── Core branded type ──────────────────────────────────────
const DYNAMIC = Symbol('dynamic')

interface DynamicParam<T = unknown> {
  readonly [DYNAMIC]: true
  readonly __kind: 'balance' | 'staticCall'
  readonly __fetcherData: Hex
  readonly __constraints: ConstraintDescriptor[]

  gte(ref: bigint): ConstrainedParam<T>
  lte(ref: bigint): ConstrainedParam<T>
  eq(ref: bigint): ConstrainedParam<T>
  inRange(lower: bigint, upper: bigint): ConstrainedParam<T>
}

interface ConstrainedParam<T = unknown> extends DynamicParam<T> {}

function isDynamic(value: unknown): value is DynamicParam {
  return typeof value === 'object' && value !== null && DYNAMIC in value
}

// ── MaybeDynamic: makes each element of a tuple optionally dynamic ──
type MaybeDynamic<T extends readonly unknown[]> = {
  [K in keyof T]: T[K] | DynamicParam<T[K]>
}
```

## Encoding: How Steps Become ComposableExecution[]

When `encode()` is called, each step goes through this pipeline:

```
Step { to, abi, functionName, args, value }
  │
  ▼
1. Extract function selector from ABI
  │
  ▼
2. Walk each arg:
   ├── Static value → InputParam { paramType: CALL_DATA, fetcherType: RAW_BYTES }
   ├── DynamicParam (balance) → InputParam { paramType: CALL_DATA, fetcherType: BALANCE }
   └── DynamicParam (staticCall) → InputParam { paramType: CALL_DATA, fetcherType: STATIC_CALL }
  │
  ▼
3. Handle `to`:
   ├── Static address → InputParam { paramType: TARGET, fetcherType: RAW_BYTES }
   └── DynamicParam → InputParam { paramType: TARGET, fetcherType: STATIC_CALL }
  │
  ▼
4. Handle `value`:
   ├── Static bigint → InputParam { paramType: VALUE, fetcherType: RAW_BYTES }
   ├── DynamicParam → InputParam { paramType: VALUE, fetcherType: BALANCE }
   └── Undefined → (omit, defaults to 0)
  │
  ▼
5. Attach constraints from each DynamicParam
  │
  ▼
ComposableExecution { functionSig, inputParams[], outputParams[] }
```

### Struct Flattening

When an ABI argument is a tuple (struct), the SDK inspects each field:

```typescript
// ABI: function exactInputSingle((address,address,uint24,address,uint256,uint256,uint160))
// User passes: args: [{ tokenIn, tokenOut, fee, recipient, amountIn: balance(...), ... }]

function flattenArg(arg: unknown, abiType: AbiParameter): InputParam[] {
  if (abiType.type === 'tuple' && typeof arg === 'object') {
    // Flatten struct fields into individual InputParams
    return abiType.components.map((component, i) => {
      const fieldValue = (arg as Record<string, unknown>)[component.name!]
      return toInputParam(fieldValue, component)
    })
  }
  // Scalar: single InputParam
  return [toInputParam(arg, abiType)]
}

function toInputParam(value: unknown, abiType: AbiParameter): InputParam {
  if (isDynamic(value)) {
    return {
      paramType: InputParamType.CALL_DATA,
      fetcherType: value.__kind === 'balance'
        ? InputParamFetcherType.BALANCE
        : InputParamFetcherType.STATIC_CALL,
      paramData: value.__fetcherData,
      constraints: value.__constraints.map(encodeConstraint),
    }
  }
  return {
    paramType: InputParamType.CALL_DATA,
    fetcherType: InputParamFetcherType.RAW_BYTES,
    paramData: encodeAbiParameters([abiType], [value]),
    constraints: [],
  }
}
```

### Predicate Encoding

```typescript
// batch.predicate(condition1, condition2, ...)
// → ComposableExecution with no TARGET, functionSig = 0x00000000

function encodePredicate(conditions: ConstrainedParam[]): ComposableExecution {
  return {
    functionSig: '0x00000000',
    inputParams: conditions.map(c => ({
      paramType: InputParamType.CALL_DATA,
      fetcherType: c.__kind === 'balance'
        ? InputParamFetcherType.BALANCE
        : InputParamFetcherType.STATIC_CALL,
      paramData: c.__fetcherData,
      constraints: c.__constraints.map(encodeConstraint),
    })),
    outputParams: [],
  }
}
```

## Storage: Capture and Read (Advanced)

For flows that need return value passing between steps:

```typescript
// Capture return values from a step
const swapStep = batch.step({
  to: router,
  abi: routerAbi,
  functionName: 'swap',
  args: [...],
}).capture({
  storage: STORAGE_CONTRACT,
  slot: toBytes32('swap_result'),
  count: 2,  // capture 2 return values
})

// Read captured values in a later step
batch.step({
  to: otherContract,
  abi: otherAbi,
  functionName: 'doSomething',
  args: [
    fromStorage({
      storage: STORAGE_CONTRACT,
      account,
      caller: MODULE_ADDRESS,  // for namespace derivation
      slot: toBytes32('swap_result'),
      index: 0,                // which captured word
    }),
  ],
})
```

`fromStorage()` is syntactic sugar — it creates a `staticRead()` that calls `Storage.readStorage(namespace, derivedSlot)` with the correct namespace and slot derivation.

## Convenience Layer: Common DeFi Operations

Pre-built helpers for frequent patterns:

```typescript
import { aave, uniswap, erc20 } from '@erc-xxxx/sdk/protocols'

const batch = composableBatch({ account, chainId: 8453 })

// These expand to the correct step() calls with proper ABIs
batch.add(erc20.approve(WETH, AAVE_POOL, balance({ token: WETH, account })))
batch.add(aave.supply(AAVE_POOL, WETH, balance({ token: WETH, account })))
batch.add(aave.borrow(AAVE_POOL, USDC, borrowAmount))
batch.add(uniswap.exactInputSingle({
  router: SWAP_ROUTER,
  tokenIn: USDC,
  tokenOut: WETH,
  fee: 3000,
  recipient: account,
  amountIn: balance({ token: USDC, account }),
  amountOutMinimum: minOut,
}))
batch.add(aave.healthFactorCheck(AAVE_LENS, AAVE_POOL, account, parseEther('1.5')))
```

These protocol helpers are optional — power users use `step()` directly with any ABI.

## Package Structure

```
@erc-xxxx/sdk
├── core/
│   ├── batch.ts           # composableBatch(), BatchBuilder
│   ├── params.ts          # balance(), staticRead(), fromStorage()
│   ├── constraints.ts     # gte(), lte(), eq(), inRange()
│   ├── encode.ts          # Step → ComposableExecution[] encoding
│   └── types.ts           # DynamicParam, ConstrainedParam, MaybeDynamic
├── viem/
│   ├── actions.ts         # composableActions client extension
│   └── index.ts           # Re-export for viem users
├── protocols/
│   ├── aave.ts            # Aave V3 helpers
│   ├── uniswap.ts         # Uniswap V3 helpers
│   ├── erc20.ts           # approve, transfer helpers
│   └── weth.ts            # wrap, unwrap helpers
└── index.ts               # Main entry point
```

## Open Questions

1. **Should `batch.step()` be mutable or immutable?** Mutable (shown above) is simpler for loops. Immutable (returns new builder) is safer. Could support both: `batch.step()` mutates, `batch.with()` returns new.

2. **How to handle dynamic types (bytes, string, dynamic arrays) in args?** Current design assumes each CALL_DATA param is a 32-byte word. Dynamic Solidity types break this. For now: dynamic types must be RAW_BYTES (static at signing time). Document this limitation.

3. **Should convenience helpers (`approve`, `wrap`, `transfer`) live on BatchBuilder or be standalone functions?** Both work. Builder methods are more discoverable. Standalone functions are more composable and tree-shakable.

4. **Simulation API** — `simulateComposableBatch` should use `eth_call` to dry-run the batch and return: which steps succeeded, which constraints would fail, estimated gas. This is how relayers decide when to submit.

5. **Multi-chain batches** — future SDK version could support `composableMultiChainBatch()` that generates Merkle trees + predicate-gated batches per chain. Depends on the companion cross-chain ERC.
