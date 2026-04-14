# Orchestrator Node Neutralization — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract the Biconomy mee-node into a standalone, neutral `/orchestrator-node/` folder that anyone can clone and run with `docker compose up`.

**Architecture:** Copy mee-node source (excluding k8s/, .github/, test/) into `/orchestrator-node/`. Apply surface-level neutralization: rename package, rewrite docs, neutralize code comments and one runtime string, add docker-compose.yml + .env.example.

**Tech Stack:** TypeScript (Bun), Docker, Docker Compose, Rust (token-storage-detection companion)

**Branch:** All work on `feat/orchestrator-node` branch.

---

### Task 1: Create branch and extract files

**Files:**
- Create: `orchestrator-node/` (directory tree)

- [ ] **Step 1: Create the feature branch**

```bash
cd /Users/filip/Projects/composable-batch-erc
git checkout -b feat/orchestrator-node
```

- [ ] **Step 2: Copy mee-node into orchestrator-node, excluding Biconomy infra**

```bash
mkdir orchestrator-node

# Copy all top-level files
cp mee-node/Dockerfile orchestrator-node/
cp mee-node/package.json orchestrator-node/
cp mee-node/bun.lock orchestrator-node/
cp mee-node/tsconfig.json orchestrator-node/
cp mee-node/tsconfig.build.json orchestrator-node/
cp mee-node/biome.json orchestrator-node/
cp mee-node/vitest.config.mjs orchestrator-node/
cp mee-node/.dockerignore orchestrator-node/
cp mee-node/docker-compose.observability.yml orchestrator-node/
cp mee-node/compose.yml orchestrator-node/
cp mee-node/TRACING_SETUP.md orchestrator-node/

# Copy directories (excluding k8s, .github, test)
cp -r mee-node/src orchestrator-node/
cp -r mee-node/apps orchestrator-node/
cp -r mee-node/docs orchestrator-node/
cp -r mee-node/dashboards orchestrator-node/
```

- [ ] **Step 3: Verify the extraction**

```bash
ls orchestrator-node/
```

Expected: `Dockerfile`, `apps/`, `biome.json`, `bun.lock`, `compose.yml`, `dashboards/`, `docker-compose.observability.yml`, `docs/`, `package.json`, `src/`, `tsconfig.build.json`, `tsconfig.json`, `vitest.config.mjs`, `.dockerignore`, `TRACING_SETUP.md`

- [ ] **Step 4: Commit the extraction**

```bash
git add orchestrator-node/
git commit -m "extract mee-node into orchestrator-node/ (unmodified copy)"
```

---

### Task 2: Neutralize package.json

**Files:**
- Modify: `orchestrator-node/package.json:2-5`

- [ ] **Step 1: Update package identity fields**

In `orchestrator-node/package.json`, make these edits:

Line 2: `"name": "mee-node"` → `"name": "orchestrator-node"`

Line 5: `"author": "Biconomy",` → remove this line entirely

- [ ] **Step 2: Verify the changes**

```bash
head -10 orchestrator-node/package.json
```

Expected: `"name": "orchestrator-node"`, no `"author"` line.

- [ ] **Step 3: Commit**

```bash
git add orchestrator-node/package.json
git commit -m "neutralize package.json identity"
```

---

### Task 3: Rewrite README.md

**Files:**
- Modify: `orchestrator-node/README.md` (full rewrite)

- [ ] **Step 1: Replace README.md with neutralized version**

Write the following content to `orchestrator-node/README.md`:

```markdown
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
```

- [ ] **Step 2: Commit**

```bash
git add orchestrator-node/README.md
git commit -m "rewrite README as neutral Orchestrator Node docs"
```

---

### Task 4: Neutralize docs/run-and-maintain.md

**Files:**
- Modify: `orchestrator-node/docs/run-and-maintain.md`

- [ ] **Step 1: Update the document title**

Line 1: `# Run and maintain the MEE Node — tutorial` → `# Run and maintain the Orchestrator Node — tutorial`

Line 3 (intro paragraph): Replace `MEE Node` with `Orchestrator Node` (first occurrence only — "MEE Node" in this line).

- [ ] **Step 2: Neutralize line 104 (trusted gas tank section)**

Line 104: Replace:
```
This is used for fully sponsored flows (e.g. Biconomy-hosted gas tank).
```
With:
```
This is used for fully sponsored flows (e.g. an operator-hosted gas tank).
```

- [ ] **Step 3: Neutralize line 117 (external gas tank section)**

Line 117: Replace:
```
   - **End user** must sign the **quote** by signing the **supertransaction hash** — best done using the utility functions provided in the **AbstractJS SDK** (e.g. for quote signing and execution).
```
With:
```
   - **End user** must sign the **quote** by signing the **supertransaction hash** — best done using the utility functions provided in a **compatible SDK** (e.g. for quote signing and execution).
```

