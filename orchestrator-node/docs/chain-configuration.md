# Chain configuration

This document describes how to add and configure chains for the **MEE Node**: where config lives, every config field, how they affect behavior, and the **price oracle requirement** for native and payment tokens. It also contrasts with the Token Storage Detection service. For a full run-and-maintain tutorial (master EOA, fees, RPC requirements, chain type, payment tokens, arbitrary payment, permit, trusted gas tank), see [Run and maintain the node](run-and-maintain.md).

---

## Overview

For **standard EVM chains**, adding a chain in the MEE Node is a **configuration-only** change. You add or edit a chain config object (JSON); the node reads it at startup and uses it for RPCs, batching, simulation, execution, gas, and pricing. This doc explains each field and how to add a new chain.

---

## Where chain config is loaded from

- **`CUSTOM_CHAINS_CONFIG_PATH`** (env): Optional. If set, the node loads from this path (file or directory).
- **Default paths** (if not set): `./config/chains`, then `./chains` (relative to process cwd).

Config can be:

- A **directory**: one JSON file per chain, named by chain id (e.g. `1.json`, `8453.json`).
- A **single JSON file**: top-level keys are chain IDs (string), values are chain config objects.

The node merges env-driven defaults (e.g. `DEFAULT_USER_OPS_BATCH_GAS_LIMIT`) with per-chain JSON; see `.env.example` for global defaults and the table below for per-chain fields.

