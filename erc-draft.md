---
eip: xxxx
title: Composable Batch Execution and Predicate Contracts for Smart Accounts
description: A standard for runtime-resolved composable batch execution and standalone predicate validator contracts that gate orchestrated, multi-step transaction flows on-chain.
author: Mislav Javor, Filip Dujmušić, Filipp Makarov, Venkatesh Rajendran
discussions-to:
status: Draft
type: Standards Track
category: ERC
created: 2026-02-11
requires: 4337, 5792, 6900, 7579, 7702
---

## Abstract

Today, every smart account batch is static: every call target, every parameter, every amount is frozen at the moment the user signs. The actual on-chain state at execution time is irrelevant — if a swap returns 91 tokens instead of the 95 you guessed, the batch reverts. If a bridge delivers with 0.3% more slippage than expected, the batch reverts. If you want to spend your full balance but gas costs are deducted first, you can't — because you don't know the gas cost at signature time.

This ERC eliminates that entire class of problems.

**Composable Batch Execution** introduces a batch encoding where each parameter in each call declares *how to obtain its value at execution time*. A parameter can be a literal, or it can say "read this contract's balanceOf right now" or "make this arbitrary staticcall and use the result." The call's target address, ETH value, and every calldata argument are each independently resolved on-chain and assembled into the final call. Nothing is guessed. Nothing is stale.

This makes previously impossible flows trivial:

- **Dustless full-balance operations.** A user wants to spend their entire USDC balance. The batch reads `balanceOf` at execution time — after gas has been deducted, after prior steps have run — and passes the exact remaining amount. Zero dust. Zero reverts.
- **Dynamic parameter splitting.** A user receives ~1000 USDC from a swap (minus slippage). They want 500 into a lending pool and whatever remains into a liquidity position. The first step uses a literal 500; the second reads the remaining balance. The split adapts to the actual swap output.
- **Pay gas in the transaction token.** A user wants to swap their entire ETH balance to USDC. The batch reads the ETH balance after the gas payment has been deducted by the bundler, then passes the exact remainder to the swap. No need to estimate gas and subtract manually — the balance query sees the post-gas state.
- **MEV-aware post-execution guards.** After a swap executes, a constraint checks that the received amount is above a minimum threshold. If a sandwich attack degrades the output below the user's tolerance, the entire batch reverts — on-chain, trustlessly, without relying on any off-chain MEV protection service.
- **Multi-source aggregation.** A user bridges USDC from three different chains via three different bridges (Across, native bridge, intent solver). A predicate on the destination chain waits until *all three* balances have arrived, then a composable batch reads the total balance and injects it into a single deposit call. The bridges can complete in any order — the predicate simply waits for the aggregate state.
- **Cross-protocol composition without custom contracts.** Swap on one DEX, approve the output, deposit into a vault, stake the LP token — all in a single signed batch, with each step's amount resolved from on-chain state. No Solidity. No deployment. Just a TypeScript SDK call.

**Predicate Validator Contracts** provide the second primitive: standalone on-chain contracts that evaluate boolean conditions against chain state. Predicates gate execution of individual steps — "has the bridge delivered?", "is the balance above threshold?", "has the nonce advanced?", "has the timestamp passed?" — and are usable by any relayer, wallet, or execution infrastructure.

Together, composable batching and predicates form the **end-game encoding for smart account transactions.** Static batching is to composable batching what static HTML is to a reactive frontend: the old model describes a fixed document; the new model describes *how to compute the document from live data.* Every parameter is a live query. Every constraint is an on-chain assertion. Every batch is self-resolving.

This ERC standardizes the **encoding formats** and **interfaces** for both primitives. It does not prescribe a specific smart account module standard. The same encoding and execution semantics can be implemented as an ERC-7579 executor module, an ERC-6900 execution function, a native account method, or any future modular account surface. By standardizing at the encoding and interface level, any smart account ecosystem can adopt composable batch execution without fragmentation — SDKs, relayers, and block explorers can all speak the same wire format regardless of the underlying account architecture.

## Motivation

### The Problem with Static Batching

Current smart account batching (ERC-4337 `executeBatch`, EIP-5792 `wallet_sendCalls`) is static. Every call target, every parameter, and every ETH value must be fully determined at signature time. Real-world DeFi flows produce dynamic outputs:

- A swap yields a variable token amount depending on price impact, slippage, and MEV
- A withdrawal from a lending vault returns a variable share-to-asset conversion
- A bridge delivers tokens after an unpredictable delay with variable fees
- A liquidation or rebalance depends on state that changes block-to-block

Static batching forces two bad choices: hardcode optimistic amounts (risking reverts when the actual value differs) or underestimate conservatively (leaving value stranded in the account). Both degrade UX and capital efficiency. Developers resort to deploying custom smart contracts for each multi-step flow, or building off-chain orchestration servers that pre-compute parameters and re-sign — neither of which scales.

**Static batching vs composable batching:**

```
STATIC BATCHING (current model)
═══════════════════════════════════════════════════════════════════

 Signature time                          Execution time
 ─────────────                           ──────────────
 All values frozen at signing:           Values may be stale:

 ┌──────────────────────────┐            ┌──────────────────────────┐
 │ Step 1: swap(100 USDC)   │──────────► │ swap(100 USDC)           │ ✓ OK
 ├──────────────────────────┤            ├──────────────────────────┤
 │ Step 2: supply(95 WETH)  │──────────► │ supply(95 WETH)          │ ✗ REVERT
 │  (guessed swap output)   │            │  (actual output was 91)  │
 └──────────────────────────┘            └──────────────────────────┘

 Problem: amount "95" was a guess at signature time.
 If the swap returns 91, step 2 reverts — entire batch fails.


COMPOSABLE BATCHING (this standard)
═══════════════════════════════════════════════════════════════════

 Signature time                          Execution time
 ─────────────                           ──────────────
 Parameters specify HOW to resolve:      Values resolved on-chain:

 ┌──────────────────────────┐            ┌──────────────────────────┐
 │ Step 1: swap(100 USDC)   │──────────► │ swap(100 USDC)           │
 │  output → Storage[slot0] │            │  returns 91 → Storage    │
 ├──────────────────────────┤            ├──────────────────────────┤
 │ Step 2: supply(amount)   │            │ supply(91 WETH)          │ ✓ OK
 │  amount = STATIC_CALL    │──────────► │  read Storage[slot0] = 91│
 │          → Storage.read  │            │  constraint: GTE(1) ✓    │
 │  constraint: GTE(1)      │            └──────────────────────────┘
 └──────────────────────────┘

 Each parameter declares its resolution strategy:
  ┌─────────────┐
  │  RAW_BYTES   │──► Literal value (known at signing)
  ├─────────────┤
  │ STATIC_CALL  │──► Read on-chain state (balance, Storage, oracle...)
  ├─────────────┤
  │  BALANCE     │──► Query ERC-20 or native balance
  └─────────────┘

 And each parameter declares where it is routed:
  TARGET ──► call target address
  VALUE  ──► ETH value to forward
  CALL_DATA ──► appended to calldata
```