- [ ] **Step 4: Neutralize section 10 header and content (lines 128-151)**

Line 128: Replace:
```
## 10. Monitoring the node and connecting with @biconomy/abstractjs
```
With:
```
## 10. Monitoring the node and connecting with an SDK
```

Line 135: Replace:
```
**When the node is fully set up and healthy:** Check that `/v1/info` shows all modules (Redis, chains, token-slot, simulator/executor, node wallets) in a healthy state. Then clients can use your node for quotes and execution by pointing the AbstractJS SDK at your node URL.
```
With:
```
**When the node is fully set up and healthy:** Check that `/v1/info` shows all modules (Redis, chains, token-slot, simulator/executor, node wallets) in a healthy state. Then clients can use your node for quotes and execution by pointing a compatible SDK at your node URL.
```

Line 137: Replace:
```
**Connecting to your node via AbstractJS:**
```
With:
```
**Connecting to your node via SDK:**
```

Lines 139-149: Replace:
```
To connect to your MEE Node (e.g. after it is running and healthy), use the **`@biconomy/abstractjs`** SDK and pass your node's base URL as the **`url`** option when creating the MEE client. All quote, quote-permit, and execute flows then go to your node instead of the default Biconomy network.

```ts
import { createMeeClient } from "@biconomy/abstractjs";

const meeClient = await createMeeClient({
  account: orchestrator,   // your orchestrator/smart account
  url: "https://your-mee-node-url",  // your MEE node base URL (e.g. https://mee.example.com)
  // apiKey: "optional-for-rate-limiting"
});
```

Use the client for quote, quote-permit, and exec as usual; traffic is sent to your node. Without `url`, the SDK uses the default Biconomy network.
```
With:
```
To connect to your Orchestrator Node (e.g. after it is running and healthy), use a compatible SDK and pass your node's base URL as the **`url`** option when creating the client. All quote, quote-permit, and execute flows then go to your node instead of a default network.

Example using `@biconomy/abstractjs` (one compatible SDK):

```ts
import { createMeeClient } from "@biconomy/abstractjs";

const meeClient = await createMeeClient({
  account: orchestrator,   // your orchestrator/smart account
  url: "https://your-node-url",  // your node base URL (e.g. https://orchestrator.example.com)
  // apiKey: "optional-for-rate-limiting"
});
```

Use the client for quote, quote-permit, and exec as usual; traffic is sent to your node.
```

- [ ] **Step 5: Neutralize line 122 (starter kit link)**

Line 122: Replace:
```
**Concrete example:** For a full implementation of how third parties can set up an external gas tank and use it with the node (including quote, signing, and execution), see the **[MEE self-hosted sponsorship starter kit](https://github.com/bcnmy/mee-self-hosted-sponsorship-starter-kit)**.
```
With:
```
**Concrete example:** For a full implementation of how third parties can set up an external gas tank and use it with the node (including quote, signing, and execution), see the **[self-hosted sponsorship starter kit](https://github.com/bcnmy/mee-self-hosted-sponsorship-starter-kit)**.
```

- [ ] **Step 6: Commit**

```bash
git add orchestrator-node/docs/run-and-maintain.md
git commit -m "neutralize run-and-maintain.md documentation"
```

---

### Task 5: Neutralize code comments

**Files:**
- Modify: `orchestrator-node/src/modules/quotes/quotes.service.ts:201,758,1355`
- Modify: `orchestrator-node/src/modules/simulator/simulation.service.ts:980,1330`

- [ ] **Step 1: Fix quotes.service.ts line 201**

Replace:
```
    // Biconomy hosted sponsorship will be considered as trusted sponsorship
```
With:
```
    // Hosted sponsorship will be considered as trusted sponsorship
```

- [ ] **Step 2: Fix quotes.service.ts line 758**

Same replacement — replace:
```
    // Biconomy hosted sponsorship will be considered as trusted sponsorship
```
With:
```
    // Hosted sponsorship will be considered as trusted sponsorship
```

- [ ] **Step 3: Fix quotes.service.ts line 1355**

Replace:
```
    // Biconomy hosted sponsorship userOp simulation is skipped
```
With:
```
    // Hosted sponsorship userOp simulation is skipped
```

- [ ] **Step 4: Fix simulation.service.ts line 1330**

Replace:
```
      // If sponsored ? The firstDevUserOp is considered to be a userOp at index=1. In that case index=0 is the biconomy gas tank nexus userOp.
```
With:
```
      // If sponsored ? The firstDevUserOp is considered to be a userOp at index=1. In that case index=0 is the gas tank nexus userOp.
```

