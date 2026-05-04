import cluster from "node:cluster";
import { resolve } from "node:path";
import process from "node:process";
import * as workerThreads from "node:worker_threads";
import { ChainsService } from "@/chains";
import { sleep } from "@/common";
import { type ConfigType, InjectConfig } from "@/core/config";
import { Logger } from "@/core/logger";
import {
  type ServiceHealthCheckResult,
  type ServiceWithHealthCheck,
} from "@/health-check";
import { WORKER_SPAWN_DELAY } from "@/node/node.config";
import { RpcManagerService } from "@/rpc-manager";
import Container, { Service } from "typedi";
import { stringify } from "viem";
import {
  type ClusterWorker,
  type ClusterWorkerMessage,
  type NotifyThreadWorkersOptions,
  type ThreadWorker,
  type ThreadWorkerData,
  type ThreadWorkerMessage,
  type WorkersHealthCheckData,
} from "./interfaces";
import { encodeMessage } from "./utils";
import { workersConfig } from "./workers.config";

@Service()
export class WorkersService
  implements ServiceWithHealthCheck<WorkersHealthCheckData>
{
  private readonly workers: Array<ThreadWorker | ClusterWorker> = [];

  constructor(
    @InjectConfig(workersConfig)
    private readonly config: ConfigType<typeof workersConfig>,
    private readonly logger: Logger,
    private readonly chainsService: ChainsService,
    private readonly rpcManagerService: RpcManagerService,
  ) {
    logger.setCaller(WorkersService);
  }

  async initialize() {
    const { numClusterWorkers } = this.config;

    const { chainsSettings } = this.chainsService;

    const encodedInitialMessage = encodeMessage<ClusterWorkerMessage>({
      type: "chainsSettings",
      data: chainsSettings,
    });

    for (let index = 0; index < numClusterWorkers; index++) {
      this.workers.push(
        this.setupClusterWorker(
          {
            type: "cluster",
          },
          encodedInitialMessage,
        ),
      );
    }

    for (const chainSettings of chainsSettings) {
      const { chainId } = chainSettings;

      const executorWorker = await this.setupThreadWorker(
        {
          type: "executor",
          chainId,
        },
        {
          chainSettings,
        },
      );

      this.workers.push(executorWorker);

      for (let index = 0; index < chainSettings.simulator.numWorkers; index++) {
        const simulatorWorker = await this.setupThreadWorker(
          {
            type: "simulator",
            chainId,
          },
          {
            chainSettings,
          },
        );

        this.workers.push(simulatorWorker);
      }
    }

    this.rpcManagerService.syncRpcConfig();
  }

  performHealthCheck(): ServiceHealthCheckResult<WorkersHealthCheckData> {
    if (!this.workers.length) {
      return {
        chains: {},
        cluster: {
          status: "unhealthy",
          workers: [],
        },
      };
    }

    const cluster: WorkersHealthCheckData["cluster"] = {
      status: "unhealthy",
      workers: [],
    };

    const chains: WorkersHealthCheckData["chains"] = {};

    try {
      let clusterUnhealthyCount = 0;
      const workerUnhealthyCountByChains = new Map<string, number>();

      for (const worker of this.workers) {
        const { type, state } = worker;

        switch (type) {
          case "cluster": {
            const { instance } = worker;

            cluster.workers.push({
              state: state || "unknown",
              pid: instance?.process.pid,
            });

            if (state !== "listening") {
              clusterUnhealthyCount++;
            }

            if (clusterUnhealthyCount) {
              cluster.status = "unhealthy";
            } else {
              cluster.status = "healthy";
            }
            break;
          }

          default: {
            const { instance, chainId } = worker;

            if (!chains[chainId]) {
              chains[chainId] = {
                status: "unhealthy",
                workers: {
                  simulator: [],
                  executor: [],
                },
              };
            }

            chains[chainId].workers[type].push({
              state: state || "unknown",
              threadId: instance?.threadId,
            });

            if (state !== "online") {
              const incCount =
                (workerUnhealthyCountByChains.get(chainId) || 0) + 1;
              workerUnhealthyCountByChains.set(chainId, incCount);
            }

            if (workerUnhealthyCountByChains.get(chainId)) {
              chains[chainId].status = "unhealthy";
            } else {
              chains[chainId].status = "healthy";
            }
          }
        }
      }

      return {
        cluster,
        chains,
      };
    } catch (error) {
      this.logger.info(
        {
          error: (error as Error).message || stringify(error),
        },
        "Failed to check health for worker service",
      );

      return {
        cluster,
        chains,
      };
    }
  }

  notifyClusterWorkers(message: ClusterWorkerMessage) {
    let result = 0;

    const encodedMessage = encodeMessage(message);

    for (const { type, state, instance } of this.workers) {
      if (type !== "cluster" || state !== "listening" || !instance) {
        continue;
      }

      if (instance.send(encodedMessage)) {
        ++result;
      }
    }

    return result;
  }

  notifyThreadWorkers(
    message: ThreadWorkerMessage,
    options: NotifyThreadWorkersOptions,
  ) {
    let result = 0;

    const encodedMessage = encodeMessage(message);

    const { chainId, workerType } = options;

    for (const worker of this.workers) {
      const { type, state, instance } = worker;

      if (type === "cluster" || state !== "online" || !instance) {
        continue;
      }

      if ((workerType && type !== workerType) || worker.chainId !== chainId) {
        continue;
      }

      try {
        instance.postMessage(encodedMessage);

        ++result;
      } catch (err) {
        this.logger.error(err);
      }
    }

    return result;
  }

  private setupClusterWorker(
    worker: ClusterWorker,
    encodedInitialMessage: Buffer,
    isReinitializeWorker = false,
  ) {
    const instance = cluster.fork();

    const { pid } = instance.process;

    const workerLabel = `Cluster worker (api/${pid})`;

    instance
      .on("online", () => {
        this.logger.trace(`${workerLabel} ONLINE`);

        worker.state = "online";
        worker.instance = instance;

        // If worker got terminated for some reason, the RPC config will be synced here
        if (isReinitializeWorker) {
          this.rpcManagerService.syncRpcConfig();
        }
      })
      .on("listening", () => {
        this.logger.trace(`${workerLabel} LISTENING`);

        if (!instance.send(encodedInitialMessage)) {
          instance.destroy();
          return;
        }

        worker.state = "listening";
      })
      .on("error", (err) => {
        this.logger.error(err, workerLabel);
      })
      .on("exit", () => {
        this.logger.trace(`${workerLabel} EXIT`);

        instance.removeAllListeners();

        worker.state = "exited";
        worker.instance = undefined;

        this.setupClusterWorker(worker, encodedInitialMessage, true);
      });

    return worker;
  }

  private async setupThreadWorker(
    worker: ThreadWorker,
    workerData: ThreadWorkerData,
    isReinitializeWorker = false,
  ) {
    const { type, chainId } = worker;

    // Intentially delaying the work creation to avoid spikes in startup
    await sleep(WORKER_SPAWN_DELAY);

    const instance = await new Promise<workerThreads.Worker>(
      (resolve_, reject) => {
        const workerInstance = new workerThreads.Worker(
          resolve(__dirname, `../../workers/${type}/main`),
          {
            workerData,
          },
        );

        const { pid } = process;
        const { threadId } = workerInstance;

        const workerLabel = `Thread worker (${type}/${chainId}/${pid}/${threadId})`;

        workerInstance.once("online", () => {
          this.logger.trace(`${workerLabel} ONLINE`);

          worker.state = "online";
          worker.instance = workerInstance;

          // If worker got terminated for some reason, the RPC config will be synced here
          if (isReinitializeWorker) {
            this.rpcManagerService.syncRpcConfig();
          }

          resolve_(workerInstance);
        });

        workerInstance.once("error", (err) => {
          if (worker.state === "online") {
            // Handle runtime error once
            this.logger.error(err, workerLabel);
          } else {
            // Handle startup error
            const errorMessage =
              (err as Error).message || "Failed to start the thread worker";
            reject(errorMessage);
          }
        });
      },
    );

    const { pid } = process;
    const { threadId } = instance;

    const workerLabel = `Thread worker (${type}/${chainId}/${pid}/${threadId})`;

    instance
      .on("online", () => {
        this.logger.trace(`${workerLabel} ONLINE`);

        worker.state = "online";
        worker.instance = instance;
      })
      .on("error", (err) => {
        this.logger.error(err, workerLabel);
      })
      .on("exit", async () => {
        this.logger.trace(`${workerLabel} EXIT`);

        instance.removeAllListeners();

        worker.state = "exited";
        worker.instance = undefined;

        await this.setupThreadWorker(worker, workerData, true);
      });

    return worker;
  }
}