### Why Runtime Resolution

Composable batching resolves parameters at execution time. Instead of pre-encoding a static calldata blob, the user signs a batch where each parameter specifies *how to obtain its value* — either as a literal, a `staticcall` to an on-chain contract, or a balance query. The on-chain execution logic resolves each parameter and **constructs the calldata from scratch** during the transaction. This eliminates the entire class of failures caused by stale data between signature time and execution time.

The calldata-construction design is deliberate. Rather than using pre-encoded calldata with sentinel bytes that get replaced (a placeholder/patching model), the system builds each call's target, value, and calldata from individually resolved parameters. This avoids offset arithmetic, keeps the encoding simple, and means each parameter can independently specify its resolution strategy and constraints.

### Orchestration as a Composition of Predicates

For multi-chain flows, the same principle extends beyond a single transaction. A user signs a Merkle root authorizing a sequence of operations across chains. Each operation is gated by a *predicate* — an on-chain condition that must resolve to true before the operation executes. Relayers continuously evaluate predicates; when one resolves, the corresponding step is submitted.

> **Note on Merkle tree encoding:** The Merkle-tree-based authorization structure — how multiple function calls are encoded into leaves, hashed into a tree, and verified against a signed root — is defined by a **separate ERC** (the modular signature / session-key validation standard). This ERC defines the composable batch encoding and predicate interface that operate *within* each leaf. The two standards compose: the Merkle tree ERC handles authorization ("is this call allowed?"), while this ERC handles execution ("how is this call constructed and validated?").

Predicates also enable **execution ordering without explicit sequencing.** Because each step only executes when its predicate is satisfied, the user does not need to specify "step B runs after step A." Instead, step B's predicate observes the *state change* that A produces. If the user bridges from three different sources (Across, native bridge, an intent-based solver), a predicate on the destination chain can simply wait until the aggregate balance exceeds a threshold — the order in which the three bridges complete is irrelevant. The predicate defines a *convergence point*, not a sequence number.

```
MULTI-CHAIN ORCHESTRATION VIA MERKLE TREE + PREDICATES
═══════════════════════════════════════════════════════════════════

 User signs ONE Merkle root covering all operations:

                        ┌──────────┐
                        │  Root    │◄── user signature
                        │ 0xab3f.. │
                        └────┬─────┘
                   ┌─────────┴─────────┐
              ┌────┴────┐         ┌────┴────┐
              │ H(A,B)  │         │ H(C,D)  │
              └────┬────┘         └────┬────┘
            ┌──────┴──────┐     ┌──────┴──────┐
         ┌──┴──┐       ┌──┴──┐ ┌──┴──┐    ┌──┴──┐
         │  A  │       │  B  │ │  C  │    │  D  │
         └──┬──┘       └──┬──┘ └──┬──┘    └──┬──┘
            │              │      │           │
            ▼              ▼      ▼           ▼

  ┌─────────────┐ ┌──────────────┐ ┌──────────────┐ ┌──────────────┐
  │ ETHEREUM L1 │ │  OPTIMISM    │ │  ARBITRUM    │ │  BASE        │
  ├─────────────┤ ├──────────────┤ ├──────────────┤ ├──────────────┤
  │ A: Bridge   │ │ B: Composable│ │ C: Composable│ │ D: Composable│
  │ 100 USDC    │ │ batch:       │ │ batch:       │ │ batch:       │
  │ to Optimism │ │  swap → lend │ │  claim → LP  │ │  unwrap→send │
  │             │ │              │ │              │ │              │
  │ Predicate:  │ │ Predicate:   │ │ Predicate:   │ │ Predicate:   │
  │ (none—first │ │ USDC balance │ │ nonce > N    │ │ timestamp    │
  │  step)      │ │ on OP ≥ 100  │ │ (confirms C  │ │ > T          │
  └─────────────┘ │              │ │  landed)     │ │ (time lock)  │
                  └──────────────┘ └──────────────┘ └──────────────┘

  Execution flow (asynchronous, predicate-gated):

  Time ──────────────────────────────────────────────────────────►

  t=0: Relayer submits A (no predicate — executes immediately)
       Bridge 100 USDC from L1 to Optimism

  t=?: Relayer polls predicate for B:
       "Is USDC balance on Optimism ≥ 100?"
       Bridge completes... predicate satisfied ✓
       Relayer submits B: composable batch (swap → lend)

  t=?: Relayer polls predicate for C:
       "Is account nonce on Arbitrum > N?"
       Prior tx confirms... predicate satisfied ✓
       Relayer submits C: composable batch (claim → LP)

  t=?: Relayer polls predicate for D:
       "Is block.timestamp > T?"
       Time passes... predicate satisfied ✓
       Relayer submits D: composable batch (unwrap → send)

  ─────────────────────────────────────────────────────────────

  Key property: predicates observe STATE, not mechanism.
  The bridge in step A could be any provider — native bridge,
  Across, ERC-7683, LayerZero — the predicate doesn't care.
  It just waits for the balance to appear.
```

Because predicates only observe *state* — not *how* that state was produced — orchestration is agnostic to the interoperability mechanism. Native rollup bridges, intent-based bridges, ERC-7683, message-passing protocols — any of them work. The predicate simply waits for the expected state to materialize.

This makes the predicate model **credibly neutral**: it does not privilege any bridge, messaging protocol, or relayer network. Any new interop provider works automatically if it produces the expected state change.

## Specification

The key words "MUST", "MUST NOT", "REQUIRED", "SHALL", "SHALL NOT", "SHOULD", "SHOULD NOT", "RECOMMENDED", "NOT RECOMMENDED", "MAY", and "OPTIONAL" in this document are to be interpreted as described in RFC 2119 and RFC 8174.

### Definitions

