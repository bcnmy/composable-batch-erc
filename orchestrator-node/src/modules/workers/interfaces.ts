import type * as cluster from "node:cluster";
import type * as workerThreads from "node:worker_threads";
import { type ChainSettings } from "@/chains";
import { type GasManagerEvents } from "@/gas-manager";
import {
  type HealthCheckDataWithChains,
  type HealthCheckResult,
  type HealthCheckState,
} from "@/health-check";
import { RPCManagerConfig, RpcProviderSyncConfig } from "@/rpc-manager";
import { type Hex } from "viem";

export type WorkerType = "cluster" | "executor" | "simulator";

export type ThreadWorkerType = Exclude<WorkerType, "cluster">;

export type WorkerState = "unknown" | "online" | "listening" | "exited";

export interface Worker<T extends WorkerType, I> {
  type: T;
  state?: WorkerState;
  instance?: I;
}

export type ClusterWorker = Worker<"cluster", cluster.Worker>;

export interface ThreadWorker
  extends Worker<ThreadWorkerType, workerThreads.Worker> {
  chainId: string;
}

export interface ThreadWorkerData {
  chainSettings: ChainSettings;
}

export interface NotifyThreadWorkersOptions {
  chainId: string;
  workerType?: ThreadWorkerType;
}

// messages

export interface WorkerMessage<T = unknown, D = unknown> {
  type: T;
  data: D;
}

export type ClusterWorkerMessage =
  | WorkerMessage<"chainsSettings", ChainSettings[]>
  | WorkerMessage<"healthCheckResult", HealthCheckResult>
  | WorkerMessage<"rpcManagerConfig", RPCManagerConfig>
  | WorkerMessage<
      "rpcProviderSyncConfig",
      { chainId: string; rpcProviderSyncConfigs: RpcProviderSyncConfig[] }
    >
  | WorkerMessage<"gasInfoSync", GasManagerEvents["sync"]>;

export type ThreadWorkerMessage =
  | WorkerMessage<
      "nodeWalletsStates",
      {
        address: Hex;
        active: boolean;
      }[]
    >
  | WorkerMessage<"rpcManagerConfig", RPCManagerConfig["chains"][0]>
  | WorkerMessage<
      "rpcProviderSyncConfig",
      { chainId: string; rpcProviderSyncConfigs: RpcProviderSyncConfig[] }
    >
  | WorkerMessage<"gasInfoSync", GasManagerEvents["sync"]>;

// health check

export type WorkerHealth<D extends object> = {
  state: WorkerState;
} & D;

export type WorkersHealthCheckData = {
  cluster: {
    status: HealthCheckState;
    workers: WorkerHealth<{
      pid?: number;
    }>[];
  };
} & HealthCheckDataWithChains<{
  workers: Record<
    ThreadWorkerType,
    WorkerHealth<{
      threadId?: number;
    }>[]
  >;
}>;
