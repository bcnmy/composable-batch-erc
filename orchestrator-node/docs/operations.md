# MEE Node operations

Runbooks and operational notes for running and managing the MEE Node. For a step-by-step tutorial (why the master EOA exists, where fees go, what is auto-funded, chain and RPC requirements, chain type and payment tokens, arbitrary payment, permit, trusted gas tank, and connecting with the SDK), see [Run and maintain the node (tutorial)](run-and-maintain.md).

## Startup order

1. **Redis**  
   Start Redis and ensure it is reachable on `REDIS_HOST:REDIS_PORT`.

2. **Token Storage Detection service**  
   Start the service and ensure it listens on the URL set in `TOKEN_SLOT_DETECTION_SERVER_BASE_URL`. Configure RPCs for all chains you will support in the node.

3. **Node**  
   Set at least `NODE_ID`, `NODE_PRIVATE_KEY`, and any chain/RPC config (e.g. `CUSTOM_CHAINS_CONFIG_PATH`). Ensure the **master EOA** is funded on each chain you run (for paymaster deployment and, if applicable, top-ups). See [Master EOA and paymaster funding](#master-eoa-and-paymaster-funding). Then start the node:
   - `bun run start` (production)
   - `bun run start:dev` (development)

If Redis or the token-storage service is down, the node may start but quotes/simulations/executions and health will be affected. Check `/v1/info` after startup.

## Checking health

- **GET /v1/info**  
  Returns node version, supported chains, and health for:
  - Redis
  - Token Slot Detection (per chain, soft)
  - Chains (RPC, etc.)
  - Simulator / Executor (queues)
  - Node (wallets)
  - Workers

Use this to confirm both dependencies and internal components are healthy.

## Configuration

The node supports **three ways** to supply configuration and secrets (e.g. the master EOA private key):

1. **Environment variables** — Set `NODE_PRIVATE_KEY` and other vars in `.env` or in your process environment (e.g. systemd, Kubernetes secrets). Plain text; suitable for local or controlled environments.
2. **Environment variables only** — Same as above but without a `.env` file (e.g. all vars from the orchestrator). The node still requires `NODE_PRIVATE_KEY` to be set.
3. **Encrypted keystore (optional)** — In **production** or **staging** (`NODE_ENV=production` or `NODE_ENV=staging`), the node can load secrets from an **encrypted file** at **`keystore/key.enc`**. The file is decrypted at startup using **`ENV_ENC_PASSWORD`** (the password you used to encrypt the file). Decrypted keys (e.g. `NODE_PRIVATE_KEY`) are then available to the node. This keeps the private key encrypted at rest; only `ENV_ENC_PASSWORD` needs to be provided at runtime (e.g. via a secure secret manager). The node uses `@chainlink/env-enc`: create the encrypted file with the env-enc CLI (e.g. `npx env-enc set` after `npx env-enc set-pw`), then place the output file at **`keystore/key.enc`** in the working directory. Ensure **`ENV_ENC_PASSWORD`** is set when starting the node so the keystore can be decrypted. If the keystore is present and the password is correct, the decrypted variables override or supplement those from `.env`.

- **Chains**: Configure via built-in chain list or `CUSTOM_CHAINS_CONFIG_PATH`. RPC URLs and batch gas limits are critical for simulator and executor behavior.

- **Workers**:  
  - `NUM_CLUSTER_WORKERS`: number of API processes.  
  - `MAX_EXTRA_WORKERS`: extra EOA accounts from mnemonic for execution.  
  Tune based on load and RPC limits.

## Master EOA and paymaster funding

The node uses a **master EOA** (from `NODE_PRIVATE_KEY`) and optionally **worker EOAs**. Workers are derived from **`NODE_ACCOUNTS_MNEMONIC`** or **`NODE_ACCOUNTS_PRIVATE_KEYS`** (mnemonic is the easiest). Two parameters control how many workers are used:

- **`MAX_EXTRA_WORKERS`** (env) — Global maximum number of worker EOAs that can be used on **any** chain.
- **`executor.workerCount`** (per chain in chain config) — Number of workers to use on that chain. Can be from **0** (use master only) up to **`MAX_EXTRA_WORKERS`**. More workers allow higher throughput (more transactions in parallel).

All funding for paymaster deployment and for workers comes from the **master EOA**. This section describes what is funded at boot and what you must maintain.

### Master EOA balance (per chain)

The **master EOA** must hold enough **native token on each chain** where the node runs to cover:

1. **Deploying the paymaster contract** — If the paymaster for that chain and master EOA is not yet deployed, the node deploys it at startup. Deployment costs gas.
2. **Initial paymaster funding** — The amount in chain config (`paymasterFunding`) is sent to the paymaster **only during that first deployment**. If the paymaster contract already exists, the node **does not** send `paymasterFunding` again. You must **manually** track paymaster balance and top it up when needed.
3. **Funding workers** — See [Funding workers (how and when)](#funding-workers-how-and-when) below.

### Funding workers (how and when)

Workers are funded **at every node boot**, per chain, **after** the paymaster is deployed (if needed) and workers are whitelisted. The logic is implemented in the node’s `fundWorkers` step.

**When:** On each startup, for each chain, the node runs in order: (1) deploy and fund paymaster (if not deployed), (2) whitelist workers on the paymaster, (3) **fund workers**. So worker funding runs every time the node starts, for every chain that has `executor.workerCount` > 0.

**Who is funded:** The first **`executor.workerCount`** worker EOAs (derived from `NODE_ACCOUNTS_MNEMONIC` or `NODE_ACCOUNTS_PRIVATE_KEYS`), up to at most **`MAX_EXTRA_WORKERS`** and the number of accounts you have. If `workerCount` is 0, no workers are funded (the master EOA is the only executor).

**Target balance:** Each of these workers is topped up to **`executor.workerFunding`** (chain config; default in the schema is **0.001** native token, e.g. 0.001 ETH). The node reads each worker’s current balance; for any worker below `workerFunding`, it computes the shortfall.

**How much is sent (disperse):** The master EOA calls the **disperse** contract’s **`disperseEther`** with a list of worker addresses and a list of amounts. For each worker, the amount is **max(0, workerFunding − current balance)**. Only workers with a positive shortfall are included. The **total value** of the tx is the **sum of those amounts**; that is exactly how much native token the master EOA sends in that one transaction.

**Example (one chain):** `workerFunding` = 0.001 ETH, 3 workers, balances 0, 0, 0.0005 ETH. Shortfalls: 0.001, 0.001, 0.0005 → **total 0.0025 ETH** from master EOA in one disperse tx (plus gas for that tx). After the tx, each worker has 0.001 ETH.

**Example (workers already topped up):** Same config, but all 3 workers already have ≥ 0.001 ETH. All shortfalls are 0 → no disperse tx is sent; the node logs “No workers require funding. Skipping funding.”

### How much the master EOA needs (per chain, at boot)

Reserve enough native token on each chain so the master EOA can cover:

| Item | When | Amount (examples) |
|------|------|--------------------|
| Paymaster deploy + initial funding | Only if paymaster not yet deployed | **Gas for 1 tx** (deploy) + **`paymasterFunding`** (e.g. **0.025** ETH from chain config default). So e.g. ~0.03 ETH on first run. |
| Worker funding | Every boot if `workerCount` > 0 and any worker below target | **Gas for 1 disperse tx** + **sum of (workerFunding − balance)** for each worker below `workerFunding`. With default **workerFunding = 0.001** and 3 workers at zero: **~0.003 ETH** + gas. |
| Paymaster already deployed | Every boot when no workers need funding | **0** (no paymaster or worker tx). |

**Concrete example (first boot, one chain):** Paymaster not deployed, 3 workers, all at 0, defaults (`paymasterFunding` 0.025, `workerFunding` 0.001). Master EOA needs: **~0.025 ETH** (paymaster deploy + fund) + **~0.003 ETH** (disperse to 3 workers) + **gas for 2 txs** (deploy + disperse). So on the order of **~0.03 ETH** plus gas. Exact gas depends on the chain.

**Later boots (same chain):** Paymaster already deployed → no paymaster tx. If workers are still at or above 0.001, no disperse. If you restarted and workers were drained: again **disperse shortfalls only** (e.g. 3 × 0.001 = 0.003 ETH) + gas for 1 tx.

### Tracking and topping up paymaster balance

Paymaster balance is **not** topped up automatically after the first deploy. Monitor **`/v1/info`**: the node reports paymaster balance and healthy/unhealthy per chain. When balance falls below `paymasterFundingThreshold`, the node marks it unhealthy and workers cannot relay until you top up.

**To top up:** Go to the **official EntryPoint v7** contract address for that chain (see your chain config or a block explorer). Call **`deposit()`** (or the equivalent that credits the paymaster), with the **paymaster contract address as the beneficiary**. You can send native coin from any account; the deposit is credited to the paymaster. Repeat as needed to keep the node operational.

### Worker EOA balance and paymaster refund

Each **worker EOA** (or the master when used as the only worker) needs two things to relay:

1. **Minimum native balance** — Set in chain config as `executor.workerFundingThreshold`. The worker must have at least this much native token to be able to submit an EVM transaction. This minimum **limits the maximum executable call gas limit** for that chain: if the threshold is too low, large transactions will fail. Set it high enough for the biggest transaction you expect to execute on that chain.
2. **Sufficient paymaster balance** — The worker pays gas via the paymaster (userOps). After a successful execution, the worker is **refunded** from the paymaster balance. So the worker’s own native balance stays roughly constant (or increases slightly if the refund exceeds the actual cost). If the paymaster balance is too low, refunds fail and workers cannot continue relaying.

In short: keep the **master EOA** funded for one-time deploy and any manual top-ups you do; keep **paymaster** balance above threshold via manual top-ups; and set **workerFundingThreshold** high enough so workers can execute your largest expected transactions.

## Logs

- **Level**: `LOG_LEVEL` (e.g. `info`, `debug`).  
- **Format**: JSON by default; set `PRETTY_LOGS=1` for development.  
- **Callers**: Optional `LOG_CALLERS` for file/line in log lines.

Use logs to debug quote/execution flow, queue delays, and RPC or token-storage errors.

## Graceful shutdown

The process handles SIGTERM (e.g. when using `tini` in Docker). Allow a few seconds for in-flight requests and job processing to finish before forcing kill.

## Dependency failures

### Redis unreachable

- **Symptom**: Health check fails for Redis; queues do not advance; new quotes may not be stored.  
- **Actions**:  
  - Verify Redis is running and reachable from the node (firewall, `REDIS_HOST`/`REDIS_PORT`).  
  - Restart Redis if needed; the node will reconnect when Redis is back.

### Token Storage Detection unreachable or errors

- **Symptom**: Simulations that need token balance overrides can fail (e.g. "Token overrides failed" or "SlotNotFound"). Health may show token-slot-detection as unhealthy for some chains. The node still executes using default gas limits and can fall back to a **Redis-backed cache** of slots for tokens that were successfully detected at least once (persistent in Redis).
- **Actions**:  
  - Ensure the service is running and `TOKEN_SLOT_DETECTION_SERVER_BASE_URL` is correct.  
  - Ensure the service has RPCs configured for the chains you use (or use fork mode / Anvil for chains where the RPC does not support token detection).  
  - Check the service logs for RPC or slot-detection errors.

## Scaling

- **API**: Increase `NUM_CLUSTER_WORKERS` for more concurrent HTTP handlers.  
- **Execution**: Increase `MAX_EXTRA_WORKERS` (and provide `NODE_ACCOUNTS_MNEMONIC` or `NODE_ACCOUNTS_PRIVATE_KEYS`) to add more EOA workers for executor jobs.  
- **Redis**: Use a Redis cluster or managed service for high availability and throughput.  
- **Token Storage**: Run multiple instances behind a load balancer if needed; the node uses a single base URL.

## Docker

- **Node**: Use the official image with env vars for `NODE_ID`, `NODE_PRIVATE_KEY`, Redis, and `TOKEN_SLOT_DETECTION_SERVER_BASE_URL`. For Redis/token-storage on the host, use `host.docker.internal` (or equivalent) as hostname.  
- **Token Storage**: Build from `apps/token-storage-detection/Dockerfile` and run with the same env vars as when running from source (RPCs, optional Redis, port).  
- **Redis**: Use any Redis 7 image or the repo’s `compose.yml` for local dev.

## Troubleshooting checklist

1. Redis up and reachable? (`REDIS_HOST`, `REDIS_PORT`).  
2. Token Storage Detection up and URL correct? (`TOKEN_SLOT_DETECTION_SERVER_BASE_URL`).  
3. Node identity set? (`NODE_ID`, `NODE_PRIVATE_KEY`).  
4. Chains and RPCs configured? (built-in or `CUSTOM_CHAINS_CONFIG_PATH`).  
5. Master EOA and paymaster: master EOA funded on each chain? Paymaster balance above threshold? See [Master EOA and paymaster funding](#master-eoa-and-paymaster-funding).  
6. `/v1/info`: any module unhealthy?  
7. Logs: any repeated errors (RPC, token-slot, queue, or storage)?

For architecture and dependency details, see [architecture.md](architecture.md) and [dependencies.md](dependencies.md).