- **Composable batch**: An ordered array of `ComposableExecution` entries where each entry's call target, value, and calldata are constructed from individually resolved parameters, and return data MAY be captured for use by subsequent entries.
- **Input parameter**: A single value contributing to a call's target, value, or calldata. Each input parameter specifies how to obtain its value (fetcher type) and where to route it (param type).
- **Fetcher type**: The strategy for resolving an input parameter's value at execution time — literal bytes, an arbitrary `staticcall`, or a balance query.
- **Storage contract**: A dedicated external contract that provides namespaced key-value storage for captured return values. Values are written by output parameters and read back by subsequent input parameters via `staticcall`.
- **Predicate**: A pure boolean condition evaluated against on-chain state. A predicate MUST NOT produce side effects.
- **Constraint**: A predicate attached to a specific input parameter within a composable batch entry. If the constraint fails, the entry MUST NOT execute.

### Overview

This standard defines three layers:

1. **Encoding schemes** — The wire format for composable batches, runtime value sources, constraints, and predicates. This is the core of the standard. Any two conforming implementations MUST produce and consume identical encodings.
2. **Interfaces** — Solidity interfaces (`IComposableExecution`, `IPredicate`) that any contract can implement. These are account-standard-agnostic.
3. **Execution semantics** — The normative algorithm that all implementations MUST follow when processing a composable batch.

How these are surfaced to a smart account is an implementation choice, not part of this standard:

- An **ERC-7579** implementation wraps the interface as an executor module.
- An **ERC-6900** implementation wraps it as an execution function / plugin.
- A **native account** inherits the interface directly.
- An **ERC-7702** delegated EOA can delegate to an implementation contract.

All of these consume the same encoding and follow the same execution semantics.

```
┌─────────────────────────────────────────────────┐
│  Application / SDK Layer                        │
│  Encodes ComposableExecution[] with fetcher     │
│  types, param types, and constraints            │
└──────────────────┬──────────────────────────────┘
                   │ standardized encoding
                   ▼
┌─────────────────────────────────────────────────┐
│  Account-Standard Adapter                       │
│  ERC-7579 module │ ERC-6900 plugin │ native     │
│  (thin wrapper — delegates to core logic)       │
└──────────────────┬──────────────────────────────┘
                   │ for each step:
                   ▼
┌─────────────────────────────────────────────────┐
│  Core Execution Logic (shared)                  │
│  1. processInputs() — resolve & build calldata  │
│  2. Execute the call                            │
│  3. processOutputs() — capture to Storage       │
└─────────────────────────────────────────────────┘
```

---

### Composable Batch Encoding

#### Execution Entry

Each step in a composable batch is encoded as a `ComposableExecution` struct:

```solidity
struct ComposableExecution {
    bytes4 functionSig;            // Function selector for the target call
    InputParam[] inputParams;      // Parameters — each resolves and routes a value
    OutputParam[] outputParams;    // Return value capture instructions
}
```

A `ComposableExecution` does not contain a pre-encoded `target`, `value`, or `callData`. Instead, the call target, ETH value, and calldata are **constructed at execution time** from the resolved input parameters. The `functionSig` provides the 4-byte function selector; the rest of the calldata is built by concatenating each resolved `CALL_DATA` input parameter in order.

Implementations MUST process the batch as an ordered array of `ComposableExecution` entries. Entries MUST be executed sequentially — parallel or out-of-order execution is not permitted, since later entries MAY depend on captured outputs from earlier ones.

#### Input Parameters

Each input parameter specifies two orthogonal concerns: **where the value goes** (`paramType`) and **how the value is obtained** (`fetcherType`):

```solidity
struct InputParam {
    InputParamType paramType;           // Where this value is routed
    InputParamFetcherType fetcherType;  // How this value is obtained
    bytes paramData;                    // Fetcher-specific data
    Constraint[] constraints;           // Conditions the resolved value MUST satisfy
}
```

##### Input Parameter Type — Value Routing

```solidity
enum InputParamType {
    TARGET,     // The resolved value is used as the call target address
    VALUE,      // The resolved value is used as the ETH value to forward
    CALL_DATA   // The resolved value is appended to the calldata being built
}
```

- `TARGET`: The resolved bytes are decoded as an `address` and used as the call target. At most one input parameter per entry MAY have this type. If no `TARGET` parameter is provided, the target defaults to `address(0)`.
- `VALUE`: The resolved bytes are decoded as a `uint256` and used as the ETH value. At most one input parameter per entry MAY have this type. If no `VALUE` parameter is provided, the value defaults to `0`.
- `CALL_DATA`: The resolved bytes are appended (in order) to the calldata being constructed after the function selector. Multiple `CALL_DATA` parameters are concatenated sequentially.

##### Input Parameter Fetcher Type — Value Resolution

```solidity
enum InputParamFetcherType {
    RAW_BYTES,      // Literal value — use paramData directly
    STATIC_CALL,    // Resolve via an arbitrary staticcall
    BALANCE         // Resolve via a token or native balance query
}
```

**`RAW_BYTES`** — The `paramData` is used as-is as the resolved value. This is for parameters whose values are known at encoding time (static amounts, known addresses, pre-computed hashes).

**`STATIC_CALL`** — Performs an arbitrary `staticcall` and uses the return data as the resolved value.

```solidity
// paramData encoding:
// abi.encode(address contractAddr, bytes callData)
```

The implementation MUST execute `staticcall` to `contractAddr` with the provided `callData`. The return data is used as the resolved value. If the `staticcall` reverts, the implementation MUST revert.

This is the general-purpose fetcher. It handles any on-chain state read: ERC-20 allowances, oracle prices, storage reads, and — critically — reading previously captured values back from the Storage contract (see Output Parameters below).

**`BALANCE`** — Queries the balance of an address. Handles both ERC-20 tokens and native ETH via a sentinel address convention.

```solidity
// paramData encoding:
// abi.encodePacked(address token, address account)  // exactly 40 bytes
```

If `token == address(0)`, the implementation MUST use `account.balance` (native ETH balance). Otherwise, the implementation MUST execute `IERC20(token).balanceOf(account)` via `staticcall`. The result is ABI-encoded as `uint256`.

The `paramData` MUST be exactly 40 bytes (`abi.encodePacked` of two addresses). Implementations MUST revert if the length does not match.

The `BALANCE` fetcher type MUST NOT be used with `InputParamType.TARGET` (a balance cannot be a call target address).

After resolution, all constraints attached to the input parameter MUST be validated against the resolved value before it is routed to its destination.

