# Run and maintain the MEE Node — tutorial

This guide walks through running and maintaining a MEE Node step by step: why the master EOA exists, where fees go, what is auto-funded, chain and RPC requirements, chain config (including type and payment tokens), arbitrary payment, permit tokens, trusted gas tank (sponsored execution), and how to monitor the node and connect with the SDK.

---

## 1. Why the master EOA exists and needs to be funded

The **master EOA** is the node’s primary account (from **`NODE_PRIVATE_KEY`**). The private key can be supplied via environment variable or, in production/staging, from an **encrypted keystore** (`keystore/key.enc`) using **`ENV_ENC_PASSWORD`** — see [Operations — Configuration](operations.md#configuration). It is used to:

- **Deploy** the node paymaster contract on each chain (once per chain when not yet deployed).
- **Fund** the paymaster with native token **only at first deployment** (see [Operations — Master EOA and paymaster funding](operations.md#master-eoa-and-paymaster-funding)).
- **Fund worker EOAs** at boot via the disperse contract (one tx per chain to top all workers up to `executor.workerFunding`).

So the master EOA must hold enough **native token on each chain** where the node runs to cover deployment gas, initial paymaster funding (only when deploying), and worker funding at each boot. After that, paymaster balance is **not** auto-topped; the operator tops it up manually.

---

## 2. Where the node receives fees and in which token

Execution fees are sent to the **fee beneficiary** address, configured by **`NODE_FEE_BENEFICIARY`** (defaults to the master EOA if unset). Fees can be received as:

- **Native token** — When the user pays in the chain’s native coin (e.g. ETH).
- **Configured payment tokens** — When the user pays in a token listed in the chain’s `paymentTokens` (e.g. USDC). The payment userOp transfers that token to the fee beneficiary.
- **Arbitrary tokens** — When arbitrary payment is enabled (see section 7). The user pays in a token that is not in `paymentTokens`; the token is still received at the fee beneficiary. Arbitrary tokens are **not** random mock or dead/illiquid meme tokens: only tokens **supported by the configured swap providers** (LiFi, Gluex) are accepted, so the node stays safe against unsupported or illiquid tokens. The node does not swap received tokens; the operator is responsible for swapping and rebalancing.

---

## 3. What balances are automatically funded at first boot

On **each startup**, for each configured chain the node:

1. **Paymaster** — If the paymaster contract for that chain and master EOA is **not** deployed, the node deploys it and sends `paymasterFunding` (from chain config, e.g. 0.025 ETH) in the same tx. If the paymaster **is** already deployed, no funding is sent; you must top up manually.
2. **Workers** — If `executor.workerCount` > 0, the node funds worker EOAs from the master EOA via the **disperse** contract: **one transaction per chain**. Each worker is topped up to **`executor.workerFunding`** (default 0.001 native token). The amount sent in that tx is the **sum of shortfalls** (workerFunding − current balance) for each worker below target; workers already at or above target get 0. Workers are derived from `NODE_ACCOUNTS_MNEMONIC` or `NODE_ACCOUNTS_PRIVATE_KEYS`; the number funded is up to `min(workerCount, MAX_EXTRA_WORKERS, number of accounts)`.

So: **paymaster** is only funded when it is first deployed; **workers** are funded every boot (to `workerFunding` each). Master EOA must have enough for deploy + paymasterFunding (first time only) and for the disperse sum + gas. For a detailed breakdown with examples (how much the master EOA needs, disperse math), see [Operations — Funding workers (how and when)](operations.md#funding-workers-how-and-when).

---

## 4. Chain and RPC requirements

Chains and RPCs used by the node must support:

- **`debug_traceCall`** — Used for simulation (e.g. tracing handleOps). If the RPC does not support it, simulation may fail; for the Token Storage Detection service, use **fork mode** (e.g. Anvil) for such chains. See [Token Storage Detection README](../apps/token-storage-detection/README.md).
- **`eth_feeHistory`** — Used by the gas manager for EIP-1559 chains to get base fee and priority fee. Configurable via `feeHistoryBlockTagOverride` (e.g. `"latest"`, `"pending"`).
- Standard calls: `eth_getCode`, `eth_getBalance`, `eth_call`, contract reads (e.g. EntryPoint `balanceOf`), and for L2s the appropriate L1 fee estimation (e.g. Optimism `estimateL1Gas`, Arbitrum oracle).

Ensure your RPC endpoints support these; otherwise quotes, simulation, or execution may fail.

---

## 5. Chain ID and type (evm, optimism, arbitrum) — and how L1/L2 gas is calculated

- **`chainId`** — Set in chain config to the chain’s numeric id (e.g. `"1"`, `"8453"`). Must match the key in your config file/directory.
- **`type`** — One of `"evm"` | `"optimism"` | `"arbitrum"`. Default is `"evm"`.

**Difference between types:**

- **`evm`** — Standard EVM chain. Gas is estimated using L2 fee only (gas price × gas limit). No L1 component.
- **`optimism`** — Optimism-style L2. Total cost includes **L2 gas** (base fee + priority fee) plus **L1 fee**. The node fetches L1 gas price from the L1 chain (`l1ChainId`), then uses the RPC’s `estimateL1Gas` (or equivalent) to get the L1 fee for the call data. Set **`l1ChainId`** (e.g. `"1"` for Ethereum).
- **`arbitrum`** — Arbitrum-style L2. Similarly, total cost = L2 gas + **L1 component**. The node uses the chain’s Arbitrum gas oracle contract to compute the L1 cost (e.g. `gasEstimateL1Component`). Set **`l1ChainId`** for the L1 chain.

So: for L2s, set `type` and `l1ChainId` correctly so the gas estimator can compute L1 + L2 fees; for standard L1/EVM chains use `type: "evm"` (or omit).

---

## 6. Role of payment tokens

**Payment tokens** (in chain config `paymentTokens`) define **which tokens the node accepts as fee payment** on that chain. Each entry specifies the token contract (name, address, symbol), its price (fixed or oracle), and optionally **`permitEnabled`** (see section 8). Only tokens listed here can be used for fee payment unless **arbitrary token** support is enabled (section 7). The node uses this list to validate payment and to compute fee amounts in the chosen token.

---

## 7. Activating arbitrary payment token support

To allow users to pay fees in **any liquid token** (even if not in `paymentTokens`):

1. Configure **at least one payment provider** via env:
   - **LiFi**: `LIFI_API_KEY`
   - **Gluex**: `GLUEX_API_KEY`, `GLUEX_PARTNER_UNIQUE_ID`
2. The node uses these providers to get **swap calldata** (route/quote). This is used only to (1) **validate** that the token is swappable (has liquidity) and (2) **determine how much** token is required to cover fees (exchange rate). Only tokens **supported by the configured swap providers** (LiFi, Gluex) are accepted—not random mock or dead/illiquid tokens—so the node is safe against unsupported or illiquid assets. The node **does not** execute the swap; the user’s payment in the arbitrary token is **received at the fee beneficiary** (`NODE_FEE_BENEFICIARY`).
3. As operator you must **periodically swap** received tokens and **rebalance** the node (e.g. keep paymasters funded with native token). See [Chain configuration — Arbitrary token support](chain-configuration.md#arbitrary-token-support).

---

## 8. Permit-enabled tokens (ERC‑2612 / ERC‑20 Permit)

For tokens that support **ERC‑20 Permit** (signature-based approval without a separate `approve` tx), set **`permitEnabled: true`** on the payment token in chain config. Then:

- The SDK will request **quote-permit** by default for that token.
- Users can **gaslessly** approve spending from their EOA via a signature; the supertransaction can execute and pay fees in one flow without a prior approval transaction.

So: for any payment token that implements Permit, set `permitEnabled: true` so the node and SDK use the permit flow.

---

## 9. TRUSTED_GAS_TANK — sponsored supertransactions

**`TRUSTED_GAS_TANK_ADDRESS`** (env) is the address of a **trusted gas tank**. When the **payment userOp** of a supertransaction is a **sponsored** payment (userOps indicate sponsorship) and the **sender** of that payment userOp is this trusted gas tank address:

- The node treats it as **trusted sponsorship**.
- **Simulation of the payment userOp is skipped** (signature is still verified against the expected gas tank owner).
- The node **executes all other userOps** in the supertransaction **without requiring fees from the user** — the “payment” is considered covered by the trusted tank.

So: set `TRUSTED_GAS_TANK_ADDRESS` to the gas tank contract (or EOA) that is allowed to sponsor supertransactions. When a payment userOp from that address is marked sponsored and its signature is valid, the node will execute the batch without expecting the user to pay fees. This is used for fully sponsored flows (e.g. Biconomy-hosted gas tank).

---

### External gas tank sponsorship

**External gas tank sponsorship** is when a **third party** (e.g. a dapp or relayer) runs their own **gas tank** (nexus smart account) and **sponsors transactions on behalf of their users**, while the **node still gets paid** for execution. The node is compensated by the gas tank; this is different from **trusted** sponsorship where the node sponsors without being paid.

**Full flow (overview):**

1. The **app or third party** requests a quote from the node, specifying **`paymentInfo.sender`** as the **nexus gas tank account** address (and the chosen payment token). The node returns a quote that includes the supertransaction userOps: **`userOps[0]`** is the **payment userOp** (fee payment from the gas tank to the node).
2. **Two signatures are required** before execution:
   - **Gas tank private key** must sign the **payment userOp** (`userOps[0]` in the supertransaction userOps list from the generated quote).
   - **End user** must sign the **quote** by signing the **supertransaction hash** — best done using the utility functions provided in the **AbstractJS SDK** (e.g. for quote signing and execution).
3. Once both signatures are attached, the client submits the signed quote to the node’s execute endpoint; the node runs the supertransaction and receives fees from the gas tank.

**Requirements:** The token must be (1) **accepted by this node** (listed in the chain’s payment tokens or supported as arbitrary payment), and (2) the **balance** must exist on the nexus gas tank account, and the **nexus account must be deployed** on the given chain.

**Concrete example:** For a full implementation of how third parties can set up an external gas tank and use it with the node (including quote, signing, and execution), see the **[MEE self-hosted sponsorship starter kit](https://github.com/bcnmy/mee-self-hosted-sponsorship-starter-kit)**.

**Difference from trusted gas tank:** With **`TRUSTED_GAS_TANK_ADDRESS`**, the node **unconditionally** executes and does **not** require fees from the user (trusted mode). With **external gas tank sponsorship**, the node **does** require payment: the payment userOp moves funds from the third party’s gas tank to the node, so the node is compensated and the third party runs their own sponsorship flow.

---

## 10. Monitoring the node and connecting with @biconomy/abstractjs

**Monitoring:**

- **GET /v1/info** — Aggregated health: Redis, Token Slot Detection, chains (RPC, paymaster, workers), simulator/executor queues, node wallets. Use this to confirm the node and dependencies are healthy and to track paymaster and worker balances.
- **Logs** — Use `LOG_LEVEL` (e.g. `debug`) and your logging stack to inspect quote, simulation, and execution flow.

**When the node is fully set up and healthy:** Check that `/v1/info` shows all modules (Redis, chains, token-slot, simulator/executor, node wallets) in a healthy state. Then clients can use your node for quotes and execution by pointing the AbstractJS SDK at your node URL.

**Connecting to your node via AbstractJS:**

To connect to your MEE Node (e.g. after it is running and healthy), use the **`@biconomy/abstractjs`** SDK and pass your node’s base URL as the **`url`** option when creating the MEE client. All quote, quote-permit, and execute flows then go to your node instead of the default Biconomy network.

```ts
import { createMeeClient } from "@biconomy/abstractjs";

const meeClient = await createMeeClient({
  account: orchestrator,   // your orchestrator/smart account
  url: "https://your-mee-node-url",  // your MEE node base URL (e.g. https://mee.example.com)
  // apiKey: "optional-for-rate-limiting"
});
```

Use the client for quote, quote-permit, and exec as usual; traffic is sent to your node. Without `url`, the SDK uses the default Biconomy network.

---

For startup order, dependency failures, and paymaster top-up details, see [Operations](operations.md). For chain config fields and payment-token/oracle setup, see [Chain configuration](chain-configuration.md).
