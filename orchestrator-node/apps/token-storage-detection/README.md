# Token Storage Detection service

HTTP service that returns the **ERC20 balance storage slot** for a given token contract and chain. Used by the MEE Node during simulation to build correct state overrides (e.g. for `balanceOf`).

## API

- **GET /{chainId}/{tokenAddress}**
  - `chainId`: chain id (e.g. `1`, `8453`)
  - `tokenAddress`: ERC20 contract address
  - Response: `{ success: true, msg: { slot: "0x3" } }` or `{ success: false, error: "..." }`

## Configuration

See `.env.example` in this directory. Main options:

- **Server**: `SERVER_HOST` (default `127.0.0.1`), `SERVER_PORT` (default `3000` in code; `.env.example` uses `5000` to match the node’s default)
- **Chains / RPCs**: For each chain you need, set either `{CHAIN}_RPC` (primary RPC with debug/trace) or `{CHAIN}_FORK_RPC` (e.g. for Anvil fork). Examples: `ETHEREUM_RPC`, `BASE_RPC`, `ETHEREUM_FORK_RPC`, etc. If the RPC does not support the debug/trace APIs required for token detection, use **fork mode** (`{CHAIN}_FORK_RPC`); **Anvil** is a good choice for such chains.
- **Redis** (optional): `REDIS_ENABLED=1`, `REDIS_HOST`, `REDIS_PORT`, `REDIS_PASSWORD`, `REDIS_IS_TLS` for response caching
- **Anvil** (optional): `ANVIL_ENABLED=1` and related options when using fork RPCs
- **Timeouts**: `TIMEOUT_MS`, `LOGGING_ENABLED`

## Adding a new chain

Unlike the MEE Node (where adding a standard EVM chain is usually configuration-only), this service requires **code changes**:

1. Add a variant to the **`Chain` enum** in `src/state.rs`.
2. Extend **`FromStr`** in the same file so the chain id (e.g. `"8453"`) parses to that variant.
3. Set the corresponding **RPC env var** (e.g. `BASE_RPC` or `BASE_FORK_RPC`) in `.env`.

See the main repo’s [Chain configuration](../../docs/chain-configuration.md) and [Dependencies — Token Storage](../../docs/dependencies.md#adding-new-chains-token-storage-service) for the full picture.

## Run locally

```bash
cp .env.example .env
# Set at least one chain RPC, e.g. ETHEREUM_RPC or ETHEREUM_FORK_RPC
cargo run --release --bin token-storage-detection
```

By default the node expects this service at `http://127.0.0.1:5000`. Either set `SERVER_PORT=5000` in `.env` or set the node’s `TOKEN_SLOT_DETECTION_SERVER_BASE_URL` to your URL (e.g. `http://127.0.0.1:3000`).

## Docker

Build and run with the same env vars (RPCs, optional Redis, `SERVER_PORT`, etc.):

```bash
docker build -t token-storage-detection .
docker run -p 5000:5000 -e SERVER_PORT=5000 -e ETHEREUM_RPC=... token-storage-detection
```

## Operational notes

- **RPC at boot**: The service builds one RPC provider per configured chain at startup. If **any** chain’s RPC (or Anvil fork) fails during init, the process can **exit** and may restart in a loop until the RPC is fixed. Use stable RPCs; for exotic or unreliable chains, consider a minimal instance with only the chains you need. See [Dependencies — RPC and boot behavior](../../docs/dependencies.md#rpc-and-boot-behavior).
- **When this service fails**: The MEE Node still executes supertransactions using the **default gas limit from the SDK**, which is sufficient for many flows. Complex flows may fail with insufficient gas. When the service is unavailable, the node can fall back to a **Redis-backed cache** of balance storage slots: tokens that were successfully resolved at least once (to detect their storage slot) are cached. This cache is **persistent** (stored in Redis). See [Dependencies — Impact on execution](../../docs/dependencies.md#impact-on-execution-when-the-token-service-fails).

## Relation to MEE Node

The MEE Node calls this service when simulating userOps that involve ERC20 balances. If the service is down or returns errors, those simulations can fail. See the main repo’s [docs/dependencies.md](../../docs/dependencies.md#token-storage-detection-service) for details.
