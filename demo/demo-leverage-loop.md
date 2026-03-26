# Demo: Leverage Loop — Showcase for Smart Batching ERC

## What This Demo Showcases

Three core capabilities:

1. **Runtime state reads** — AaveLens (or ComposableLens) computes borrow capacity at execution time
2. **Dustless execution** — every supply and swap uses exact runtime balance via BALANCE fetcher
3. **Post-execution safety guard** — health factor predicate reverts everything if unsafe

## User-Facing Parameters

| Parameter | Description | Example |
|---|---|---|
| **Amount** | ETH to leverage (or "Max") | 1.0 ETH |
| **Leverage** | Target multiplier | 2x, 3x, 4x |
| **Safety floor** | Minimum health factor | 1.5 |

SDK derives loop count from leverage target: `leverage = (1 - 0.8^(N+1)) / 0.2`

## Target Chain: Base

| Contract | Address |
|---|---|
| Aave V3 Pool | `0xA238Dd80C259a72e81d7e4664a9801593F98d1c5` |
| WETH | `0x4200000000000000000000000000000000000006` |
| USDC | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` |
| Uniswap SwapRouter02 | `0x2626664c2603336E57B271c5C0b26F421741e481` |
| WETH/USDC Pool (0.3%) | `0x6c561B446416E1A00E8E93E221854d6eA4171372` |

## Contracts to Deploy

| Contract | Status | Purpose |
|---|---|---|
| `ComposableExecutionModule` | Exists | ERC-7579 module |
| `Storage` | Exists | Namespaced key-value store |
| `ComposableLens` | **New** | Generic read + math (covers 80% of use cases) |
| `AaveLens` | **New** (optional) | Aave-specific multi-field computations |

Two options for the demo:
- **With AaveLens**: cleaner SDK calls (`lens.read('getSafeBorrowAmount', [...])`)
- **With ComposableLens only**: no protocol-specific contracts (`lens.read('readWordMulDiv', [pool, calldata, 2, 80_000_000n, 10_000_000_000n])`)

Both are shown in [sdk/examples/leverage-loop.ts](../../sdk/examples/leverage-loop.ts).

## SDK Code (complete)

```typescript
import { parseEther, type Address } from 'viem'
import { composableBatch, token, native, contract } from '@erc-xxxx/sdk'

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
```

## Batch Structure (3-loop ≈ 3x leverage)

Each loop iteration:
1. **Approve WETH** → Aave (runtime balance)
2. **Supply WETH** → Aave (runtime balance, GTE constraint)
3. **Borrow USDC** → Aave (amount from AaveLens: 80% of capacity, runtime-computed)
4. **Approve USDC** → Uniswap (runtime balance)
5. **Swap USDC → WETH** → Uniswap (runtime balance, struct with dynamic `amountIn` field)

Plus setup (wrap) and final (supply + health check).

| Phase | Entries |
|---|---|
| Wrap ETH | 1 |
| Loop 1 (approve+supply+borrow+approve+swap) | 5 |
| Loop 2 | 5 |
| Loop 3 | 5 |
| Final supply + approve | 2 |
| Health factor check | 1 |
| **Total** | **19 entries** |

## Key Technical Details

### Uniswap Struct Encoding
`exactInputSingle` takes a struct of static types → SDK auto-flattens each field into individual InputParams. Dynamic `amountIn` field becomes a BALANCE fetcher param. Selector: `0x04e45aaf`.

### AaveLens Math
`getSafeBorrowAmount(pool, user, 6, 80, 100)` internally:
1. Calls `pool.getUserAccountData(user)` → gets `availableBorrowsBase` (USD, 8 decimals)
2. Converts: `availableBorrowsBase * 10^6 / 10^8` → USDC amount
3. Applies fraction: `* 80 / 100` → 80% of capacity

### Health Factor Check
`getHealthFactor(pool, user)` returns uint256 with 18 decimals. GTE constraint checks `healthFactor >= 1.5e18`. If position is unsafe → entire batch reverts atomically.
