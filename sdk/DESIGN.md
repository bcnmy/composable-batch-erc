# SDK Specification

> TypeScript SDK for the Smart Batching ERC. Viem-native. Zero new primitives to learn.

## Peer Dependencies

```json
{ "viem": "^2.0.0" }
```

All types (`Address`, `Hex`, `Abi`), encoding functions (`encodeAbiParameters`, `encodePacked`, `encodeFunctionData`, `keccak256`), and client types (`Client`, `Transport`, `Chain`) come from viem. The SDK does not re-export or duplicate them.

---

## 1. Binding: `token`, `native`, `contract`

Bindings capture addresses and ABIs once. Every subsequent call reuses them.

```typescript
import { token, native, contract } from '@erc-xxxx/sdk'

const weth   = token(WETH, account)        // BoundToken — carries token address + account
const usdc   = token(USDC, account)
const eth    = native(account)              // BoundToken — native ETH (address(0) + account)

const aave   = contract(AAVE_POOL, aavePoolAbi)   // BoundContract — carries address + ABI
const lens   = contract(COMPOSABLE_LENS, lensAbi)
const router = contract(SWAP_ROUTER, routerAbi)
```

### `token(address: Address, account: Address): BoundToken`

```typescript
interface BoundToken {
  readonly address: Address
  balance(): DynamicParam<bigint>   // BALANCE fetcher — runtime token balance
}
```

### `native(account: Address): BoundToken`

Same interface. Uses `address(0)` sentinel for native ETH.

### `contract<const abi extends Abi>(address: Address, abi: abi): BoundContract<abi>`

```typescript
interface BoundContract<abi extends Abi> {
  readonly address: Address
  readonly abi: abi
  call(functionName: string, args: readonly unknown[]): StepDescriptor
  read(functionName: string, args: readonly unknown[]): DynamicParam<bigint>
}
```

- `.call()` → produces a `StepDescriptor` (one `ComposableExecution` entry)
- `.read()` → produces a `DynamicParam` (STATIC_CALL fetcher, drop-in for any arg)

---

## 2. Dynamic Parameters

A `DynamicParam<T>` is a value resolved on-chain at execution time. It can be used anywhere a static value of type `T` is expected in `args`.

### Sources

| Source | SDK | On-chain encoding |
|--------|-----|-------------------|
| Token/ETH balance | `weth.balance()` | `InputParam { fetcherType: BALANCE, paramData: encodePacked(token, account) }` |
| Any view function | `lens.read('fn', args)` | `InputParam { fetcherType: STATIC_CALL, paramData: encode(address, calldata) }` |
| Storage value | `fromStorage({ ... })` | `InputParam { fetcherType: STATIC_CALL }` calling `Storage.readStorage(namespace, slot)` |
| Static value | `100n` (literal) | `InputParam { fetcherType: RAW_BYTES, paramData: encode(value) }` |

### Constraints (fluent, immutable)

Every `DynamicParam` exposes constraint methods. Each returns a new `ConstrainedParam` (does not mutate):

```typescript
weth.balance().gte(parseEther('0.01'))        // value >= 0.01 ETH
usdc.balance().lte(parseUnits('1000', 6))     // value <= 1000 USDC
lens.read('fn', args).eq(42n)                 // value == 42
lens.read('fn', args).inRange(10n, 100n)      // 10 <= value <= 100
```

Mapping to on-chain: each `.gte()` / `.lte()` / `.eq()` / `.inRange()` appends a `Constraint` struct to the `InputParam.constraints[]` array. Multiple constraints on one param are AND-composed.

### `MaybeDynamic<T>` — the type-level magic

When a function's ABI says `args = [address, uint256, address]`, the SDK accepts `[Address | DynamicParam<Address>, bigint | DynamicParam<bigint>, Address | DynamicParam<Address>]`. This is handled by the `MaybeDynamic` mapped type, which recursively makes each tuple element accept its static type OR a `DynamicParam` of that type. For struct (tuple) args, it maps each field the same way.

---

## 3. Batch Builder

```typescript
import { composableBatch } from '@erc-xxxx/sdk'

const batch = composableBatch({ account, chainId: 8453, weth: WETH })
```

### `batch.add()` — three forms

```typescript
// Form 1: pre-built step (from standalone function or contract.call())
batch.add(approve(weth, AAVE_POOL, weth.balance()))
batch.add(aave.call('supply', [WETH, weth.balance(), account, 0]))

// Form 2: contract + function name + args (viem-style, no .call())
batch.add(aave, 'supply', [WETH, weth.balance(), account, 0])
```

Both forms are type-safe. Form 2 uses TypeScript overloads to infer `args` types from the ABI.

**Implementation:**

```typescript
class BatchBuilder {
  add(step: StepDescriptor): this
  add<const abi extends Abi, fn extends ContractFunctionName<abi>>(
    target: BoundContract<abi>,
    functionName: fn,
    args: MaybeDynamic<ContractFunctionArgs<abi, 'nonpayable' | 'payable', fn>>
  ): this
}
```

