import { parentPort } from "node:worker_threads";
import { ChainsService } from "@/chains";
import { Logger } from "@/core/logger";
import { GasManagerService } from "@/gas-manager";
import { RpcManagerService } from "@/rpc-manager";
import { SimulatorProcessor, SimulatorService } from "@/simulator";
import {
  type ThreadWorkerData,
  ThreadWorkerMessage,
  decodeMessage,
} from "@/workers";
import { Container } from "typedi";

export async function bootstrap(options: ThreadWorkerData) {
  const { chainSettings } = options;
  const {
    chainId,
    simulator: { workerConcurrency },
  } = chainSettings;

  if (process.env.OTEL_TRACE_ENABLED === "true") {
    (async () => {
      const tracingModule = await import("../../tracing-opentelemetry");
      tracingModule.initialize(`simulator-worker-${chainId}`);
    })();
  }

  Logger.setName(`simulator/${chainId}`);

  const logger = Container.get(Logger).setCaller("bootstrap");
  const chainsService = Container.get(ChainsService);
  const simulatorProcessor = Container.get(SimulatorProcessor);
  const simulatorService = Container.get(SimulatorService);
  const rpcManagerService = Container.get(RpcManagerService);
  const gasManagerService = Container.get(GasManagerService);

  chainsService.setChainSettings(chainSettings);

  parentPort?.on("message", async (message: Buffer) => {
    const { type, data } = decodeMessage<ThreadWorkerMessage>(message);

    switch (type) {
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

  await simulatorService.createWorker(chainId, simulatorProcessor, {
    stalledInterval: chainSettings.simulator.stalledJobsRetryInterval, // 5 seconds
    concurrency: workerConcurrency,
    limiter: {
      max: chainSettings.simulator.rateLimitMaxRequestsPerInterval,
      duration: chainSettings.simulator.rateLimitDuration,
    },
  });

  logger.trace("Worker started");
}
