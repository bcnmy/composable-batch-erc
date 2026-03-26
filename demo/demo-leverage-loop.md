# Demo: Leverage Loop — Showcase for Smart Batching ERC

## What This Demo Showcases

Three core capabilities of the Smart Batching standard:

1. **Runtime state reads** — Reading protocol state (Aave borrow capacity) during execution and using the result as input to the next call. Not possible with static batching.

2. **Dustless execution via runtime balances** — Every supply and swap uses the actual token balance at that moment. No guessing, no dust left behind, no reverts from stale estimates.

3. **Post-execution safety guards** — A health factor check at the end of the entire flow guarantees the user's position meets their safety threshold. If it doesn't, the entire transaction reverts atomically. The user gets strong guarantees before signing.

## User-Facing Parameters

The user sets three things:

| Parameter | Description | Example |
|---|---|---|
| **Amount** | ETH to leverage (or "Max" for full balance) | 1.0 ETH |
| **Leverage target** | Desired exposure multiplier | 2x, 3x, 4x |
| **Safety floor** | Minimum acceptable health factor | 1.5 |

Everything else is derived by the SDK.

### Deriving Loop Count from Leverage Target

Aave WETH LTV on Base ≈ 80%. Each loop iteration adds LTV^N to the exposure:

```
After 1 loop:  1 + 0.80 = 1.80x
After 2 loops: 1 + 0.80 + 0.64 = 2.44x
After 3 loops: 1 + 0.80 + 0.64 + 0.512 = 2.95x
After 4 loops: 1 + 0.80 + 0.64 + 0.512 + 0.41 = 3.36x
After 5 loops: 1 + 0.80 + ... + 0.328 = 3.69x

General: leverage = (1 - LTV^(N+1)) / (1 - LTV)
```

## Target Chain: Base

| Contract | Address |
|---|---|
| Aave V3 Pool | `0xA238Dd80C259a72e81d7e4664a9801593F98d1c5` |
| WETH | `0x4200000000000000000000000000000000000006` |
| USDC | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` |
| Uniswap SwapRouter02 | `0x2626664c2603336E57B271c5C0b26F421741e481` |
| WETH/USDC Pool | `0x6c561B446416E1A00E8E93E221854d6eA4171372` (0.3% fee tier) |

## Contracts to Deploy

| Contract | Status | Purpose |
|---|---|---|
| `ComposableExecutionModule` | Exists | ERC-7579 module — the core |
| `Storage` | Exists | Namespaced key-value store |
| `AaveLens` | **New** (~35 lines) | Read Aave state + math in one call |

## The Composable Batch (3-loop example ≈ 3x leverage)

### Setup Entries

```
ENTRY 0 — Wrap native ETH → WETH
  functionSig: 0xd0e30db0 (deposit)
  TARGET:    RAW_BYTES → WETH
  VALUE:     BALANCE   → native ETH balance of account
  Features shown: BALANCE fetcher for native ETH, VALUE paramType

ENTRY 1 — Approve WETH for Aave (runtime balance)
  functionSig: 0x095ea7b3 (approve)
  TARGET:    RAW_BYTES → WETH
  CALL_DATA: RAW_BYTES → aavePool (spender)
  CALL_DATA: BALANCE   → (WETH, account)
  Features shown: BALANCE fetcher for approval amount (no infinite approvals)
```

### Loop Iteration (repeated N times)

```
ENTRY — Approve WETH for Aave (runtime balance from previous swap)
  functionSig: 0x095ea7b3 (approve)
  TARGET:    RAW_BYTES → WETH
  CALL_DATA: RAW_BYTES → aavePool
  CALL_DATA: BALANCE   → (WETH, account)
  [Skipped for iteration 1 — covered by setup Entry 1]

ENTRY — Supply all WETH to Aave
  functionSig: 0x617ba037 (supply)
  TARGET:    RAW_BYTES → aavePool
  CALL_DATA: RAW_BYTES → WETH address
  CALL_DATA: BALANCE   → (WETH, account)              ← dustless: full balance
      constraints: [GTE(minWeth)]
  CALL_DATA: RAW_BYTES → account (onBehalfOf)
  CALL_DATA: RAW_BYTES → 0 (referralCode)