### `batch.check()` — predicate entry

```typescript
batch.check(lens.read('getHealthFactor', [pool, account]).gte(parseEther('1.5')))
batch.check(weth.balance().gte(1n), usdc.balance().eq(0n))  // multiple = AND
```

Creates a `ComposableExecution` with no `TARGET` InputParam → `target = address(0)` → call skipped → constraints still evaluated. Position in the batch determines pre vs post condition.

### Convenience shortcuts + standalone functions

Shortcuts exist as both methods on `BatchBuilder` and standalone tree-shakable functions:

```typescript
import { approve, wrap, unwrap, transfer } from '@erc-xxxx/sdk'

// As standalone (tree-shakable, composable):
batch.add(approve(weth, AAVE_POOL, weth.balance()))
batch.add(wrap(WETH_ADDRESS, eth.balance()))

// As method (discoverable via autocomplete):
batch.approve(weth, AAVE_POOL, weth.balance())
batch.wrap(eth.balance())
batch.transfer(usdc, recipient, usdc.balance())
```

### Output

```typescript
batch.encode()       // ComposableExecution[] — for inspection or custom submission
batch.toCalldata()   // Hex — ABI-encoded for executeComposable(ComposableExecution[])
batch.length         // number of entries
batch.account        // Address
batch.chainId        // number | undefined
```

---

## 4. Struct Flattening

When an ABI argument is a `tuple` (Solidity struct) and the user passes an object, the encoder flattens each field into a separate `InputParam`. This allows individual struct fields to be dynamic.

```typescript
batch.add(router, 'exactInputSingle', [{
  tokenIn: USDC,
  tokenOut: WETH,
  fee: 3000,
  recipient: account,
  amountIn: usdc.balance(),    // ← dynamic field
  amountOutMinimum: minOut,
  sqrtPriceLimitX96: 0n,
}])
```

Each field becomes its own `CALL_DATA` InputParam. Static fields use `RAW_BYTES`, dynamic fields use `BALANCE` or `STATIC_CALL`. The concatenation produces identical calldata to standard ABI encoding for the struct.

**Limitation:** Only works for structs where all fields are static ABI types (uint, address, bool, bytesN). Structs containing `bytes`, `string`, or dynamic arrays cannot be flattened — use `RAW_BYTES` for the entire struct in those cases.

---

## 5. Storage: Capture and Read

