import { parentPort } from "node:worker_threads";
import { ChainsService } from "@/chains";
import { Logger } from "@/core/logger";
import { type Worker } from "@/core/queue";
import { ExecutorProcessor, ExecutorService } from "@/executor";
import { GasManagerService } from "@/gas-manager";
import { NODE_ACCOUNT_TOKEN, NodeService } from "@/node";
import { RpcManagerService } from "@/rpc-manager";
import { MeeUserOpBatch } from "@/user-ops";
import {
  type ThreadWorkerData,
  type ThreadWorkerMessage,
  decodeMessage,
} from "@/workers";
import { Container } from "typedi";
import { type Hex } from "viem";

export async function bootstrap(options: ThreadWorkerData) {
  const { chainSettings } = options;
  const { chainId } = chainSettings;

  if (process.env.OTEL_TRACE_ENABLED === "true") {
    (async () => {
      const tracingModule = await import("../../tracing-opentelemetry");
      tracingModule.initialize(`executor-worker-${chainId}`);
    })();
  }

  Logger.setName(`executor/${chainId}`);

  const logger = Container.get(Logger).setCaller("bootstrap");
  const chainsService = Container.get(ChainsService);
  const executorService = Container.get(ExecutorService);
  const nodeService = Container.get(NodeService);
  const rpcManagerService = Container.get(RpcManagerService);
  const gasManagerService = Container.get(GasManagerService);

  chainsService.setChainSettings(chainSettings);

  const executorWorkers = new Map<Hex, Worker<MeeUserOpBatch, boolean, Hex>>();

  parentPort?.on("message", async (message: Buffer) => {
    const { type, data } = decodeMessage<ThreadWorkerMessage>(message);

    switch (type) {
      case "nodeWalletsStates":
        for (const { address, active } of data) {
          let executorWorker = executorWorkers.get(address);

          if (active) {
            if (!executorWorker) {
              Container.set(
                NODE_ACCOUNT_TOKEN,
                nodeService.getAccount(address),
              );

              // transient instance
              const executorProcessor = Container.get(ExecutorProcessor);

              Container.remove(NODE_ACCOUNT_TOKEN);

              executorWorker = await executorService.createWorker(
                chainId,
                executorProcessor,
                {
                  name: address,
                  stalledInterval:
                    chainSettings.executor.stalledJobsRetryInterval,
                  limiter: {
                    max: chainSettings.executor.rateLimitMaxRequestsPerInterval,
                    duration: chainSettings.executor.rateLimitDuration,
                  },
                },
              );

              executorWorkers.set(address, executorWorker);
            } else if (executorWorker.isPaused()) {
              executorWorker.resume();
            }
          } else if (executorWorker?.isRunning()) {
            executorWorker
              .pause() //
              .catch((err) => logger.error(err));
          }
        }
        break;

      case "rpcManagerConfig":
        rpcManagerService.setup({ chains: [data] }, false);
        break;

      case "rpcProviderSyncConfig":
        rpcManagerService.syncProviders(
          data.chainId,
          data.rpcProviderSyncConfigs,
        );
        break;

      case "gasInfoSync": {
        gasManagerService.syncGasInfo(data.chainId, data.gasInfo);
        break;
      }
    }
  });

  logger.trace("Worker started");
}