ENTRY — Borrow USDC (runtime-computed amount from Aave lens)
  functionSig: 0xa415bcad (borrow)
  TARGET:    RAW_BYTES    → aavePool
  CALL_DATA: RAW_BYTES    → USDC address
  CALL_DATA: STATIC_CALL  → aaveLens.getSafeBorrowAmount(pool, account, 6, 80, 100)
      constraints: [GTE(minBorrowUsdc)]                ← runtime state read + math
  CALL_DATA: RAW_BYTES    → 2 (variable rate)
  CALL_DATA: RAW_BYTES    → 0 (referralCode)
  CALL_DATA: RAW_BYTES    → account (onBehalfOf)

ENTRY — Approve USDC for Uniswap (runtime balance)
  functionSig: 0x095ea7b3 (approve)
  TARGET:    RAW_BYTES → USDC
  CALL_DATA: RAW_BYTES → uniswapRouter
  CALL_DATA: BALANCE   → (USDC, account)

ENTRY — Swap all USDC → WETH
  functionSig: 0x04e45aaf (exactInputSingle)
  TARGET:    RAW_BYTES → uniswapRouter
  CALL_DATA: RAW_BYTES → USDC (tokenIn)
  CALL_DATA: RAW_BYTES → WETH (tokenOut)
  CALL_DATA: RAW_BYTES → 3000 (fee tier)
  CALL_DATA: RAW_BYTES → account (recipient)
  CALL_DATA: BALANCE   → (USDC, account)               ← dustless: full balance
  CALL_DATA: RAW_BYTES → minWethOut (amountOutMinimum)
  CALL_DATA: RAW_BYTES → 0 (sqrtPriceLimitX96)
```

### Final Entries

```
ENTRY — Final supply (deposit last swap's WETH, no more borrowing)
  Same as supply entry above — BALANCE(WETH) captures whatever the last swap returned.

ENTRY — Health factor safety guard (PREDICATE)
  functionSig: 0x00000000 (no call — predicate entry)
  CALL_DATA: STATIC_CALL → aaveLens.getHealthFactor(pool, account)
      constraints: [GTE(userMinHealthFactor)]           ← safety guard
  If health factor < user's threshold → entire batch reverts.
  User gets atomic guarantee: either safe position or no position.
```

### Entry Count Summary (3-loop example)

| Phase | Entries |
|---|---|
| Wrap ETH + first approval | 2 |
| Loop 1 (supply, borrow, approve USDC, swap) | 4 |
| Loop 2 (approve WETH, supply, borrow, approve USDC, swap) | 5 |
| Loop 3 (approve WETH, supply, borrow, approve USDC, swap) | 5 |
| Final supply + health check | 2 |
| **Total** | **18 entries** |

## Key Technical Details

### Uniswap SwapRouter02 Encoding
`exactInputSingle` takes a struct of all static types (no dynamic fields).
ABI encodes as 7 sequential 32-byte words with no offset pointer.
Each struct field maps to one CALL_DATA InputParam — concatenation produces correct encoding.
Selector: `0x04e45aaf`

### Aave Function Selectors
- `supply`: `0x617ba037`
- `borrow`: `0xa415bcad`
- `getUserAccountData`: `0xbf92857c`

### Aave Units
- `availableBorrowsBase`: USD with 8 decimals
- `healthFactor`: 18 decimals (≥ 1e18 = safe)
- USDC: 6 decimals
- Lens handles conversion: `availableBorrowsBase * 10^6 / 10^8 = USDC amount`

### Why AaveLens Exists
STATIC_CALL fetcher args are fixed at signing time. Cannot pass runtime value from one STATIC_CALL as input to another. The lens combines "read Aave state" + "extract field" + "convert units" + "apply fraction" in one view call. All args (pool, user, decimals, fraction) are signing-time-known. Only Aave's internal state is dynamic.