#### Output Parameters — Return Value Capture

After a call completes, the system MAY capture values from the return data and write them to an external **Storage contract** for use by later entries:

```solidity
struct OutputParam {
    OutputParamFetcherType fetcherType;  // Source of the data to capture
    bytes paramData;                     // Fetcher-specific capture instructions
}
```

##### Output Parameter Fetcher Type

```solidity
enum OutputParamFetcherType {
    EXEC_RESULT,    // Capture from the return data of the just-executed call
    STATIC_CALL     // Capture from a separate staticcall (post-execution state read)
}
```

**`EXEC_RESULT`** — Captures values directly from the return data of the call that just executed.

```solidity
// paramData encoding (packed):
// abi.encode(uint256 returnValueCount, address storageContract, bytes32 storageSlot)
```

- `returnValueCount`: The number of consecutive 32-byte words to capture from the return data, starting at offset 0.
- `storageContract`: The address of the Storage contract to write captured values to.
- `storageSlot`: The base storage slot. Each captured word `i` is written to `keccak256(abi.encodePacked(storageSlot, i))`.

**`STATIC_CALL`** — Makes a separate `staticcall` after execution and captures from its return data. This is useful for reading state that changed as a result of the call (e.g., a new balance after a swap).

```solidity
// paramData encoding:
// abi.encode(uint256 returnValueCount, address sourceContract, bytes sourceCallData,
//            address storageContract, bytes32 storageSlot)
```

The implementation MUST execute `staticcall` to `sourceContract` with `sourceCallData`, then capture `returnValueCount` consecutive 32-byte words from the return data and write them to the Storage contract at the derived slots. If the `staticcall` reverts, the implementation MUST revert.

---

### Storage Contract

Captured return values are persisted in a dedicated **Storage contract** — a separate on-chain contract that provides namespaced key-value storage. This is NOT inline storage within the execution module or account; it is an external contract that any entry in the batch can write to and any subsequent entry can read from (via a `STATIC_CALL` fetcher).

#### Interface

```solidity
contract Storage {
    function writeStorage(bytes32 slot, bytes32 value, address account) external;
    function readStorage(bytes32 namespace, bytes32 slot) external view returns (bytes32);
    function getNamespace(address account, address caller) public pure returns (bytes32);
    function getNamespacedSlot(bytes32 namespace, bytes32 slot) public pure returns (bytes32);
    function isSlotInitialized(bytes32 namespace, bytes32 slot) external view returns (bool);
}
```

**Namespace derivation:** Each `(account, caller)` pair maps to a unique namespace:

```solidity
namespace = keccak256(abi.encodePacked(account, caller))
```

**Slot derivation:** Each logical slot is further namespaced:

```solidity
namespacedSlot = keccak256(abi.encodePacked(namespace, slot))
```

The `writeStorage` function derives the namespace from `(account, msg.sender)`, so the caller identity is implicit. The `readStorage` function takes an explicit namespace, allowing any contract to read from any namespace.

**Initialized tracking:** The Storage contract tracks which slots have been written. Reading an uninitialized slot MUST revert (`SlotNotInitialized`). This prevents stale data from prior executions from leaking into the current batch.

**Ephemeral storage variant:** Because captured values only need to persist within a single transaction, the Storage contract MAY be implemented using EIP-1153 transient storage (`TSTORE`/`TLOAD`) instead of persistent storage (`SSTORE`/`SLOAD`). This has two benefits: (1) transient storage is significantly cheaper — no cold/warm SSTORE costs, no refund accounting — reducing gas overhead for composable batches that capture and pass many values, and (2) transient storage automatically clears at the end of the transaction, eliminating the need for initialized-slot tracking and removing any risk of stale data leaking between transactions. The external interface (`writeStorage`/`readStorage`) remains identical; only the internal storage mechanism changes. Implementations SHOULD prefer the transient storage variant on chains where EIP-1153 is available.

#### How Captured Values Flow Between Steps

1. Step N executes, producing return data.
2. An `EXEC_RESULT` output parameter captures words from the return data and writes them to the Storage contract at `(storageSlot, i)` for each word `i`.
3. Step N+1 has an input parameter with `fetcherType = STATIC_CALL` that calls `Storage.readStorage(namespace, slot)` to read back the captured value.
4. The resolved value is routed to the appropriate destination (`TARGET`, `VALUE`, or `CALL_DATA`).

This design means captured value passing is not a special built-in mechanism — it composes through the same `STATIC_CALL` fetcher used for any on-chain state read.

#### Preferred Pattern: Stateless Reads Over Captured Storage

While the Storage contract enables passing return values between steps, the **preferred pattern** is to avoid storing and retrieving values entirely. Instead, subsequent steps SHOULD read the result of a prior step's side effects directly via getter functions on the affected contracts.

For example, after a swap, the account's token balance changes. Rather than capturing the swap's return value into Storage and reading it back, the next step can simply use a `BALANCE` fetcher (or a `STATIC_CALL` to `balanceOf`) to read the account's current balance of the received token. The balance already reflects the swap's output — there is nothing to store.

```
PREFERRED — stateless read via getter:
  Step 1: swap(100 USDC → WETH)
  Step 2: supply(amount)
           amount = BALANCE(WETH, account)   ← reads current balance directly

ALTERNATIVE — capture and retrieve via Storage:
  Step 1: swap(100 USDC → WETH)
           output → Storage[slot0]            ← extra SSTORE
  Step 2: supply(amount)
           amount = STATIC_CALL(Storage.read) ← extra SLOAD + cross-contract call
```

The stateless-read pattern is more gas-efficient (no Storage writes or reads), simpler to encode (no storage slot coordination), and more robust (no risk of stale or uninitialized slots). It works whenever the prior step produces an observable state change that a getter can reflect — which covers the vast majority of DeFi operations (swaps, deposits, withdrawals, approvals).

The Storage-based capture pattern remains necessary when:
- The prior step's return value is the only way to obtain the data (no getter exists for the resulting state).
- Multiple values from a single return must be disaggregated (e.g., a function returning `(uint256 amountA, uint256 amountB)`).
- The value needed is not a balance or allowance but an intermediate computation only available in the return data.

SDK implementers SHOULD default to stateless getter reads and only fall back to Storage-based capture when no getter can express the needed value.

---

### Constraints (Inline Predicates)

Constraints are predicates attached to individual input parameters within a composable batch. They validate the resolved value before it is routed:

