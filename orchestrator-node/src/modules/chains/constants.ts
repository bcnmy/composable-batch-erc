import process from "node:process";
import { parseNum, parseSeconds } from "@/common";
import { values } from "remeda";
import { defineChain } from "viem";
import * as chains from "viem/chains";
import { megaeth, wanchainTestnet } from "viem/chains";

const katana = defineChain({
  id: 747474,
  name: "Katana",
  nativeCurrency: {
    name: "ETH",
    symbol: "ETH",
    decimals: 18,
  },
  rpcUrls: {
    default: {
      http: ["https://rpc.katana.network"],
    },
  },
  blockExplorers: {
    default: {
      name: "Blockscout",
      url: "https://explorer.katanarpc.com",
    },
  },
  contracts: {
    gasPriceOracle: {
      address: "0x420000000000000000000000000000000000000F",
    },
  },
  testnet: false,
}) as chains.Chain;

const neuraTestnet = defineChain({
  id: 267,
  name: "Neura Testnet",
  nativeCurrency: {
    name: "NEURA",
    symbol: "NEURA",
    decimals: 18,
  },
  rpcUrls: {
    default: {
      http: ["https://testnet.rpc.neuraprotocol.io"],
    },
  },
  blockExplorers: {
    default: {
      name: "Blockscout",
      url: "https://testnet-blockscout.infra.neuraprotocol.io/",
    },
  },
  testnet: true,
}) as chains.Chain;

const fluentTestnet = defineChain({
  id: 20994,
  name: "Fluent Testnet",
  nativeCurrency: {
    name: "Ether",
    symbol: "ETH",
    decimals: 18,
  },
  rpcUrls: {
    default: {
      http: ["https://rpc.testnet.fluent.xyz/"],
    },
  },
  blockExplorers: {
    default: {
      name: "Fluent Explorer",
      url: "https://testnet.fluentscan.xyz/",
    },
  },
  testnet: true,
}) as chains.Chain;

const arcTestnet = defineChain({
  id: 5042002,
  name: "Arc Testnet",
  nativeCurrency: {
    name: "USDC",
    symbol: "USDC",
    decimals: 18,
  },
  rpcUrls: {
    default: {
      http: [
        "https://rpc.testnet.arc.network",
        "https://rpc.quicknode.testnet.arc.network",
        "https://rpc.blockdaemon.testnet.arc.network",
      ],
      webSocket: [
        "wss://rpc.testnet.arc.network",
        "wss://rpc.quicknode.testnet.arc.network",
      ],
    },
  },
  blockExplorers: {
    default: {
      name: "ArcScan",
      url: "https://testnet.arcscan.app",
      apiUrl: "https://testnet.arcscan.app/api",
    },
  },
  contracts: {
    multicall3: {
      address: "0xcA11bde05977b3631167028862bE2a173976CA11",
      blockCreated: 0,
    },
  },
  testnet: true,
}) as chains.Chain;

const monadMainnet = defineChain({
  id: 143,
  name: "Monad Mainnet",
  nativeCurrency: {
    name: "MON",
    symbol: "MON",
    decimals: 18,
  },
  rpcUrls: {
    default: {
      http: [
        "https://rpc-mainnet.monadinfra.com/rpc/mmuQFfKlylzj8puKP5UiSa8K3RLhKzhe",
      ],
    },
  },
  blockExplorers: {
    default: {
      name: "Monad Explorer",
      url: "https://mainnet-beta.monvision.io/",
    },
  },
  contracts: {
    multicall3: {
      address: "0xcA11bde05977b3631167028862bE2a173976CA11",
    },
  },
  testnet: false,
}) as chains.Chain;

const hyperEvm = defineChain({
  id: 999,
  name: "HyperEVM",
  nativeCurrency: {
    decimals: 18,
    name: "HYPE",
    symbol: "HYPE",
  },
  rpcUrls: {
    default: { http: ["https://rpc.hyperliquid.xyz/evm"] },
  },
  blockExplorers: {
    default: {
      name: "Purrsec",
      url: "https://purrsec.com",
    },
  },
  contracts: {
    multicall3: {
      address: "0xcA11bde05977b3631167028862bE2a173976CA11",
    },
  },
  testnet: false,
});

const sonicTestnet = defineChain({
  id: 14_601,
  name: "Sonic Testnet",
  nativeCurrency: {
    decimals: 18,
    name: "Sonic",
    symbol: "S",
  },
  rpcUrls: {
    default: { http: ["https://rpc.testnet.soniclabs.com"] },
  },
  blockExplorers: {
    default: {
      name: "Sonic Testnet Explorer",
      url: "https://testnet.soniclabs.com/",
    },
  },
  testnet: true,
});

