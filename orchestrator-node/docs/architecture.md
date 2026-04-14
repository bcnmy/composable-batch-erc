# MEE Node architecture

This document describes how the MEE Node is structured and how data flows from quote to execution.

## Process model

The node uses Node.js **cluster** and **worker threads**:

1. **Primary (master)**  
   - Runs once.  
   - Initializes: chains config, RPC manager, gas manager, batcher, health checks.  
   - Spawns API workers (cluster) and, per chain, simulator and executor workers (threads).  
   - Pushes config and health results to workers via IPC.

2. **API workers (cluster)**  
   - One or more HTTP server processes.  
   - Handle `/v1/quote`, `/v1/quote-permit`, `/v1/exec`, `/v1/info`, `/v1/explorer/:hash`.  
   - Receive chain settings, RPC config, gas info, and health results from the master.

3. **Simulator workers (threads, per chain)**  
   - Consume jobs from the **simulator queue** for that chain (async batch simulation after quote).  
   - Run **execution simulation**: they simulate userOps against **on-chain state** (no state overrides). Their role is to confirm that on-chain conditions are met before the execution phase.

4. **Executor workers (threads, per chain)**  
   - Consume jobs from the **executor queue** (BullMQ) for that chain.  
   - Submit signed transactions to the chain RPC.  
   - Use node-owned EOA wallets (master + optional extra workers from mnemonic/keys).

Entry points:

- **Master**: `src/master/bootstrap.ts`  
- **API**: `src/api/bootstrap.ts`  
- **Simulator**: `src/workers/simulator/main.ts`  
- **Executor**: `src/workers/executor/main.ts`

All started from `src/main.ts` (cluster primary runs master, workers run API).

## Data flow

### Quote → storage → simulation → batching → execution

1. **Quote** — Request comes in. The API runs **pre-simulation** for gas estimation and calldata validity: it fills the on-chain state gap using **state overrides** (e.g. ERC20 balances) and uses the **Token Storage Detection** service to get balance storage slots when needed. Pre-simulation produces gas estimates and validates the batch. The node then stores quote and userOps in Redis and enqueues simulator jobs per chain.

2. **Simulator** — Workers process simulator jobs: they run **execution simulation** against current on-chain state (no state overrides), so that execution only runs when on-chain conditions are satisfied. They do not use the Token Storage Detection service. The batcher listens for completed jobs.

3. **Batcher** — Groups simulated userOps per chain into batches under the chain's batch gas limit and enqueues executor jobs.

4. **Executor** — Workers pick executor jobs, sign and send batch transactions using the node's RPC and EOA, then complete the job.

5. **Execute** — Client sends the signed quote; node loads from Redis, validates, and execution is driven by the same queues until the execution job is done.

**Redis** backs queues, quote/userOp storage, and cache. **Token Storage Detection** is used only in the **pre-simulation and gas estimation phase** (in the API during quote), to build state overrides for ERC20 balances; it is not used by simulator workers.

## Redis usage

Redis is used for job queues (simulator and executor per chain), quote and userOp storage, and caching. Connection is configured via `REDIS_HOST` and `REDIS_PORT`.

## Health checks

The **HealthCheckService** (master) periodically runs:

- **Redis**: e.g. `CLIENT LIST` to ensure connectivity.  
- **Chains / RPC**: per-chain checks.  
- **Simulator / Executor**: per-chain queue presence/job counts.  
- **Node**: wallet/account status per chain.  
- **Token Slot Detection**: per-chain request to the token-storage service (soft: does not mark chain unhealthy).

Results are sent to API workers. `/v1/info` aggregates them so operators can see status of Redis, token-slot, queues, and chains.

## Configuration flow

- **Chains**: Loaded from config (or `CUSTOM_CHAINS_CONFIG_PATH`). Master initializes `ChainsService` and passes chain settings to API workers.  
- **RPC**: Master builds RPC chain configs, calls `RpcManagerService.setup()`, then pushes config to API and thread workers (simulator/executor).  
- **Gas**: Gas manager runs in master; gas info is synced to API and thread workers.  
- **Node wallets**: Node service runs in master; wallet states are pushed to executor workers for signing.

All of this ensures API and workers see the same chains, RPCs, gas, and wallet state.
