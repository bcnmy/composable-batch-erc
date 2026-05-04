import { ChainClient } from "@/chains/interfaces";
import { ProviderMetrics } from "./provider-metrics";

export type RpcProviderState = "active" | "degraded";

export interface RPCProvider {
  url: string;
  priority: number;
  metrics: ProviderMetrics;
  state: RpcProviderState;
  client?: ChainClient;
}

export interface RpcChainConfig {
  chainId: string;
  providers: RPCProvider[];
  failureThreshold: number;
  promotionThreshold: number;
  healthCheckInterval: number;
}

export interface RPCManagerConfig {
  chains: RpcChainConfig[];
}

export enum RpcErrorType {
  RETRIABLE = "RETRIABLE",
  NON_RETRIABLE = "NON_RETRIABLE",
  RATE_LIMIT = "RATE_LIMIT",
  CHAIN_ERROR = "CHAIN_ERROR",
}

export type RpcProviderSyncConfig = {
  url: string;
  priority?: number;
  state?: RpcProviderState;
};

export type RpcManagerEvents = {
  setup: RPCManagerConfig;
  sync: { chainId: string; rpcProviderSyncConfigs: RpcProviderSyncConfig[] };
};

export type RpcManagerEventHandler<T> = (payload: T) => void | Promise<void>;

export type RpcManagerEventHandlers = {
  [K in keyof RpcManagerEvents]?: RpcManagerEventHandler<RpcManagerEvents[K]>[];
};