```solidity
struct Constraint {
    ConstraintType constraintType;
    bytes referenceData;
}

enum ConstraintType {
    EQ,     // value == referenceData (as bytes32)
    GTE,    // value >= referenceData (as bytes32)
    LTE,    // value <= referenceData (as bytes32)
    IN      // lowerBound <= value <= upperBound
}
```

- `EQ`: The resolved value (as `bytes32`) MUST equal `bytes32(referenceData)`.
- `GTE`: The resolved value (as `bytes32`) MUST be greater than or equal to `bytes32(referenceData)`.
- `LTE`: The resolved value (as `bytes32`) MUST be less than or equal to `bytes32(referenceData)`.
- `IN`: The `referenceData` MUST be `abi.encode(bytes32 lowerBound, bytes32 upperBound)`. The resolved value MUST satisfy `lowerBound <= value <= upperBound`.

Constraints operate on `bytes32` comparisons, which naturally handle `uint256`, `address`, and other 32-byte types via their left-padded representations.

Implementations MUST evaluate all constraints on each input parameter against its resolved value. If any constraint fails, the implementation MUST revert the entire batch.

#### Constraints in Orchestration Context

In a multi-chain orchestration context, constraints serve a dual purpose:

1. **Validation** — ensuring injected values meet safety criteria (e.g., balance is non-zero, amount is above a minimum).
2. **Execution ordering** — when an orchestrator retries steps until constraints are satisfied, constraints naturally gate cross-chain flows. For example, a constraint `GreaterThanOrEqual(bridgedAmount, minExpected)` on a destination-chain step causes the orchestrator to wait until the bridge completes before proceeding.

---

### Predicate Validator Contracts

Predicate validator contracts are standalone on-chain contracts used outside of composable batch execution to gate orchestrated multi-step flows. They evaluate conditions against chain state and return a boolean result.

#### Interface

```solidity
interface IPredicate {
    /// @notice Evaluates a predicate against current on-chain state.
    /// @param data ABI-encoded predicate parameters, specific to the implementation.
    /// @return satisfied True if the predicate condition is met, false otherwise.
    /// @dev MUST NOT modify state. MUST be safe to call via staticcall.
    function evaluate(bytes calldata data) external view returns (bool satisfied);

    /// @notice Returns a human-readable identifier for this predicate type.
    /// @return name The predicate type name (e.g., "ERC20Balance", "Nonce", "Timestamp").
    function predicateType() external pure returns (string memory name);
}
```

Predicate validators MUST be stateless with respect to their own storage — they read external state and return a boolean. They MUST be safe to call from any context without side effects.

#### Required Predicate Types

Conforming implementations MUST provide predicate validator contracts for the following condition types:

##### Balance Predicate

Evaluates whether an ERC-20 token balance meets a threshold.

```solidity
// data encoding:
// abi.encode(address token, address account, uint256 threshold, ComparisonOp op)

enum ComparisonOp { Eq, Neq, Gt, Gte, Lt, Lte }
```

The predicate MUST call `IERC20(token).balanceOf(account)` and compare the result to `threshold` using the specified comparison operator.

##### Native Balance Predicate

Evaluates whether a native token (ETH) balance meets a threshold.

```solidity
// data encoding:
// abi.encode(address account, uint256 threshold, ComparisonOp op)
```

##### Nonce Predicate

Evaluates whether a smart account's nonce has reached or exceeded an expected value. This is used to gate steps that depend on prior transactions having been included.

```solidity
// data encoding:
// abi.encode(address account, uint256 expectedNonce, ComparisonOp op)
```

The predicate MUST query the account's nonce using the appropriate mechanism for the account type (e.g., ERC-4337 EntryPoint nonce, or the account's own nonce method).

##### Timestamp Predicate

Evaluates whether the current block timestamp meets a condition.

```solidity
// data encoding:
// abi.encode(uint256 targetTimestamp, ComparisonOp op)
```

The predicate MUST compare `block.timestamp` to `targetTimestamp` using the specified operator.

##### Storage Predicate

Evaluates whether a storage slot at a given contract contains an expected value.

```solidity
// data encoding:
// abi.encode(address target, bytes32 slot, bytes32 expectedValue, ComparisonOp op)
```

The predicate MUST read the storage slot via `staticcall` (or equivalent mechanism) and compare it to `expectedValue`.

##### Custom Call Predicate

Evaluates a boolean condition based on the return value of an arbitrary `staticcall`.

```solidity
// data encoding:
// abi.encode(address target, bytes callData, bytes32 expectedReturn, ComparisonOp op)
```

The predicate MUST execute `staticcall(target, callData)` and compare the first 32 bytes of the return data to `expectedReturn`.

#### Predicate Composition

Complex conditions MAY be expressed by combining predicates. A `CompositePredicate` evaluates multiple predicates with logical operators:

```solidity
interface ICompositePredicate is IPredicate {
    /// @notice Evaluates a composite predicate (AND/OR over sub-predicates).
    /// @param data ABI-encoded array of (predicateAddress, predicateData) pairs and a logical operator.
    function evaluate(bytes calldata data) external view returns (bool satisfied);
}
```

```solidity
// data encoding:
// abi.encode(
//     LogicOp op,           // AND or OR
//     PredicateCall[] calls  // array of sub-predicate calls
// )

enum LogicOp { And, Or }

struct PredicateCall {
    address predicateContract;
    bytes predicateData;
}
```

For `LogicOp.And`, the composite predicate MUST return `true` only if ALL sub-predicates return `true`. For `LogicOp.Or`, it MUST return `true` if ANY sub-predicate returns `true`.

---

### Composable Execution Algorithm

The execution algorithm for a composable batch is as follows. This is normative — implementations MUST follow this sequence:

```
function executeComposable(ComposableExecution[] entries):
    for i = 0 to entries.length - 1:
        entry = entries[i]
        target = address(0)
        value = 0
        calldata = entry.functionSig    // start with 4-byte selector

        // Step 1: Process input parameters — resolve and route each value
        for each inputParam in entry.inputParams:

            // Step 1a: Resolve the value via the fetcher
            if inputParam.fetcherType == RAW_BYTES:
                resolvedValue = inputParam.paramData
            else if inputParam.fetcherType == STATIC_CALL:
                (contractAddr, callData) = decode(inputParam.paramData)
                resolvedValue = staticcall(contractAddr, callData)
            else if inputParam.fetcherType == BALANCE:
                (token, account) = decodePacked(inputParam.paramData)
                if token == address(0):
                    resolvedValue = abi.encode(account.balance)
                else:
                    resolvedValue = abi.encode(IERC20(token).balanceOf(account))

            // Step 1b: Validate constraints
            for each constraint in inputParam.constraints:
                if not evaluateConstraint(constraint, resolvedValue):
                    REVERT

            // Step 1c: Route to destination
            if inputParam.paramType == TARGET:
                target = address(resolvedValue)
            else if inputParam.paramType == VALUE:
                value = uint256(resolvedValue)
            else if inputParam.paramType == CALL_DATA:
                calldata = concat(calldata, resolvedValue)

        // Step 2: Execute the call
        if target != address(0):
            (success, returnData) = target.call{value: value}(calldata)
            if not success:
                REVERT with returnData
        else:
            returnData = empty

        // Step 3: Process output parameters — capture to Storage
        for each outputParam in entry.outputParams:
            if outputParam.fetcherType == EXEC_RESULT:
                writeToStorage(returnData, outputParam.paramData)
            else if outputParam.fetcherType == STATIC_CALL:
                externalData = staticcall(sourceContract, sourceCallData)
                writeToStorage(externalData, outputParam.paramData)
```

The `writeToStorage` step parses `returnValueCount` consecutive 32-byte words from the data and writes each to the Storage contract at `keccak256(abi.encodePacked(storageSlot, i))`, namespaced by `(account, caller)`.

#### Error Handling

- If any `staticcall` for value resolution (input or output) fails, the implementation MUST revert the entire batch.
- If any constraint evaluates to false, the implementation MUST revert the entire batch.
- If any call in the batch reverts, the implementation MUST revert the entire batch (atomic execution).
- If an entry specifies `target == address(0)` (no `TARGET` input param provided), the call MUST be skipped but output parameters MUST still be processed. This allows entries that only perform state reads and storage writes without executing a call.
- `TARGET` and `VALUE` param types MUST each appear at most once per entry. Duplicates MUST cause a revert.
- The `BALANCE` fetcher type MUST NOT be used with `InputParamType.TARGET`.

---

### Storage Model for Captured Values

Captured values are persisted in a dedicated, external **Storage contract** rather than in inline storage within the execution module or account. This design provides:

1. **Per-account isolation** — the Storage contract derives a unique namespace from `(account, caller)`, so values captured by one account's batch are not readable by another account unless the namespace is explicitly provided.
2. **Initialized tracking** — the Storage contract tracks which slots have been written. Reading an uninitialized slot reverts, preventing stale data from a prior transaction from being mistaken for a current captured value.
3. **Decoupled storage** — the Storage contract is independent of the execution adapter. The same Storage contract instance can be shared across ERC-7579 modules, ERC-6900 plugins, and native account integrations.

#### Namespace Derivation

The namespace for a given execution context is:

```solidity
namespace = keccak256(abi.encodePacked(account, caller))
```

When the execution module calls `writeStorage(slot, value, account)`, the Storage contract computes the namespace using `(account, msg.sender)`. This means:

- Different accounts naturally get different namespaces.
- The same account calling through different adapters (or via `call` vs `delegatecall`) gets different namespaces, because `msg.sender` differs.

#### Call vs Delegatecall Context

When the composable execution adapter is invoked via `delegatecall`, `msg.sender` in the Storage contract's perspective is the *account's caller* (e.g., the EntryPoint), and `address(this)` within the adapter is the account itself. When invoked via `call`, `msg.sender` is the account, and `address(this)` is the adapter.

Because the namespace includes `msg.sender`, these two contexts produce different namespaces. It is RECOMMENDED that a smart account consistently uses either `call` or `delegatecall` for its composable execution adapter, not both. Values written via one context are not readable via the other.

This concern does not apply to native account integrations, where the composable execution logic runs directly in the account's own context.

#### Transient Storage Optimization

Since captured values only need to persist within a single transaction, implementations MAY use EIP-1153 transient storage (`TSTORE`/`TLOAD`) within the Storage contract for captured slots. This avoids the gas cost of `SSTORE`/`SLOAD` and automatically clears at transaction end.

---

### Core Interface

This standard defines a single, account-standard-agnostic interface that all conforming implementations MUST expose:

```solidity
interface IComposableExecution {
    /// @notice Executes a composable batch.
    /// @param executions The ordered array of composable execution entries,
    ///        encoded per the Composable Batch Encoding section of this standard.
    function executeComposable(ComposableExecution[] calldata executions) external payable;
}
```

Implementations MUST accept and correctly forward `msg.value` through the execution flow to entries that specify non-zero ETH values. Implementations MUST follow the Composable Execution Algorithm defined in this standard.

The `IComposableExecution` interface uses a fixed function selector (`executeComposable(ComposableExecution[])`) so that SDKs, relayers, and tooling can identify and interact with any conforming implementation regardless of how it is installed on the account.

---

### Adapter Guidelines

The core interface and encoding are designed to be wrapped by any modular account standard. This section provides non-normative guidance for adapter implementors.

#### ERC-7579 Adapter

An ERC-7579 adapter wraps `IComposableExecution` as an executor module. The adapter:

- Installs via the standard ERC-7579 module lifecycle (`onInstall`, `onUninstall`).
- MUST verify that `msg.sender` is an account that has installed this module.
- MAY be registered as an executor module, a fallback handler module, or both, depending on the account's architecture.
- Delegates all encoding, injection, and capture logic to a shared library implementing the standard algorithm.

#### ERC-6900 Adapter

An ERC-6900 adapter wraps `IComposableExecution` as an execution function within the ERC-6900 plugin architecture. The adapter:

- Registers `executeComposable` as an execution function via the standard ERC-6900 manifest.
- Hooks into the ERC-6900 permission model for authorization (pre-execution hooks, validation functions).
- The composable batch encoding, runtime value resolution, and execution algorithm are identical — only the installation and permission surfaces differ.

#### Native Account Integration

Smart accounts that want composable execution as a first-class feature MAY implement `IComposableExecution` directly, without any module wrapper:

```solidity
contract MySmartAccount is IComposableExecution, ... {
    function executeComposable(ComposableExecution[] calldata executions) external payable {
        ComposableExecutionLib.execute(executions);
    }
}
```

This eliminates cross-contract call overhead. The account inherits the standard interface and delegates to a shared library, so SDKs and tooling interact with it identically to the module-based path.

#### ERC-7702 Delegated EOAs

