# MEE Node dependencies

The node depends on two external services: **Redis** and the **Token Storage Detection** service. Both must be running and reachable for normal operation.

## Redis

### Role

- **Job queues (BullMQ)**  
  Simulator and executor queues are backed by Redis. Each supported chain has its own simulator and executor queue. If Redis is down or unreachable, no simulation or execution jobs are processed.

- **Quote and UserOp storage**  
  When a quote is created (e.g. via `/v1/quote`), the quote and its userOps are stored in Redis. The execute endpoint and internal batching load this data by quote hash / userOp hash. Keys are namespaced (e.g. `storage:quote:...`, `storage:user-op:...`).

- **Caching**  
  The node uses Redis for generic cache (e.g. token slot results, price data) via `StorageService.getCache` / `setCache` with TTL.

### Configuration

| Variable    | Default     | Description        |
|------------|-------------|--------------------|
| `REDIS_HOST` | `localhost` | Redis host         |
| `REDIS_PORT` | `6379`      | Redis port         |

Defined in `src/modules/core/redis/redis.config.ts`. Used by `RedisService`, which is shared by storage, queues, and health check.

### Running Redis

- **Docker (plain Redis)**  
  ```bash
  docker run -d --name redis -p 6379:6379 redis:7-alpine
  ```

- **Project Compose**  
  The repo’s `compose.yml` includes a `redis-stack` service (ports 6379 and 8001).  
  ```bash
  docker compose up -d redis-stack
  ```

- **Production**  
  Use a managed Redis (e.g. AWS ElastiCache, Redis Cloud) or your own cluster. Ensure the node’s `REDIS_HOST` / `REDIS_PORT` (and any network/firewall) allow connections.

### Eviction policy (recommended)

The node does **not** set TTL on quote and userOp keys; only the generic cache layer uses TTL when `setCache(..., { ttl })` is called. Over time, `storage:quote:*` and `storage:user-op:*` keys can grow. To avoid unbounded memory use, configure Redis with an **eviction policy** so older or less-used keys can be evicted when memory is limited.

**Suggested configuration** (in `redis.conf` or via server args):

- **maxmemory**: Set a limit (e.g. `maxmemory 2gb`).
- **maxmemory-policy**: Use a policy that fits your workload, for example:
  - `volatile-lru` — evict least recently used keys among those that have a TTL (cache keys; quote/userOp keys have no TTL so they are not evicted by this policy).
  - `allkeys-lru` — evict least recently used keys across all keys. Use this if you want quote/userOp data to be evictable under memory pressure (execution of very old quotes may then fail if data was evicted).
  - `allkeys-lru` is a good default for open-source deployments where controlling memory is important; be aware that evicted quote/userOp data cannot be recovered.

Example for a dedicated Redis used by the node:

```conf
maxmemory 2gb
maxmemory-policy allkeys-lru
```

Alternatively, use a policy like `volatile-ttl` if you only want to evict cache keys that have TTL and you accept that quote/userOp keys never expire (ensure `maxmemory` is large enough).

### Health check

The master runs a periodic health check that uses Redis (e.g. `CLIENT LIST`). If Redis is unhealthy, the node reports it and chain health is considered degraded (all chains depend on Redis for queues and storage). The result is exposed on `/v1/info` under the `redis` module.

---

## Token Storage Detection service

### Role

During **simulation**, the node needs correct state overrides for ERC20 balances. The storage layout of `balanceOf` (the slot used for `mapping(address => uint256)`) is token- and sometimes chain-specific. The **Token Storage Detection** service returns the balance storage slot for a given token contract and chain so the node can build the right overrides.

Used in:

- `TokenSlotDetectionService.getBalanceStorageSlot(tokenAddress, accountAddress, chainId)`  
- Called from the simulation path when building state overrides for tokens (e.g. payment tokens).

If the service is down or returns errors, simulations that need token balance overrides can fail; the node treats this as a **soft** health check (it does not mark the chain as unhealthy, but quote/simulation may still fail for affected requests).

### API contract

- **Base URL**: Configured by `TOKEN_SLOT_DETECTION_SERVER_BASE_URL` (default `http://127.0.0.1:5000`).
- **Endpoint**: `GET /{chainId}/{tokenAddress}`  
  - `chainId`: chain id (e.g. `1`, `8453`).  
  - `tokenAddress`: ERC20 contract address.  
- **Response**:  
  - Success: e.g. `{ success: true, msg: { slot: "0x3" } }` (slot in hex).  
  - Error: e.g. `{ success: false, error: "SlotNotFound" }`.

The node hashes the slot with the account address for mapping storage (see `getBalanceStorageSlot` in `token-slot-detection.service.ts`).

### Configuration