**RPC requirements:** For full functionality (simulation, gas estimation), RPCs should support **`debug_traceCall`** and **`eth_feeHistory`**. See [Run and maintain — Chain and RPC requirements](run-and-maintain.md#4-chain-and-rpc-requirements).

---

## Price oracles and required chains

The node needs a **native coin price** (and optionally **payment token prices**) for fee and payment logic. Prices can come from:

- **`price.type: "fixed"`** — constant `value` and `decimals` in config. No extra chain or RPC.
- **`price.type: "oracle"`** — price is read from a **Chainlink-style aggregator** (e.g. `latestRoundData`, `decimals`) on a specific chain. You must set **`price.chainId`** and **`price.oracle`** (contract address).

**Important:** If `price` is `"oracle"` and references a **chainId**, that chain **must exist in your chains config** and have working RPCs. The node calls `RpcManagerService.executeRequest(chainId, ...)` to read the oracle contract. If that chain is not configured, the request will fail and native/payment pricing can break.

So: **any chain referenced by a price oracle must be present in the chain config**, even if you do not use that chain for execution (e.g. you only use it for ETH/USD price on Ethereum mainnet).

---

## Configuration sources

The node accepts three configuration sources:

1. **Environment variables (ENV)** — Node-level settings (e.g. in `.env`). Examples: `NODE_PRIVATE_KEY`, `DEFAULT_USER_OPS_BATCH_GAS_LIMIT`, `DEFAULT_NUM_SIMULATOR_WORKERS_PER_CHAIN`, `MAX_EXTRA_WORKERS`, `CUSTOM_CHAINS_CONFIG_PATH`. These apply across chains unless overridden per chain.
2. **Encrypted keystore (optional)** — In **production** or **staging** (`NODE_ENV=production` or `staging`), the node can load secrets (e.g. `NODE_PRIVATE_KEY`) from an encrypted file at **`keystore/key.enc`**, decrypted at startup using **`ENV_ENC_PASSWORD`**. This keeps the private key encrypted at rest. See [Operations — Configuration](operations.md#configuration) for how to create and use the encrypted keystore.
3. **Chain config (JSON)** — Per-chain settings in the chain config files (directory or single file). Keys in the JSON (e.g. `batcher.batchGasLimit`, `simulator.numWorkers`) override or supplement env-driven defaults for that chain.

The tables below list **chain config** keys and, where relevant, the **ENV var** that provides the default. Use ENV vars (or the encrypted keystore) to configure the node globally; use chain config JSON to override per chain.

---

## Chain config fields (full reference)

All fields below are **chain config** (JSON) unless stated otherwise. Optional fields have schema defaults; defaults from ENV are noted.

### Identification and RPC

| Chain config key | Type | Required | Default | Description / impact |
|------------------|------|----------|--------|----------------------|
| **`chainId`** | string (numeric) | Yes | — | Chain id (e.g. `"1"`, `"8453"`). Must match the key in the config file/directory. |
| **`name`** | string | Yes | — | Human-readable name (logs, errors, gas estimator). |
| **`rpcs`** | string[] | Yes | — | RPC URLs for this chain. Used by RPC manager for simulation and execution. At least one required. |

---

### Contracts

| Chain config key | Type | Required | Default | Description / impact |
|------------------|------|----------|--------|----------------------|
| **`contracts.entryPointV7`** | address | No | `0x0000000071727De22E5E9d8BAf0edAc6f37da032` | EntryPoint v7 contract. Used for simulation, execution, and paymaster deployment. |
| **`contracts.pmFactory`** | address | No | `0x000000005824a1ED617994dF733151D26a4cf03d` | Node paymaster factory. Used to deploy and fund the node paymaster. |
| **`contracts.disperse`** | address | No | `0xd15fE25eD0Dba12fE05e7029C88b10C25e8880E3` | Disperse contract used when funding multiple worker EOAs. |

Override only if your chain uses different deployments.

---

### Batcher and gas limits

| Chain config key | ENV var (default) | Type | Required | Default | Description / impact |
|------------------|-------------------|------|----------|--------|----------------------|
| **`batcher.batchGasLimit`** | `DEFAULT_USER_OPS_BATCH_GAS_LIMIT` | bigint/number | No | `8_000_000` | Max gas per batch of userOps submitted in one transaction. Set via ENV or chain config. |

---

### Gas and chain type (gas estimator, L1/L2)

| Chain config key | Type | Required | Default | Description / impact |
|------------------|------|----------|--------|----------------------|
| **`type`** | `"evm"` \| `"optimism"` \| `"arbitrum"` | No | `"evm"` | Chain type for gas estimation. L2s use different fee logic (e.g. L1 fee). |
| **`eip1559`** | boolean | No | `false` | Whether the chain supports EIP-1559. Affects fee calculation. |
| **`gasPriceMode`** | `"standard"` \| `"fast"` \| `"rapid"` | No | `"standard"` | Aggressiveness of gas price (more = higher fee, faster inclusion). |
| **`l1ChainId`** | string | No | — | For L2s, the L1 chain id (e.g. `"1"` for Ethereum). Used to fetch L1 gas price and L1 fee. |
| **`feeHistoryBlockTagOverride`** | string | No | — | Override block tag for `eth_feeHistory` (e.g. `"latest"`, `"pending"`). |
| **`minMaxFeePerGas`** | bigint/number (wei) | No | — | Optional minimum `maxFeePerGas` (wei) for legacy chains; some RPCs (e.g. BSC) reject txs below this. |

---

### Native token price (critical for fees and payment)

| Chain config key | Type | Required | Default | Description / impact |
|------------------|------|----------|--------|----------------------|
| **`price`** | object | Yes | — | Native coin price source. |
| **`price.type`** | `"fixed"` \| `"oracle"` | Yes | — | See below. |
| **`price.value`** | number/bigint | If `type === "fixed"` | — | Fixed price (e.g. USD per native token). |
| **`price.decimals`** | number | If `type === "fixed"` | — | Decimals for the fixed price. |
| **`price.chainId`** | string | If `type === "oracle"` | — | **Chain where the oracle contract lives.** This chain **must** be in your chains config with valid RPCs. |
| **`price.oracle`** | address | If `type === "oracle"` | — | Chainlink-style aggregator contract (must expose `latestRoundData` and `decimals`). |

If you use **`price.type: "oracle"`**, the chain in **`price.chainId`** must be configured; otherwise oracle reads will fail and native token pricing will break.

---

### Paymaster funding (node operations)

| Chain config key | Type | Required | Default | Description / impact |
|------------------|------|----------|--------|----------------------|
| **`paymasterFunding`** | string (ether) | No | `"0.025"` | Amount of native token sent to the paymaster **only during first deployment** (when the paymaster contract for this chain and master EOA does not exist yet). Not used for top-ups. |
| **`paymasterFundingThreshold`** | string (ether) | No | `"0"` | Balance below which the node considers the paymaster unhealthy. Operator must top up the paymaster when balance falls below this (see [Operations — Master EOA and paymaster funding](operations.md#master-eoa-and-paymaster-funding)). |
| **`paymasterInitCode`** | hex | No | — | Optional custom paymaster init code. |

For how the master EOA, paymaster deployment, and worker balances interact, see [Operations — Master EOA and paymaster funding](operations.md#master-eoa-and-paymaster-funding).

---

### Confirmation and execution

| Chain config key | Type | Required | Default | Description / impact |
|------------------|------|----------|--------|----------------------|
| **`waitConfirmations`** | number | No | `3` | Number of block confirmations before considering a tx confirmed. Used by executor and explorer. |
| **`waitConfirmationsTimeout`** | number (ms) | No | `60000` (60 s) | Timeout when waiting for confirmations. |

---

### Simulator (per-chain)

Configure via **ENV vars** (node-level defaults) or override per chain in chain config JSON. Omit a chain config key to use the ENV default.

| ENV var (node-level default) | Chain config key (per-chain override) | Type | Default | Description / impact |
|------------------------------|----------------------------------------|------|--------|----------------------|
| **`DEFAULT_NUM_SIMULATOR_WORKERS_PER_CHAIN`** | `simulator.numWorkers` | number | `1` | Number of simulator thread workers for this chain. |
| **`DEFAULT_SIMULATOR_WORKER_CONCURRENCY`** | `simulator.workerConcurrency` | number | `10` | Concurrency per simulator worker. |
| **`DEFAULT_SIMULATOR_STALLED_JOBS_RETRY_INTERVAL`** | `simulator.stalledJobsRetryInterval` | number (ms) | `5000` (5 s) | Interval for retrying stalled simulation jobs. |
| **`DEFAULT_SIMULATOR_RATE_LIMIT_MAX_REQUESTS_PER_INTERVAL`** | `simulator.rateLimitMaxRequestsPerInterval` | number | `100` | Rate limit: max requests per interval. |
| **`DEFAULT_SIMULATOR_RATE_LIMIT_DURATION`** | `simulator.rateLimitDuration` | number (s) | `1` | Rate limit interval in seconds. |
| **`DEFAULT_SIMULATOR_TRACE_CALL_RETRY_DELAY`** | `simulator.traceCallRetryDelay` | number (ms) | `2000` | Delay before retrying a failed trace/simulation call. |

---

### Executor (per-chain)

Configure via **ENV vars** (node-level) or override per chain in chain config JSON. Worker count is also capped by **`MAX_EXTRA_WORKERS`** (env). Omit a chain config key to use the schema or ENV default.

| ENV var (node-level default) | Chain config key (per-chain override) | Type | Default | Description / impact |
|------------------------------|----------------------------------------|------|--------|----------------------|
| *(chain config only)* | `executor.pollInterval` | number (ms) | `1000` | Poll interval when waiting for transaction receipt. |
| **`DEFAULT_EXECUTOR_STALLED_JOBS_RETRY_INTERVAL`** | `executor.stalledJobsRetryInterval` | number (ms) | `5000` (5 s) | Interval for retrying stalled execution jobs. |
| **`DEFAULT_EXECUTOR_RATE_LIMIT_MAX_REQUESTS_PER_INTERVAL`** | `executor.rateLimitMaxRequestsPerInterval` | number | `100` | Rate limit: max requests per interval. |
| **`DEFAULT_EXECUTOR_RATE_LIMIT_DURATION`** | `executor.rateLimitDuration` | number (s) | `1` | Rate limit interval in seconds. |
| *(chain config only)* | `executor.workerFunding` | string (ether) | `"0.001"` | Target balance used when funding worker EOAs (e.g. via disperse). |
| *(chain config only)* | `executor.workerFundingThreshold` | string (ether) | `"0"` | **Minimum native balance** each worker (or master when used as worker) must have to be considered healthy. Limits the maximum executable call gas limit for that chain; set high enough for the largest transaction you expect. |
| **`MAX_EXTRA_WORKERS`** (max cap) | `executor.workerCount` | number | `1` | Number of worker EOAs to use for execution on this chain. **0** = use master only; otherwise between **1** and **`MAX_EXTRA_WORKERS`**. Workers are derived from `NODE_ACCOUNTS_MNEMONIC` or `NODE_ACCOUNTS_PRIVATE_KEYS`. |

---

### Gas limit overrides (per-chain)

Chain config keys that override the global gas estimator defaults for this chain. All are optional. Omit to use the global default.

| Chain config key | Default | Description |
|------------------|---------|-------------|
| **`gasLimitOverrides.paymasterVerificationGasLimit`** | — | Paymaster verification gas. |
| **`gasLimitOverrides.senderCreateGasLimit`** | — | Gas for sender contract creation (when initCode is set). |
| **`gasLimitOverrides.baseVerificationGasLimit`** | — | Base verification gas. |
| **`gasLimitOverrides.fixedHandleOpsGas`** | — | Fixed gas for handleOps. |
| **`gasLimitOverrides.perAuthBaseCost`** | — | Per-signature/auth base cost (e.g. EIP-7702). |

---

### Payment tokens

| Chain config key | Type | Required | Default | Description / impact |
|------------------|------|----------|--------|----------------------|
| **`paymentTokens`** | array | Yes (non-empty for execution chains) | — | List of supported payment tokens (e.g. USDC) for this chain. |
| **`paymentTokens[].name`** | string | Yes | — | Token name. |
| **`paymentTokens[].address`** | address | Yes | — | Token contract address. |
| **`paymentTokens[].symbol`** | string | Yes | — | Token symbol. |
| **`paymentTokens[].price`** | object | Yes | — | Same shape as native `price`: `{ type: "fixed", value, decimals }` or `{ type: "oracle", chainId, oracle }`. |
| **`paymentTokens[].permitEnabled`** | boolean | No | `false` | Whether ERC-20 Permit (signature-based approval) is supported; set `true` for quote-permit flows. |

If **any** payment token uses **`price.type: "oracle"`** with a **`chainId`**, that chain must be present in your chains config (same rule as for native price).

---

### Arbitrary token support

**Arbitrary token payment** lets users pay fees with tokens that are not in the chain's `paymentTokens` list. To support it you must configure at least one **payment provider** via environment variables: **LiFi** (`LIFI_API_KEY`) or **Gluex** (`GLUEX_API_KEY`, `GLUEX_PARTNER_UNIQUE_ID`). The node uses these providers to obtain **swap calldata** (route/quote). This calldata is **not** executed by the node to perform a swap. It is used only to: (1) **validate** that the token is swappable (there is liquidity), and (2) **determine how much** of the token is required to cover fees (exchange rate). The user's payment in the arbitrary token is **received at the node's fee receiver address** (`NODE_FEE_BENEFICIARY`). The node does not swap the token on your behalf. **Operator responsibilities** when enabling arbitrary payment: periodically **swap** the tokens received at the fee receiver; **rebalance** the node portfolio across chains and ensure **paymasters on supported chains are well funded** with native token. See [Operations — Master EOA and paymaster funding](operations.md#master-eoa-and-paymaster-funding).