EOAs using ERC-7702 delegation can delegate to an implementation contract that exposes `IComposableExecution`. The delegated code runs in the EOA's context, providing composable execution without a smart account deployment.

#### Shared Library Pattern

Regardless of adapter type, implementations SHOULD factor all injection, capture, and constraint logic into a shared library. This ensures:

- Identical behavior across all integration surfaces.
- A single audit target for the core algorithm.
- Fixes and improvements propagate to all adapters automatically.

---

### Canonical Encoding Format

The encoding format is the normative core of this standard. All conforming implementations — regardless of account standard — MUST produce and consume this encoding.

The composable batch is ABI-encoded as:

```solidity
abi.encode(ComposableExecution[] executions)
```

Each `ComposableExecution` is ABI-encoded per standard Solidity struct encoding rules. Nested structs (`InputParam`, `OutputParam`, `Constraint`) and enums (`InputParamType`, `InputParamFetcherType`, `OutputParamFetcherType`, `ConstraintType`) follow the same ABI encoding conventions.

There is no pre-encoded calldata in the `ComposableExecution` struct — the `functionSig` and the resolved `CALL_DATA` input parameters are concatenated at execution time to form the calldata. This means the encoding is fully self-describing: each parameter carries its own resolution strategy and routing information.

#### Why Canonical Encoding Matters

A canonical encoding ensures that:

- **SDKs are portable.** An SDK that encodes a composable batch for an ERC-7579 account produces the exact same bytes as one targeting an ERC-6900 account. There is no per-standard encoding variant.
- **Tooling is universal.** Block explorers, transaction simulators, and debuggers decode one format. They do not need to know which account standard the target uses.
- **Relayers are interoperable.** An orchestration relayer submits the same encoded batch to any conforming account. The adapter layer handles account-standard-specific routing; the payload is identical.

---

## Rationale

### Calldata Construction vs Placeholder Patching

Two viable approaches exist for runtime-resolved calldata:

1. **Placeholder patching** — pre-encode the full calldata with sentinel bytes at known offsets, then replace those bytes with resolved values. This requires offset arithmetic and knowledge of the ABI encoding layout.
2. **Calldata construction** — specify each parameter individually with its resolution strategy, then build the calldata from scratch by concatenating the function selector with each resolved parameter.

This standard uses calldata construction (approach 2). It is simpler: each `InputParam` is self-contained (fetcher type + param data + constraints), there are no offsets to compute, and the encoding is independent of the target function's ABI layout. The SDK specifies parameters in order; the on-chain code concatenates them.

### Encoding-First, Not Module-First

This standard defines encoding schemes and interfaces rather than prescribing a specific module standard. The smart account ecosystem has multiple competing modular architectures (ERC-7579, ERC-6900, native implementations, ERC-7702 delegation). Standardizing at the encoding level means:

- **One wire format** — SDKs encode a composable batch once; any conforming account can consume it.
- **One interface** — `IComposableExecution` is the same function signature everywhere. Tooling (block explorers, simulation engines, debuggers) needs to understand one interface, not N module-specific variants.
- **Adapters are thin** — the ERC-7579 adapter, ERC-6900 adapter, and native integration are thin wrappers over the same encoding and algorithm. The wrapper handles installation and permissions; the core logic is shared.

If the standard were defined as "an ERC-7579 module," ERC-6900 accounts would need a translation layer or a parallel standard. By defining the encoding and interface first, both ecosystems implement the same standard natively.

### Shared Library Architecture

All composable execution logic SHOULD live in a shared library, with adapters being thin wrappers. This keeps the logic DRY — fixes and improvements propagate to all integration surfaces automatically. It also reduces audit surface, since the core algorithm only exists in one place.

### Static Types for Calldata Parameters

The calldata construction model concatenates each resolved `CALL_DATA` parameter in order. Each parameter is expected to be an ABI-encoded 32-byte word (a static Solidity type: `uint256`, `address`, `bytes32`, `bool`, etc.). Dynamic types (`bytes`, `string`, dynamic arrays) can be passed via `RAW_BYTES` fetcher (literal values known at encoding time) but cannot be resolved at runtime via `STATIC_CALL` or `BALANCE`, since those fetchers return raw bytes that are concatenated directly.

### Standalone Predicate Contracts

Predicate evaluation is separated into standalone contracts rather than embedded in account logic, relayer code, or the composable execution system itself. This separation means:

- Predicates are reusable across different accounts, relayers, and orchestration systems.
- Predicates are independently auditable — each is a small, pure-function contract.
- Any execution infrastructure can call the same predicate without reimplementing evaluation logic.
- New predicate types can be deployed without upgrading any account or module.

### Constraints as Inline Predicates

Constraints within composable batch entries serve the same logical role as standalone predicates but are evaluated inline during batch execution. This dual approach exists because:

- **Inline constraints** are for intra-transaction validation — "the value I'm about to inject meets my safety criteria."
- **Standalone predicates** are for inter-transaction gating — "the chain state resulting from a prior transaction (possibly on another chain) has materialized."

Both use the same predicate logic; the difference is scope and caller.

### STATIC_CALL as the Universal Fetcher

The `STATIC_CALL` fetcher type is intentionally general-purpose. Rather than defining a separate fetcher for every on-chain state read (allowances, oracle prices, nonces, etc.), the standard provides one fetcher that can call any contract with any calldata. The `BALANCE` fetcher exists as a convenience optimization for the most common case (token/native balance queries), but any state read expressible as a `staticcall` is supported without extending the standard.

This also means captured value passing is not a special mechanism — reading a value captured by a prior step is just a `STATIC_CALL` to the Storage contract's `readStorage` function.

## Backwards Compatibility

This proposal is fully backwards compatible with the existing smart account ecosystem. Because the standard is defined at the encoding and interface level, it does not impose requirements on any specific account architecture:

- **ERC-4337 Smart Accounts**: Composable batching is additive. Existing `UserOperation` flows are unchanged. A conforming adapter is installed alongside existing modules and does not interfere with standard `executeBatch` operations.
- **ERC-7579 Accounts**: The `IComposableExecution` interface is wrapped as a standard ERC-7579 executor module. It installs, configures, and uninstalls through the standard ERC-7579 module lifecycle. It works with any ERC-7579 account without modifications to the account itself.
- **ERC-6900 Accounts**: The `IComposableExecution` interface is wrapped as an ERC-6900 execution function. The composable batch encoding and execution algorithm are identical to the ERC-7579 adapter — only the installation manifest and permission hooks differ.
- **EIP-5792 (`wallet_sendCalls`)**: Composable batching MAY be exposed as an extension to EIP-5792's `wallet_sendCalls` interface, adding parameter resolution capabilities alongside the existing static call array. The `capabilities` field in EIP-5792 provides a natural extension point for advertising composable execution support.
- **ERC-7702**: Delegated EOAs can delegate to an implementation contract that directly exposes `IComposableExecution`, gaining composable execution without a smart account deployment.