- [ ] **Step 5: Fix simulation.service.ts line 980**

Replace:
```
        // This code is taken from AbstractJs SDK. The SDK can be installed and reused but copying this small chunk avoid additional dependencies
```
With:
```
        // This code is taken from the AbstractJs SDK (github.com/bcnmy/abstractjs). The SDK can be installed and reused but copying this small chunk avoids additional dependencies
```

- [ ] **Step 6: Commit**

```bash
git add orchestrator-node/src/modules/quotes/quotes.service.ts orchestrator-node/src/modules/simulator/simulation.service.ts
git commit -m "neutralize code comments: remove Biconomy branding"
```

---

### Task 6: Neutralize LiFi integrator string

**Files:**
- Modify: `orchestrator-node/src/modules/payment/providers/lifi/lifi.service.ts:48`

- [ ] **Step 1: Replace the integrator string**

Replace:
```
      integrator: "BICONOMY_MEE",
```
With:
```
      integrator: "ERC8211_ORCHESTRATOR",
```

- [ ] **Step 2: Commit**

```bash
git add orchestrator-node/src/modules/payment/providers/lifi/lifi.service.ts
git commit -m "replace BICONOMY_MEE integrator string with ERC8211_ORCHESTRATOR"
```

---

### Task 7: Create docker-compose.yml

**Files:**
- Create: `orchestrator-node/docker-compose.yml`

- [ ] **Step 1: Write docker-compose.yml**

```yaml
services:
  orchestrator-node:
    build:
      context: .
      dockerfile: Dockerfile
    ports:
      - "${PORT:-4000}:${PORT:-4000}"
    env_file:
      - .env
    environment:
      - REDIS_HOST=redis
      - REDIS_PORT=6379
      - TOKEN_SLOT_DETECTION_SERVER_BASE_URL=http://token-storage-detection:5000
    depends_on:
      redis:
        condition: service_started
      token-storage-detection:
        condition: service_started
    restart: unless-stopped

  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
    volumes:
      - redis-data:/data
    restart: unless-stopped

  token-storage-detection:
    build:
      context: ./apps/token-storage-detection
      dockerfile: Dockerfile
    ports:
      - "5000:5000"
    env_file:
      - ./apps/token-storage-detection/.env
    restart: unless-stopped

volumes:
  redis-data:
```

- [ ] **Step 2: Commit**

```bash
git add orchestrator-node/docker-compose.yml
git commit -m "add docker-compose.yml for full-stack orchestrator node"
```

---

### Task 8: Create .env.example

**Files:**
- Create: `orchestrator-node/.env.example`

- [ ] **Step 1: Write .env.example**

Copy the existing `mee-node/.env.example` content (it's already neutral — no Biconomy references) into `orchestrator-node/.env.example`. The file is already documented with comments. No modifications needed.

```bash
cp mee-node/.env.example orchestrator-node/.env.example
```

- [ ] **Step 2: Commit**

```bash
git add orchestrator-node/.env.example
git commit -m "add .env.example with documented configuration template"
```

---

### Task 9: Final verification

- [ ] **Step 1: Verify no Biconomy references remain (except structural deps)**

```bash
grep -ri "biconomy\|bcnmy" orchestrator-node/ --include="*.ts" --include="*.md" --include="*.json" --include="*.yml" --include="*.yaml" | grep -v node_modules | grep -v bun.lock
```

Expected remaining hits (acceptable — structural, not branding):
- `package.json` — `@biconomy/abstractjs` dev dependency (structural)
- `gas-estimator-v2.service.ts:10` — import from `@biconomy/abstractjs` (structural)
- `simulation.service.ts:980` — source attribution URL `github.com/bcnmy/abstractjs` (factual)
- `docs/run-and-maintain.md` — `@biconomy/abstractjs` in code example (framed as "one compatible SDK")
- `docs/run-and-maintain.md` — starter kit link to `github.com/bcnmy/...` (factual link)

All branding references ("Biconomy hosted", "BICONOMY_MEE", author, contact, docs URLs) should be gone.

- [ ] **Step 2: Verify docker-compose.yml is valid**

```bash
cd orchestrator-node && docker compose config --quiet && echo "valid" || echo "invalid"
```

Expected: `valid`

- [ ] **Step 3: Verify package.json is valid JSON**

```bash
cat orchestrator-node/package.json | python3 -m json.tool > /dev/null && echo "valid" || echo "invalid"
```

Expected: `valid`

- [ ] **Step 4: Final commit if any adjustments were needed**

```bash
git add orchestrator-node/
git commit -m "final adjustments from verification pass"
```

Only run if Step 1-3 surfaced issues that required fixes.
