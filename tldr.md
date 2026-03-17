## ERC-XXXX — Smart Batching: A Primer

**Authors:** Mislav Javor, Filip Dujmušić, Filipp Makarov, Venkatesh Rajendran
**Status:** Draft | **Type:** Standards Track (ERC)
**Created:** 2026-02-11 | **Requires:** ERC-4337, EIP-5792, ERC-6900, ERC-7579, ERC-7702

---

### What problem does this solve?

Today, Ethereum batch execution (via ERC-4337 / EIP-5792) is **static** — every parameter is frozen at signing time. But real-world DeFi produces dynamic, unpredictable outputs: a swap yields a variable token amount depending on slippage and MEV, a lending vault returns a variable share-to-asset conversion, a bridge delivers tokens after an unpredictable delay with variable fees.

Static batching forces a bad choice: hardcode optimistic amounts (risking reverts when the actual output is lower) or underestimate conservatively (leaving value stranded in the account). Both degrade UX and capital efficiency.

The only workaround today is deploying a custom smart contract for each multi-step flow. This introduces new attack surface and demands auditing, testing, and redeployment for every change — expensive, slow, and a poor security practice.

### What is smart batching?

Smart batching is a standard encoding where each parameter in a batch declares two things:

1. **How to obtain its value at execution time** (not at signing time)
2. **What conditions that value must satisfy** before the call proceeds

At execution, the EVM resolves each parameter on-chain, validates it against inline constraints, and constructs the calldata from scratch. No pre-encoded calldata. No stale data. No reverts from outdated estimates.

**Concrete example:** A user wants to swap 100 USDC for WETH, then supply all the WETH to a lending market. With static batching, the user must guess the swap output (say, 0.05 WETH) and hardcode it. If the swap actually returns 0.0495 WETH, the supply call reverts and the entire batch fails. With smart batching, the supply step says "read my current WETH balance on-chain and use that." It always works, and it always uses the full amount — no dust left behind.

---

### How does a parameter get its value? (Fetcher Types)

Each parameter specifies a **fetcher type** — the strategy for resolving its value at execution time:

| Fetcher | What it does | Used for |
|---------|-------------|----------|
| `RAW_BYTES` | Uses a literal value, known at signing time | Static amounts, known addresses, pre-computed hashes — anything that won't change between signing and execution |
| `STATIC_CALL` | Performs an arbitrary `staticcall` to any contract and uses the return data | Reading any on-chain state: oracle prices, allowances, nonces, previously captured return values from the Storage contract, or any view function on any contract |
| `BALANCE` | Queries an ERC-20 token balance or native ETH balance | Full-balance transfers, dustless operations, checking that bridged funds have arrived |

`STATIC_CALL` is intentionally general-purpose. Rather than defining a separate fetcher for every kind of on-chain read (allowances, oracle prices, nonces), the standard provides one fetcher that can call any contract. `BALANCE` exists as a convenience shorthand for the most common case: token and ETH balance queries.

### Where does the resolved value go? (Param Types)

Each parameter also specifies a **param type** — where the resolved value is routed:

| Param Type | What it does | Used for |
|------------|-------------|----------|
| `TARGET` | Sets the address the call is made to | Dynamically resolving which contract to call (at most one per entry; defaults to `address(0)` if absent) |
| `VALUE` | Sets the ETH amount forwarded with the call | Sending native ETH as part of the call (at most one per entry; defaults to 0 if absent) |
| `CALL_DATA` | Appended to the calldata being built | Function arguments — multiple `CALL_DATA` parameters are concatenated in order after the 4-byte function selector |

These two dimensions (fetcher type and param type) are orthogonal. Any fetcher can be combined with any param type. A `BALANCE` fetcher routed to `CALL_DATA` means "read my token balance and pass it as a function argument." A `STATIC_CALL` fetcher routed to `VALUE` means "read the ETH amount from a contract and send that much ETH with the call."

---

### How are values validated? (Constraints)

Every resolved parameter can carry **inline constraints** — on-chain assertions that must hold or the entire batch reverts. Constraints validate the resolved value *before* it is routed to its destination.