| Variable                             | Default                   | Description                    |
|-------------------------------------|---------------------------|--------------------------------|
| `TOKEN_SLOT_DETECTION_SERVER_BASE_URL` | `http://127.0.0.1:5000` | Base URL of the detection service |

No auth is configured in the node; the service is assumed to be internal or network-protected.

### Running the service

The service lives in **`apps/token-storage-detection`** (Rust). It needs RPC URLs for each chain it should support.

1. **From source**  
   ```bash
   cd apps/token-storage-detection
   cp .env.example .env
   # Set *_RPC or *_FORK_RPC for the chains you need (e.g. ETHEREUM_RPC, BASE_RPC)
   cargo run --release --bin token-storage-detection
   ```
   By default it listens on `SERVER_HOST:SERVER_PORT` (e.g. `127.0.0.1:3000`). The repo’s `.env.example` for the **node** uses port 5000; either set `SERVER_PORT=5000` in the token-storage app or set `TOKEN_SLOT_DETECTION_SERVER_BASE_URL` to the actual URL (e.g. `http://127.0.0.1:3000`).

2. **Docker**  
   Use the Dockerfile in `apps/token-storage-detection`. Build and run with the same env vars (RPCs, optional Redis, `SERVER_PORT`, etc.). Expose the chosen port and point the node’s `TOKEN_SLOT_DETECTION_SERVER_BASE_URL` at it.

3. **Optional Redis**  
   The token-storage app can use Redis for caching (see its `.env.example`: `REDIS_ENABLED`, `REDIS_HOST`, etc.). This is independent of the node’s Redis; the node only talks to the service over HTTP.

### Adding new chains (Token Storage service)

Unlike the MEE Node, where adding a standard EVM chain is usually a matter of **chain configuration** (see [Chain configuration](chain-configuration.md)), the Token Storage Detection service currently requires **code changes** to support a new chain:

1. **Add the chain to the `Chain` enum** in `apps/token-storage-detection/src/state.rs`.
2. **Implement `FromStr`** in the same file so that the chain id (e.g. `"8453"`) maps to the new enum variant.
3. **Set the RPC env var** for that chain (e.g. `BASE_RPC` or `BASE_FORK_RPC` in `.env`).

A future improvement would be to support a **chain config file or env-based chain list** so new chains can be added without code changes; until then, document this manual process for operators. The MEE Node only needs its chain config updated; the token server must be updated and redeployed for the same chain.

### RPC and boot behavior

The Token Storage service builds one RPC provider per configured chain at **startup**. If any chain uses an **unreliable or failing RPC** (or a Fork RPC that fails during Anvil spawn), the service can **panic or return an error** during `make_app_http_providers` and **exit**. The process may then restart (e.g. under Kubernetes) and keep crashing until the RPC is fixed or that chain is removed from config.

**Implications:**

- For open-source or multi-tenant use, one bad RPC can prevent the whole service from starting.
- Prefer stable RPCs; if you use an exotic chain or unreliable endpoint, consider running a minimal token-storage instance with only the chains you need, or fixing the service to **skip or retry** failing chains at boot instead of exiting (future improvement).

### Impact on execution when the token service fails

Token Storage Detection is used for **simulation** (balance overrides). It is **not** required for execution itself:

- If the token service is down or returns errors, the node may still **execute** supertransactions: the **default gas limit from the SDK** is used, which is sufficient for many flows.
- The node can fall back to a **Redis-backed cache** of balance storage slots: only tokens that were successfully resolved at least once (to detect their slot) are cached. This cache is **persistent** (stored in Redis).
- **Complex flows** (e.g. with custom token logic or higher gas needs) may **fail with insufficient gas** when token slot detection is unavailable and the token is not in the cache, because simulation cannot refine gas estimates.

So: token service failure does not block execution, but can reduce reliability for complex or first-time tokens. Health checks and monitoring for the token service are still recommended.

### Health check

The master runs a soft health check per chain by calling the token-storage service (e.g. for a supported payment token). Result is shown under the `token-slot-detection` module in `/v1/info`. Failures do not mark the chain as unhealthy but indicate that simulation may fail for tokens that need slot detection.

---

## Summary

| Dependency                 | Purpose                          | Required for           | Node env / config        |
|---------------------------|----------------------------------|-------------------------|--------------------------|
| **Redis**                 | Queues, quote/userOp storage, cache | All quote/exec and queues | `REDIS_HOST`, `REDIS_PORT` |
| **Token Storage Detection** | ERC20 balance slot for simulation  | Correct simulation overrides | `TOKEN_SLOT_DETECTION_SERVER_BASE_URL` |

Both should be running before starting the node. See [operations.md](operations.md) for startup order and troubleshooting.
