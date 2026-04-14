# Orchestrator Node — Neutralization Design Spec

**Date:** 2026-04-14
**Status:** Draft
**Scope:** Surface-level facelift to extract a neutral, community-ready orchestrator node from the Biconomy mee-node codebase.

---

## Goal

Extract the mee-node into a standalone `/orchestrator-node/` folder at the project root, stripped of Biconomy-specific branding, infrastructure, and documentation. The result is a self-contained, run-anywhere orchestration node for ERC-8211 composable batches that anyone can fork, configure, and deploy with `docker compose up`.

No logic changes. No struct renames. No dependency swaps. "Supertransaction" terminology stays.

---

## Naming

- **Folder:** `orchestrator-node/`
- **Package name:** `orchestrator-node`
- **Name in docs:** Orchestrator Node
- ERC-8211 is referenced in README context and links, not in the project title itself.

---

## Extraction: What's Included vs Excluded

### Included in `/orchestrator-node/`

| Source (from mee-node/) | Notes |
|-------------------------|-------|
| `src/` | All TypeScript source — unchanged logic |
| `apps/token-storage-detection/` | Required companion Rust service |
| `docs/` | Neutralized documentation |
| `Dockerfile` | Already clean multi-stage bun build |
| `package.json` | Metadata neutralized |
| `bun.lock` | Unchanged |
| `tsconfig.json` | Unchanged |
| `.dockerignore` | Unchanged |
| `dashboards/` | Grafana dashboards (generic observability) |
| `docker-compose.observability.yml` | Jaeger setup for local dev |

### Excluded (stays only in mee-node/)

| Path | Reason |
|------|--------|
| `k8s/` | Biconomy Helm charts, GCP project IDs, `*.biconomy.io` domains — operator-specific |
| `.github/workflows/` | Biconomy CI/CD pipelines referencing `bcnmy/` registry — operator-specific |
| `test/` | Imports `@biconomy/abstractjs` directly — structural coupling, out of scope |

---

## Changes by Category

### 1. Package Identity

**File: `package.json`**

| Field | Current | New |
|-------|---------|-----|
| `name` | `"mee-node"` | `"orchestrator-node"` |
| `description` | (current) | ERC-8211 orchestration framing |
| `author` | `"Biconomy"` | Remove field |

`@biconomy/abstractjs` stays as a dev dependency (structural — used in gas estimator imports).

### 2. Documentation

**File: `README.md` — Full rewrite**

| Aspect | Current | New |
|--------|---------|-----|
| Header/intro | Links to `biconomy.io/post/...` | "Orchestrator Node" intro, links to ERC-8211 spec and Ethereum Magicians thread |
| Docker image | `bcnmy/mee-node` | `orchestrator-node` (local build) |
| Docker run command | `bcnmy/mee-node` | Updated to use `docker compose up` |
| Live docs link | `mee-node.biconomy.io/docs` | `your-node-url/docs` or removed |
| Contact | `connect@biconomy.io` | GitHub issues / Ethereum Magicians thread |
| Quickstart | Assumes Biconomy infra | `docker compose up` quickstart |

**File: `docs/run-and-maintain.md` — Targeted edits**

| Line(s) | Current | New |
|---------|---------|-----|
| 104 | "Biconomy-hosted gas tank" | "operator-hosted gas tank" |
| 117, 135, 137, 139, 151 | AbstractJS SDK references, `@biconomy/abstractjs` examples | Generic "compatible SDK" language |
| 122 | `github.com/bcnmy/mee-self-hosted-sponsorship-starter-kit` | Keep link, frame generically |
| 128 | Section header: "Monitoring the node and connecting with @biconomy/abstractjs" | "Monitoring the node and connecting with an SDK" |
| 142 | `import { createMeeClient } from "@biconomy/abstractjs"` | Keep as example, note it's one compatible SDK |

### 3. Code Comments

**File: `src/modules/quotes/quotes.service.ts`**

| Line | Current | New |
|------|---------|-----|
| 201 | "Biconomy hosted sponsorship will be considered as trusted sponsorship" | "Hosted sponsorship will be considered as trusted sponsorship" |
| 758 | Same | Same fix |
| 1355 | "Biconomy hosted sponsorship userOp simulation is skipped" | "Hosted sponsorship userOp simulation is skipped" |

**File: `src/modules/simulator/simulation.service.ts`**

| Line | Current | New |
|------|---------|-----|
| 1330 | "biconomy gas tank nexus userOp" | "gas tank nexus userOp" |
| 980 | "This code is taken from AbstractJs SDK" | "This code is taken from the AbstractJs SDK (github.com/bcnmy/abstractjs)" |

### 4. Runtime Code

**File: `src/modules/payment/providers/lifi/lifi.service.ts`**

| Line | Current | New |
|------|---------|-----|
| 48 | `integrator: "BICONOMY_MEE"` | `integrator: "ERC8211_ORCHESTRATOR"` |

### 5. New Files

**`docker-compose.yml`**

Three services wired together:
- `orchestrator-node` — builds from local `Dockerfile`, exposes port 4000, depends on Redis and token-storage-detection
- `redis` — official `redis:7-alpine` image, default port 6379
- `token-storage-detection` — builds from `apps/token-storage-detection/Dockerfile`, exposes port 5000

Environment variables injected from `.env` file.

**`.env.example`**

Documented template with all required/optional environment variables:
- `NODE_ID`, `NODE_PRIVATE_KEY` (required)
- `PORT` (default 4000)
- `REDIS_HOST`, `REDIS_PORT` (default localhost:6379, overridden by compose)
- `TOKEN_SLOT_DETECTION_SERVER_BASE_URL` (default http://token-storage-detection:5000 in compose)
- `CUSTOM_CHAINS_CONFIG_PATH` (optional, for custom chain configs)
- `LIFI_API_KEY`, `GLUEX_API_KEY` (optional, for payment providers)
- `LOG_LEVEL` (default info)
- All other optional vars documented with comments

---

## What Stays Unchanged

- All TypeScript logic, interfaces, request/response types
- "Supertransaction" / "MeeUserOp" / "MeeQuote" terminology
- `@biconomy/abstractjs` as a dependency
- Nexus smart account ABIs in `src/modules/contracts/resources/`
- Signature types (`SIG_TYPE_MEE_FLOW`, etc.)
- All internal service architecture (QuotesService, SimulationService, etc.)
- Original `mee-node/` folder — remains intact, untouched

---

## Implementation Approach

- All work done on a separate branch for review
- Extract first (copy mee-node → orchestrator-node, exclude k8s/.github/test)
- Apply neutralization edits to the extracted copy
- Add docker-compose.yml and .env.example
- Original mee-node/ untouched — easy to diff and compare

---

## Total Scope

- ~10 files modified (in the extracted copy)
- 2 files created (docker-compose.yml, .env.example)
- 0 logic changes
- 0 structural changes