| Constraint | Meaning | Used for |
|------------|---------|----------|
| `EQ` | Value must equal the reference | Exact-match checks (e.g., confirming a specific address or expected hash) |
| `GTE` | Value must be greater than or equal to reference | Minimum-amount guards — the most common DeFi safety check (e.g., "swap output must be at least X") |
| `LTE` | Value must be less than or equal to reference | Maximum-amount caps (e.g., gas price ceilings, spend limits) |
| `IN` | Value must fall within [lower, upper] | Range-bound checks (e.g., oracle price within an acceptable band) |

**Why constraints matter:** Constraints are the safety layer. They turn a dynamically resolved value into a bounded, validated value. Without them, a resolved balance of zero could silently pass through and cause economic loss downstream. With a `GTE` constraint, the batch reverts instead — failing safely.

Constraints operate on `bytes32` comparisons, which naturally handle `uint256`, `address`, and other 32-byte types.

---

### What is a predicate entry? (Boolean gates on chain state)

A **predicate entry** is a batch entry that makes no call — it exists solely to check whether on-chain conditions are met. It falls out naturally from the design: when a `ComposableExecution` entry has no `TARGET` parameter, the target defaults to `address(0)` and the call is skipped. But the entry still resolves all its input parameters and validates their constraints. This makes it a pure boolean gate.

**What is it used for?** Predicate entries gate execution on chain state. A predicate entry at the start of a batch says "don't execute any of this unless these conditions hold." If the constraints fail, the entire batch reverts.

**Concrete example — balance gate:** A predicate entry with a `BALANCE` fetcher checking USDC balance with a `GTE(100e6)` constraint means "this batch requires at least 100 USDC in the account." If the balance is below 100 USDC, the batch reverts. No call is executed.

**Concrete example — timestamp gate:** A predicate entry with a `STATIC_CALL` fetcher reading `block.timestamp` from a helper contract, with a `GTE(TARGET_TIMESTAMP)` constraint, means "don't execute this batch until a specific time has passed."

Any on-chain state readable via `staticcall` can serve as a predicate condition — nonces, oracle prices, storage slots, timestamps — all through the same constraint mechanism. No separate predicate interface or contract is needed.

Multiple input parameters on a single predicate entry are implicitly AND-composed — all constraints on all parameters must pass.

---

### How does cross-chain orchestration work?

Predicate entries enable multi-chain orchestration without any additional mechanism. The flow works like this:

1. **The user signs once** — a single signature over a Merkle root (defined by a companion ERC) that covers batches across multiple chains.
2. **Each chain's batch includes predicate entries** gating it on the expected state change from a prior step. For example, batch B on Optimism has a predicate entry checking that the USDC balance is at least 100e6 — waiting for a bridge from L1 to complete.
3. **Relayers simulate each batch** via `eth_call`. If the predicate entries' constraints fail, the simulation reverts and the relayer waits. When the simulation succeeds (e.g., the bridged funds arrive), the relayer submits the transaction.

**Why this is credibly neutral:** Predicates observe *state*, not *mechanism*. The bridge in step 1 could be any provider — native rollup bridge, Across, ERC-7683, LayerZero — the predicate doesn't care. It just waits for the balance to appear. This makes the model agnostic to the interoperability layer.

