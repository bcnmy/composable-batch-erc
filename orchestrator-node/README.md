# Orchestrator Node

The Orchestrator Node simulates predicate conditions and submits composable batches for execution across multiple chains. It implements the orchestration layer for [ERC-8211 (Smart Batching)](https://ethereum-magicians.org/t/erc-8211-smart-batching/28135) — issuing cryptographically signed quotes for supertransactions and executing them atomically.

## Table of contents

- [Overview](#overview)
- [Architecture](#architecture)
- [Prerequisites](#prerequisites)
- [Dependencies](#dependencies)
  - [Redis](#redis)
  - [Token Storage Detection Service](#token-storage-detection-service)
- [Quick start (Docker Compose)](#quick-start-docker-compose)
- [Quick start (manual)](#quick-start-manual)
- [Configuration](#configuration)
- [Running the node](#running-the-node)
- [Docker](#docker)
- [API](#api)
- [Health and operations](#health-and-operations)
- [Further documentation](#further-documentation)

## Overview

The node:

- **Quotes** user intents (supertransactions) and returns signed quotes with gas limits, deadlines, and fees.
- **Executes** signed quotes on-chain: it simulates, batches, and submits transactions via worker processes.
- Uses **Redis** for job queues (BullMQ), quote/userOp storage, and caching.
- Uses a **Token Storage Detection** service to resolve ERC20 balance storage slots for simulation.

## Architecture

- **Master process**: Initializes chains, RPC manager, gas manager, batcher, health checks, and spawns workers.
- **API workers** (cluster): Serve HTTP API (quote, execute, info, explorer).
- **Simulator workers** (threads, per chain): Process simulation jobs from the queue.
- **Executor workers** (threads, per chain): Process execution jobs from the queue.

Quote flow: **Quote API** → **Storage (Redis)** → **Simulator queue** → **Batcher** → **Executor queue** → **Chain RPC**.

See [docs/architecture.md](docs/architecture.md) for details.

## Prerequisites

- [Docker](https://www.docker.com) and [Docker Compose](https://docs.docker.com/compose/) (recommended)
- [Bun](https://bun.sh) (only if running without Docker)
- [Rust toolchain](https://rustup.rs) (only if building the token-storage-detection service from source)

## Dependencies

The node requires two external services to run. Both are included in the Docker Compose setup.

### Redis

Redis is used for:

- **Job queues** (BullMQ): simulator and executor queues per chain
- **Storage**: quotes and userOps (by hash), and custom fields
- **Caching**: e.g. token slot detection, price feeds

**Eviction**: Quote and userOp keys are not set with TTL, so Redis can grow over time. For production, configure an eviction policy (e.g. `maxmemory` + `maxmemory-policy allkeys-lru`). See [docs/dependencies.md](docs/dependencies.md#eviction-policy-recommended) for details.

### Token Storage Detection Service

A separate HTTP service that returns the **ERC20 balance storage slot** for a given token and chain. The node calls it during simulation to build correct state overrides.

The service is implemented in Rust in `apps/token-storage-detection`. It exposes:

- `GET /{chainId}/{tokenAddress}` → `{ success, msg: { slot } }`

See [docs/dependencies.md](docs/dependencies.md#token-storage-detection-service) and [apps/token-storage-detection/README.md](apps/token-storage-detection/README.md).

## Quick start (Docker Compose)

The fastest way to run the full stack (node + Redis + token-storage-detection):

1. **Configure**

   ```bash
   cp .env.example .env
   # Set at least:
   # - NODE_ID (required)
   # - NODE_PRIVATE_KEY (required)
   # - Chain RPC URLs in your chain config
   ```

2. **Run**

   ```bash
   docker compose up
   ```

3. **Verify**

   Check [http://localhost:4000/v1/info](http://localhost:4000/v1/info) for version and health.

## Quick start (manual)

If you prefer to run services individually:

1. **Clone and install**

   ```bash
   cd orchestrator-node
   bun i
   ```

2. **Start Redis**

   ```bash
   docker run -d --name redis -p 6379:6379 redis:7-alpine
   ```

3. **Start Token Storage Detection** (see [apps/token-storage-detection](apps/token-storage-detection))

   ```bash
   cd apps/token-storage-detection
   cp .env.example .env   # set RPC URLs for chains you need
   cargo run --release --bin token-storage-detection
   ```

4. **Configure the node**

   ```bash
   cp .env.example .env
   # Set at least:
   # - NODE_ID (required)
   # - NODE_PRIVATE_KEY (required)
   # - REDIS_HOST / REDIS_PORT if not localhost:6379
   # - TOKEN_SLOT_DETECTION_SERVER_BASE_URL if not http://127.0.0.1:5000
   # - CUSTOM_CHAINS_CONFIG_PATH or use built-in chains
   ```

5. **Run the node**

   ```bash
   bun run start        # production
   bun run start:dev    # development (watch mode)
   ```

   API listens on `PORT` (default `4000`).

## Configuration

All options are documented in [.env.example](.env.example). Key groups:

| Area | Main variables |
|------|-----------------|
| **Server** | `PORT`, `NODE_ENV`, `ENV_ENC_PASSWORD` (production/staging secrets) |
| **Node identity** | `NODE_ID`, `NODE_PRIVATE_KEY`, `NODE_NAME`, `NODE_FEE_BENEFICIARY` |
| **Chains** | `CUSTOM_CHAINS_CONFIG_PATH`, batch gas limits, simulator/executor concurrency |
| **Redis** | `REDIS_HOST`, `REDIS_PORT` |
| **Token slot service** | `TOKEN_SLOT_DETECTION_SERVER_BASE_URL` |
| **Workers** | `NUM_CLUSTER_WORKERS`, `MAX_EXTRA_WORKERS`, queue attempts/backoff |
| **Logging** | `LOG_LEVEL`, `PRETTY_LOGS` |

For production/staging, the node can load encrypted secrets from `keystore/key.enc` (see `ENV_ENC_PASSWORD` and [src/common/setup.ts](src/common/setup.ts)).

## Running the node

| Command | Description |
|--------|--------------|
| `bun run start` | Run with Bun (uses `src/main.ts`); cluster + workers. |
| `bun run start:dev` | Watch mode; single process, all modules loaded. |
| `bun run build && bun run start:prod` | Build to `dist/` and run `dist/main.js`. |

Ensure Redis and the token-storage-detection service are up and reachable; otherwise quote/execute and health may fail. See [docs/operations.md](docs/operations.md) for runbooks.

## Docker

Build and run the node image locally:

```bash
docker build -t orchestrator-node .
docker run -e NODE_ID=... -e NODE_PRIVATE_KEY=... \
  -e REDIS_HOST=host.docker.internal \
  -e TOKEN_SLOT_DETECTION_SERVER_BASE_URL=http://host.docker.internal:5000 \
  -p 4000:4000 orchestrator-node
```

Or use `docker compose up` to run the full stack (recommended).

## API

| Method | Path | Description |
|--------|------|-------------|
| GET | `/v1/info` | Node version, supported chains, health (Redis, token-slot, queues, etc.) |
| GET | `/v1/explorer/:hash` | Get quote by hash (optional `confirmations`) |
| POST | `/v1/quote` | Request a quote (intent → signed quote) |
| POST | `/v1/quote-permit` | Request a quote with permit flow |
| POST | `/v1/exec` | Execute a signed quote |

The **quote** endpoint returns a signed quote (node's commitment). The **execute** endpoint accepts the user-signed quote, validates it, and runs the intent on the configured chains.

## Health and operations

- **`/v1/info`**: Returns node info and health for Redis, token-slot detection, chains, simulator, executor, and workers.
- **Logs**: Structured (Pino). Level via `LOG_LEVEL`; `PRETTY_LOGS=1` for development.
- **Graceful shutdown**: Use SIGTERM; the process uses `tini` in Docker.

See [docs/operations.md](docs/operations.md) for runbooks (startup, dependency checks, scaling, troubleshooting).

## Further documentation

- [docs/architecture.md](docs/architecture.md) — Process model, queues, and data flow
- [docs/dependencies.md](docs/dependencies.md) — Redis (including eviction) and Token Storage Detection in detail
- [docs/chain-configuration.md](docs/chain-configuration.md) — Adding and configuring chains
- [docs/operations.md](docs/operations.md) — Runbooks and operations
- [docs/run-and-maintain.md](docs/run-and-maintain.md) — Step-by-step tutorial
- [.env.example](.env.example) — All configuration options
