# ERC-XXXX: Smart Batching

**Authors:** Mislav Javor, Filip Dujmušić, Filipp Makarov, Venkatesh Rajendran
**Status:** Draft | **Type:** Standards Track | **Category:** ERC
**Requires:** ERC-4337, EIP-5792, ERC-6900, ERC-7579, ERC-7702

---

## Abstract

This ERC defines **smart batching** — a composable batch encoding where each parameter declares how to obtain its value at execution time and what conditions that value must satisfy. Parameters resolve on-chain as literals, `staticcall` results, or balance queries, each validated against inline constraints before being assembled into the call. The same mechanism produces cross-chain orchestration: entries with no call target become pure boolean gates on chain state — predicate entries — enabling multi-chain flows signed once and executed when on-chain conditions are met.

The standard is encoding-first and account-standard-agnostic: one wire format and one interface (`IComposableExecution`) works as an ERC-7579 module, ERC-6900 plugin, native account method, or ERC-7702 delegation target.

## The Problem

ERC-4337 and EIP-5792 gave us batch execution — multiple calls under one signature — but every parameter is **static**: frozen at signing time, blind to on-chain state at execution. If a swap returns fewer tokens than estimated, gas costs shift, or a bridge delivers with unexpected slippage, the batch reverts. The only workaround is deploying custom smart contracts for each multi-step flow, which introduces new attack surface and demands auditing, testing, and redeployment for every change.

Real-world DeFi flows produce dynamic, unpredictable outputs:

- A swap yields a variable amount depending on price impact, slippage, and MEV
- A withdrawal from a lending vault returns a variable share-to-asset conversion
- A bridge delivers tokens after an unpredictable delay with variable fees
- A liquidation or rebalance depends on state that changes block-to-block

Static batching forces two bad choices: hardcode optimistic amounts (risking reverts) or underestimate conservatively (leaving value stranded).

## How Smart Batching Works

Instead of pre-encoding a static calldata blob, the user signs a batch where each parameter specifies *how* to obtain its value and *where* to route it. The execution logic resolves each parameter and constructs the calldata from scratch during the transaction.

**Three fetcher types** resolve values at execution time:

| Fetcher | What it does |
|---------|-------------|
| `RAW_BYTES` | Literal value, known at signing time |
| `STATIC_CALL` | Arbitrary `staticcall` to any contract — oracle prices, nonces, storage reads |
| `BALANCE` | ERC-20 or native ETH balance query |

**Three param types** route resolved values:

| Param Type | Destination |
|------------|------------|
| `TARGET` | Call target address |
| `VALUE` | ETH value to forward |
| `CALL_DATA` | Appended to calldata after the function selector |

**Four constraint types** validate resolved values before routing:

| Constraint | Meaning |
|------------|---------|
| `EQ` | Exact match |
| `GTE` | Greater than or equal (minimum-amount guards) |
| `LTE` | Less than or equal (maximum caps) |
| `IN` | Within [lower, upper] range |

If any constraint fails, the entire batch reverts.

## Predicate Entries and Cross-Chain Orchestration

A batch entry with no `TARGET` parameter (target defaults to `address(0)`) still resolves all parameters and validates constraints but skips the call — becoming a **predicate entry**, a pure boolean gate on chain state. No separate mechanism required.

This enables cross-chain orchestration: a user signs a single Merkle root (defined by a companion ERC) covering batches across multiple chains. Each chain's batch includes predicate entries gating it on expected state changes from prior steps. Relayers simulate via `eth_call`; when predicates pass, they submit. Because predicates observe *state*, not *mechanism*, orchestration is agnostic to the interoperability layer — native bridges, ERC-7683 intents, ERC-7786 messaging all work if they produce the expected state change.

Relayers are untrusted: they cannot forge constraint results (evaluated on-chain) or execute unauthorized operations (verified against the signed Merkle root). A malicious relayer can only withhold execution.

## Account-Standard Agnostic

The standard defines encoding and interfaces, not a specific module type:

| Integration | How |
|-------------|-----|
| **ERC-7579** | Executor module |
| **ERC-6900** | Execution function / plugin |
| **Native account** | Inherits `IComposableExecution` directly |
| **ERC-7702 EOA** | Delegates to implementation contract |

All paths consume the same encoding and follow the same execution algorithm. No existing smart account requires migration.

## Reference Implementation

A reference implementation accompanies the proposal, structured as:

- **`IComposableExecution.sol`** — The standard interface
- **`ComposabilityDataTypes.sol`** — All structs and enums
- **`ComposableExecutionLib.sol`** — Shared library with the full resolution algorithm, fetcher types, and constraint evaluation
- **`Storage.sol`** — External namespaced key-value storage for captured return values (supports EIP-1153 transient storage)
- **`ComposableExecutionModule.sol`** — ERC-7579 adapter
- **`ComposableExecutionBase.sol`** — Abstract base for native integration

The reference implementation has been audited, with all findings remediated.

## Relationship to Existing Work

- **ERC-4337 / EIP-5792:** Smart batching is additive. Existing UserOperation and `wallet_sendCalls` flows are unchanged. Composable execution installs alongside existing infrastructure.
- **ERC-7579 / ERC-6900:** The `IComposableExecution` interface wraps as a standard module or plugin. Installation uses the existing lifecycle of each standard.
- **ERC-7702:** Delegated EOAs gain composable execution without a smart account deployment.
- **EIP-8141 (Frame Transactions):** Forward-compatible. The same `ComposableExecution[]` encoding will execute within `SENDER` frames when available.
- **ERC-7683 / ERC-7786:** Predicate entries are credibly neutral with respect to the interoperability layer.

## Links

- Full ERC draft: *[link to PR]*
- Reference implementation: *[link to repo]*

## Call for Feedback

We're looking for community input on:

1. **Fetcher type coverage.** Are `RAW_BYTES`, `STATIC_CALL`, and `BALANCE` sufficient, or are there common resolution patterns that justify a dedicated fetcher type?

2. **Constraint expressiveness.** The current set (`EQ`, `GTE`, `LTE`, `IN`) covers the common cases. Are there predicate patterns that would benefit from additional constraint types (e.g., `NEQ`, bitwise masks)?

3. **Calldata construction vs. placeholder patching.** We chose to build calldata from individually resolved parameters rather than patching pre-encoded calldata at sentinel offsets. Does this create friction for any use cases?

4. **Storage contract design.** Captured values pass through an external Storage contract. The preferred pattern is stateless reads (e.g., `BALANCE` after a swap), with Storage as a fallback. Is the Storage interface adequate, or are there missing capabilities?

5. **Cross-chain predicate model.** Predicates gate on on-chain state observed via `staticcall`. Are there cross-chain orchestration patterns where this model breaks down?

6. **Account-standard integration.** We provide ERC-7579 and native adapters. Are there integration concerns with ERC-6900 or ERC-7702 that we should address in the spec?