No existing smart account requires migration. The encoding format is self-contained and the `IComposableExecution` interface is a single function — adapters for any account standard are minimal.

## Reference Implementation

A reference implementation accompanies this proposal, structured to demonstrate the encoding-first design:

**Core (account-standard-agnostic):**

1. **`IComposableExecution.sol`** — The standard interface (`executeComposable` and the module-specific `executeComposableCall` / `executeComposableDelegateCall` variants).
2. **`ComposabilityDataTypes.sol`** — All structs and enums (`ComposableExecution`, `InputParam`, `OutputParam`, `Constraint`, `InputParamType`, `InputParamFetcherType`, `OutputParamFetcherType`, `ConstraintType`).
3. **`ComposableExecutionLib.sol`** — The shared library implementing `processInputs()` and `processOutputs()` with the full resolution algorithm, all fetcher types, and constraint evaluation. This is the heart of the standard — any adapter delegates to this library.
4. **`Storage.sol`** — The external Storage contract providing namespaced key-value storage with per-account, per-caller isolation and initialized-slot tracking.
5. **`IPredicate.sol`** — The standard predicate interface.
6. **Predicate validator contracts** — Individual `IPredicate` implementations for each required predicate type (balance, native balance, nonce, timestamp, storage, custom call) plus a composite predicate for AND/OR logic.

**Adapters (demonstrating portability):**

6. **`ComposableExecutionModule.sol`** — An ERC-7579 executor module adapter wrapping the library.
7. **`ComposableExecution6900Plugin.sol`** — An ERC-6900 execution function adapter wrapping the same library.
8. **`ComposableExecutionBase.sol`** — An abstract base contract for native account integration.

All three adapters delegate to the same `ComposableExecutionLib`, demonstrating that the encoding and execution semantics are identical regardless of the account standard.

The reference implementation has been audited, with all findings remediated (see Security Considerations).

## Security Considerations

### Storage Isolation Between Accounts

When a composable execution adapter is a separate contract invoked via `call` (not `delegatecall`), multiple accounts share the adapter contract's storage. The storage slot derivation MUST include the account address to prevent cross-account data leakage. A missing or incorrect account address in the derivation would allow one account's captured values to be read or overwritten by another account's batch.

### Call vs Delegatecall Storage Context

This is the most security-critical implementation detail for adapter-based deployments. When invoked via `delegatecall`, the adapter's code executes in the calling account's storage context. When invoked via `call`, it executes in its own storage context. If the storage slot derivation does not account for this distinction, captured values written via one context may be misinterpreted or corrupted when read via the other.

Implementations MUST detect the execution context and derive storage slots accordingly. The recommended approach is to include both the `account` address and the `caller` address (`msg.sender`) in the slot derivation. Under `delegatecall`, `msg.sender` is the account itself; under `call`, `msg.sender` is the account but `address(this)` is the adapter. This asymmetry MUST be handled.

The reference implementation addresses this with a context-detection mechanism that was the subject of a critical audit finding (storage corruption when `delegatecall` was not properly distinguished), resolved prior to release.

This concern does not apply to native account integrations where the composable execution logic runs in the account's own context.

### Native Value Forwarding

Implementations that forward ETH (`msg.value`) through the composable execution flow MUST ensure that:

- The total ETH forwarded across all entries does not exceed the ETH provided to the batch call.
- ETH value injection (via runtime value sources) correctly updates the forwarded amount.
- No ETH is locked in the adapter contract after execution.

Incorrect `msg.value` handling in composable execution has been identified as a security-relevant concern in prior implementations.

### Runtime Value Manipulation

Runtime values (balances, `staticcall` results) are read at execution time and may be subject to manipulation within the same transaction (e.g., via flash loans or sandwich attacks). Constraints partially mitigate this by enforcing bounds on resolved values, but they do not eliminate the risk.

Users and SDK implementers SHOULD:
- Set meaningful constraints on resolved values (e.g., `GTE` with a minimum expected amount).
- Be aware that `balanceOf` and similar calls reflect the account's state at that point in the transaction, which may include flash-loaned tokens.
- Use `GTE` constraints with a non-zero reference value to prevent zero-value resolutions that could cause downstream reverts or economic loss.

### Predicate Evaluation Integrity

Predicate validators evaluate on-chain state and are subject to the same trust model as the underlying chain:

- Predicates reflect state at the time of the `staticcall`. State may change between predicate evaluation and instruction inclusion in a block.
- Cross-chain predicates inherit the trust assumptions of the queried chain. Orchestration does not introduce additional trust assumptions.
- Predicate validators MUST NOT have side effects. They MUST be callable via `staticcall`.

### Relayer Trust Model

In orchestration flows, relayers evaluate predicates and submit gated instructions. The security model does not require trusting relayers:

- Relayers cannot execute unauthorized instructions — each instruction is verified against a user-signed authorization (e.g., a Merkle root) on-chain.
- Relayers cannot forge predicate results — predicates are evaluated on-chain at execution time, not off-chain.
- A malicious relayer can only withhold execution (liveness failure), not steal funds or execute unauthorized operations. Users MAY mitigate liveness risk by authorizing multiple independent relayers.

### Reentrancy

Each call in the composable batch is an external call to an arbitrary target. Implementations MUST be resistant to reentrancy — a malicious target contract could attempt to re-enter the composable execution function to manipulate captured slots or execution state. Standard reentrancy guards (e.g., a mutex) SHOULD be used.

### Gas Overhead

The composable execution layer adds gas overhead for:

- Cross-contract calls to the Storage contract for captured return value writes and reads
- External `staticcall`s for runtime value resolution (e.g., `balanceOf` calls, Storage reads)
- Constraint evaluation
- Calldata construction (parameter concatenation)

This overhead is generally modest relative to the gas cost of the underlying DeFi operations and is substantially less than the cost of deploying and maintaining custom smart contracts for each multi-step flow.

## Copyright

Copyright and related rights waived via [CC0](../LICENSE.md).