For flows that need return value passing between steps (when balance reads aren't sufficient):

```typescript
import { fromStorage } from '@erc-xxxx/sdk'

// In a later step, read back a previously captured value:
const capturedAmount = fromStorage({
  storage: STORAGE_CONTRACT,
  account: myAccount,
  caller: MODULE_ADDRESS,
  slot: '0x...baseSlot',
  index: 0,           // which captured word
})

batch.add(someContract, 'doSomething', [capturedAmount.gte(minAmount)])
```

`fromStorage()` computes `keccak256(account, caller)` for namespace and `keccak256(baseSlot, uint256(index))` for the derived slot, matching [Storage.sol](../contracts/Storage.sol) exactly.

---

## 6. Viem Client Extension

```typescript
import { composableActions } from '@erc-xxxx/sdk/viem'

const client = createWalletClient({ chain: base, transport: http() })
  .extend(composableActions)

// Send via smart account (ERC-4337 / ERC-7702)
const hash = await client.sendComposableBatch({ batch })

// Simulate via eth_call
const sim = await client.simulateComposableBatch({ batch })
// → { success: boolean, failingStep: number, error?: string, gasEstimate: bigint }
```

`composableActions` follows viem's decorator pattern: `(client) => { method: (args) => fn(client, args) }`. Each action is a standalone function that takes `client` as the first argument, enabling tree-shaking and `getAction` override resolution.

---

## 7. Encoding Pipeline

When `batch.encode()` is called, each step passes through:

```
StepDescriptor
  │
  ├─ TARGET:  address → InputParam { paramType: TARGET, fetcherType: RAW_BYTES }
  │           DynamicParam → InputParam { paramType: TARGET, fetcherType: STATIC_CALL }
  │
  ├─ VALUE:   bigint → InputParam { paramType: VALUE, fetcherType: RAW_BYTES }
  │           DynamicParam → InputParam { paramType: VALUE, fetcherType: BALANCE|STATIC_CALL }
  │
  ├─ ARGS:    For each arg, guided by ABI:
  │           ├─ scalar static → InputParam { paramType: CALL_DATA, fetcherType: RAW_BYTES }
  │           ├─ DynamicParam → InputParam { paramType: CALL_DATA, fetcherType: BALANCE|STATIC_CALL }
  │           └─ tuple object → recurse: flatten each field into separate InputParams
  │
  └─ OUTPUT:  selector + inputParams[] + outputParams[] = ComposableExecution
```

**Validation rules (enforced by encoder):**
- At most one `TARGET` InputParam per entry (contract enforces this too)
- At most one `VALUE` InputParam per entry
- `BALANCE` fetcher cannot be used with `TARGET` paramType
- Tuple flattening only for static-type tuples

---

## 8. Lens Contracts

Two tiers of lens contracts provide the "read + compute" bridge that STATIC_CALL fetchers need.

### Tier 1: `ComposableLens` (generic, ships with the standard)

Handles 80% of use cases. Deploy once per chain.

```solidity
// Call any contract, extract the Nth return value word
function readWord(address target, bytes calldata data, uint256 wordIndex) view returns (uint256)

// Same + apply fraction/decimal math in one call
function readWordMulDiv(address target, bytes data, uint256 wordIndex, uint256 num, uint256 den) view returns (uint256)

// Math on Storage-captured values
function storageMulDiv(bytes32 namespace, bytes32 slot, uint256 num, uint256 den) view returns (uint256)

// Pure math helper
function mulDiv(uint256 value, uint256 num, uint256 den) pure returns (uint256)
```

**Example:** Aave borrow capacity at 80% in USDC decimals via ComposableLens (no AaveLens needed):
```typescript
lens.read('readWordMulDiv', [
  AAVE_POOL,
  encodeFunctionData({ abi: aavePoolAbi, functionName: 'getUserAccountData', args: [account] }),
  2n,              // wordIndex 2 = availableBorrowsBase
  80_000_000n,     // numerator: 80 * 10^6 (fraction × decimal shift combined)
  10_000_000_000n, // denominator: 100 * 10^8
]).gte(1n)
```

### Tier 2: Protocol-specific lenses (optional, for complex multi-field logic)

When a computation requires multiple return value fields (e.g., safe withdraw amount depends on both collateral and debt), a protocol-specific lens is cleaner:

- **`AaveLens`** — `getSafeBorrowAmount`, `getSafeWithdrawAmount`, `getHealthFactor`
- Future: `MorphoLens`, `CompoundV3Lens`, etc.

These are optional. `ComposableLens.readWordMulDiv` covers any single-field-with-math pattern generically.

### Deployment Summary

| Contract | Purpose | Deploy per chain |
|---|---|---|
| `ComposableExecutionModule` | ERC-7579 module (core) | Once |
| `Storage` | Namespaced value passing | Once |
| `ComposableLens` | Generic read + math | Once |
| `AaveLens` | Aave-specific multi-field computations | Once (optional) |

---

## 9. Package Structure

```
@erc-xxxx/sdk
├── core/
│   ├── types.ts       # On-chain enum mirrors, DynamicParam, ConstrainedParam, MaybeDynamic
│   ├── token.ts       # token(), native() → BoundToken
│   ├── contract.ts    # contract() → BoundContract with .call() and .read()
│   ├── params.ts      # createDynamic() factory, fromStorage()
│   ├── encode.ts      # encodeStep(), encodePredicate(), flattenArg(), isDynamic()
│   ├── batch.ts       # composableBatch(), BatchBuilder, approve(), wrap(), transfer()
│   └── index.ts       # Re-exports
├── viem/
│   ├── actions.ts     # composableActions decorator (sendComposableBatch, simulateComposableBatch)
│   └── index.ts
└── index.ts           # Main entry — re-exports core/ and viem/
```

---

## 10. Full Example: Leverage Loop

```typescript
import { parseEther, type Address } from 'viem'
import { composableBatch, token, native, contract, approve } from '@erc-xxxx/sdk'

const weth = token(WETH, account)
const usdc = token(USDC, account)
const eth  = native(account)
const aave = contract(AAVE_POOL, aavePoolAbi)
const lens = contract(AAVE_LENS, aaveLensAbi)
const router = contract(SWAP_ROUTER, swapRouterAbi)

const batch = composableBatch({ account, chainId: 8453, weth: WETH })

batch.wrap(eth.balance())

for (let i = 0; i < 3; i++) {
  batch.approve(weth, AAVE_POOL, weth.balance())
  batch.add(aave, 'supply', [WETH, weth.balance().gte(1n), account, 0])
  batch.add(aave, 'borrow', [
    USDC,
    lens.read('getSafeBorrowAmount', [AAVE_POOL, account, 6, 80n, 100n]).gte(1n),
    2n, 0, account,
  ])
  batch.approve(usdc, SWAP_ROUTER, usdc.balance())
  batch.add(router, 'exactInputSingle', [{
    tokenIn: USDC, tokenOut: WETH, fee: 3000, recipient: account,
    amountIn: usdc.balance(), amountOutMinimum: 1n, sqrtPriceLimitX96: 0n,
  }])
}

batch.approve(weth, AAVE_POOL, weth.balance())
batch.add(aave, 'supply', [WETH, weth.balance(), account, 0])
batch.check(lens.read('getHealthFactor', [AAVE_POOL, account]).gte(parseEther('1.5')))

const hash = await client.sendComposableBatch({ batch })
```