**Relayers are untrusted.** They cannot forge constraint results (constraints are evaluated on-chain, not off-chain). They cannot execute unauthorized operations (each operation is verified against the user's signed Merkle root). A malicious relayer can only withhold execution (liveness failure), not steal funds. Users can mitigate liveness risk by authorizing multiple independent relayers.

---

### How do values pass between steps? (Storage Contract)

When a step's return value is needed by a later step, the standard provides an external **Storage contract** — a namespaced key-value store. Output parameters capture words from the return data and write them to Storage; input parameters in later steps read them back via a `STATIC_CALL` to `Storage.readStorage()`.

**However, this is the fallback pattern, not the preferred one.** The preferred approach is **stateless reads**: instead of capturing a swap's return value into Storage, the next step simply queries the account's current token balance directly via a `BALANCE` fetcher. The balance already reflects the swap's output. This is cheaper (no Storage writes/reads), simpler (no slot coordination), and more robust (no stale-data risk).

**When Storage is necessary:**
- The return value is the only way to obtain the data (no getter exists for the resulting state)
- Multiple values from a single return must be disaggregated (e.g., a function returning `(uint256 amountA, uint256 amountB)`)
- The needed value is an intermediate computation only available in the return data

**Storage isolation:** The Storage contract namespaces by `keccak256(account, caller)`, so one account's captured values cannot be read or overwritten by another account's batch. Reading an uninitialized slot reverts, preventing stale data from prior transactions from leaking in. Implementations may use EIP-1153 transient storage (`TSTORE`/`TLOAD`) for cheaper gas costs and automatic cleanup at transaction end.

---

### Why is this account-standard agnostic?

The smart account ecosystem has multiple competing architectures: ERC-7579, ERC-6900, native implementations, ERC-7702 delegation. This standard deliberately defines an **encoding format** and a single **interface** (`IComposableExecution`) rather than prescribing a specific module type.

| Integration path | How it works |
|-----------------|-------------|
| **ERC-7579** | Wrapped as an executor module; installs via standard module lifecycle |
| **ERC-6900** | Wrapped as an execution function / plugin; registers via standard manifest |
| **Native account** | Inherits `IComposableExecution` directly; no module wrapper needed |
| **ERC-7702 EOA** | Delegates to an implementation contract exposing `IComposableExecution`; no smart account deployment needed |

All four paths consume the exact same encoding and follow the same execution algorithm. Adapters are thin wrappers over a shared library. SDKs, relayers, and block explorers interact with one interface and one wire format regardless of the underlying account standard. No existing smart account requires migration.

---

### What does validation look like end-to-end?

For every entry in a composable batch, the execution algorithm follows this strict sequence:

1. **Resolve** each input parameter via its fetcher (`RAW_BYTES`, `STATIC_CALL`, or `BALANCE`)
2. **Validate** each resolved value against all its constraints (`EQ`, `GTE`, `LTE`, `IN`) — if any constraint fails, the entire batch reverts
3. **Route** each resolved value to its destination (`TARGET`, `VALUE`, or `CALL_DATA`)
4. **Execute** the call (skipped if target is `address(0)`, i.e., a predicate entry)
5. **Capture** output values to the Storage contract if output parameters are specified

This is atomic: if any `staticcall` fails, any constraint fails, or any call reverts, the **entire batch** reverts. There are no partial executions.

---

### What can you build with this?

Because parameters resolve at runtime with on-chain validation, and predicate entries gate execution on chain state, smart batching turns transactions into programs:

- **Dustless full-balance transfers** — use `BALANCE` fetcher to always send the exact current balance
- **Dynamic token splitting** — resolve a balance, apply constraints, split across multiple calls
- **MEV-aware execution guards** — constrain oracle prices or pool reserves before proceeding
- **Multi-step DeFi flows** — swap, supply, stake in one signed batch, each step using the actual output of the previous one
- **Cross-chain orchestration** — bridge on L1, swap and lend on L2, all gated by predicate entries and signed once

All of this is expressed as client-side TypeScript (compiled to the standard on-chain encoding), signed once, and executed entirely by the EVM. No Solidity required. No contract deployment. No per-flow audit cycles.

---

### Security summary

| Concern | How it's addressed |
|---------|-------------------|
| **Cross-account data leakage** | Storage contract namespaces by `(account, caller)` — different accounts get different namespaces |
| **Stale captured values** | Uninitialized slots revert; transient storage (EIP-1153) auto-clears at transaction end |
| **Untrusted relayers** | Constraints are evaluated on-chain; relayers can only withhold, not forge or steal |
| **Runtime value manipulation** (flash loans, sandwiching) | Constraints partially mitigate by enforcing bounds; users should set meaningful `GTE` minimums |
| **Reentrancy** | Implementations must use standard reentrancy guards; each batch call targets arbitrary external contracts |
| **ETH value forwarding** | Total forwarded ETH must not exceed `msg.value`; no ETH may be locked in the adapter after execution |
| **`call` vs `delegatecall` context** | Namespace includes `msg.sender`, so the two contexts produce different namespaces; accounts should use one consistently |

The reference implementation has been **audited** with all findings (including a critical `delegatecall` storage-corruption issue) remediated prior to release.