const megaethTestnet = defineChain({
  id: 6343,
  blockTime: 1_000,
  name: "MegaETH Testnet",
  nativeCurrency: {
    name: "MegaETH Testnet Ether",
    symbol: "ETH",
    decimals: 18,
  },
  rpcUrls: {
    default: {
      http: ["https://carrot.megaeth.com/rpc"],
      webSocket: ["wss://carrot.megaeth.com/ws"],
    },
  },
  blockExplorers: {
    default: {
      name: "MegaETH Testnet Explorer",
      url: "https://megaeth-testnet-v2.blockscout.com/",
    },
  },
  contracts: {
    multicall3: {
      address: "0xcA11bde05977b3631167028862bE2a173976CA11",
    },
    gasPriceOracle: {
      address: "0x420000000000000000000000000000000000000F",
    },
  },
  testnet: true,
});

const megaethMainnet = {
  ...megaeth,
  name: "MegaETH Mainnet",
  contracts: {
    ...megaeth.contracts,
    gasPriceOracle: {
      address: "0x420000000000000000000000000000000000000F",
    },
  },
};

const mocaTestnet = defineChain({
  id: 222_888,
  name: "Moca Testnet",
  nativeCurrency: {
    decimals: 18,
    name: "MOCA",
    symbol: "MOCA",
  },
  rpcUrls: {
    default: { http: ["https://testnet-rpc.mocachain.org"] },
  },
  blockExplorers: {
    default: {
      name: "Mocaverse Testnet Explorer",
      url: "https://testnet-scan.mocachain.org/",
    },
  },
  contracts: {
    multicall3: {
      address: "0xcA11bde05977b3631167028862bE2a173976CA11",
    },
  },
  testnet: true,
});

const mocaMainnet = defineChain({
  id: 2288,
  name: "Moca Mainnet",
  nativeCurrency: {
    decimals: 18,
    name: "MOCA",
    symbol: "MOCA",
  },
  rpcUrls: {
    default: { http: [] },
  },
  blockExplorers: {
    default: {
      name: "Mocaverse Explorer",
      url: "https://moca-mainnet.cloud.blockscout.com/",
    },
  },
  contracts: {
    multicall3: {
      address: "0xcA11bde05977b3631167028862bE2a173976CA11",
    },
  },
  testnet: false,
});

export const CHAIN_DEFINITIONS: chains.Chain[] = values({
  ...chains,
  katana,
  hyperEvm,
  neuraTestnet,
  fluentTestnet,
  monadMainnet,
  arcTestnet,
  sonicTestnet,
  mocaTestnet,
  mocaMainnet,
  megaethTestnet,
  megaethMainnet,
}).filter((c) => c.name !== wanchainTestnet.name && c.name !== megaeth.name); // remove wanchainTestnet which clashes with hyperEvm

export const CHAIN_CONFIG_DEFAULTS = {
  batcher: {
    batchGasLimit: parseNum(
      process.env.DEFAULT_USER_OPS_BATCH_GAS_LIMIT,
      8_000_000,
      {
        min: 100_000,
      },
    ),
  },
  simulator: {
    stalledJobsRetryInterval: parseSeconds(
      process.env.DEFAULT_SIMULATOR_STALLED_JOBS_RETRY_INTERVAL,
      5,
      {
        min: 1,
        max: 10,
      },
    ),
    rateLimitMaxRequestsPerInterval: parseNum(
      process.env.DEFAULT_SIMULATOR_RATE_LIMIT_MAX_REQUESTS_PER_INTERVAL,
      100,
      {
        min: 50,
        max: 200,
      },
    ),
    rateLimitDuration: parseSeconds(
      process.env.DEFAULT_SIMULATOR_RATE_LIMIT_DURATION,
      1,
      {
        min: 1,
        max: 1,
      },
    ),
    numWorkers: parseNum(
      process.env.DEFAULT_NUM_SIMULATOR_WORKERS_PER_CHAIN,
      1,
      {
        min: 1,
      },
    ),
    workerConcurrency: parseNum(
      process.env.DEFAULT_SIMULATOR_WORKER_CONCURRENCY,
      10,
      {
        min: 1,
      },
    ),
    traceCallRetryDelay: parseNum(
      process.env.DEFAULT_SIMULATOR_TRACE_CALL_RETRY_DELAY,
      2000,
      {
        min: 75,
      },
    ),
  },
  executor: {
    stalledJobsRetryInterval: parseSeconds(
      process.env.DEFAULT_EXECUTOR_STALLED_JOBS_RETRY_INTERVAL,
      5,
      {
        min: 1,
        max: 10,
      },
    ),
    rateLimitMaxRequestsPerInterval: parseNum(
      process.env.DEFAULT_EXECUTOR_RATE_LIMIT_MAX_REQUESTS_PER_INTERVAL,
      100,
      {
        min: 50,
        max: 200,
      },
    ),
    rateLimitDuration: parseSeconds(
      process.env.DEFAULT_EXECUTOR_RATE_LIMIT_DURATION,
      1,
      {
        min: 1,
        max: 1,
      },
    ),
  },
};
