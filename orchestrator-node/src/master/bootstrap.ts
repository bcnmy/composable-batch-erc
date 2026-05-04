import { BatcherService } from "@/batcher";
import { ChainsService } from "@/chains";
import { Logger } from "@/core/logger";
import { ExecutorService } from "@/executor";
import { GasManagerService } from "@/gas-manager";
import { HealthCheckService } from "@/health-check";
import { NodeService } from "@/node";
import { RpcChainConfig, RpcManagerService } from "@/rpc-manager";
import { SimulatorService } from "@/simulator";
import { WorkersService } from "@/workers";
import { entries, map } from "remeda";
import { Container } from "typedi";

export async function bootstrap() {
  Logger.setName("master");

  const logger = Container.get(Logger);
  const batcherService = Container.get(BatcherService);
  const chainsService = Container.get(ChainsService);
  const gasManagerService = Container.get(GasManagerService);
  const healthCheckService = Container.get(HealthCheckService);
  const nodeService = Container.get(NodeService);
  const workersService = Container.get(WorkersService);
  const rpcManagerService = Container.get(RpcManagerService);

  // Chain settings will be initialized
  await chainsService.initialize();

  const chainsSettings = chainsService.getChainsSettings();

  const rpcChainConfigs: RpcChainConfig[] = [];

  for (const { chainId, rpcs, isTestChain } of chainsSettings) {
    const rpcChainConfig: RpcChainConfig =
      rpcManagerService.prepareRpcChainConfig(chainId, rpcs, isTestChain);

    rpcChainConfigs.push(rpcChainConfig);
  }

  const rpcConfigs = {
    chains: rpcChainConfigs,
  };

  rpcManagerService
    .on("setup", (rpcConfigs) => {
      workersService.notifyClusterWorkers({
        type: "rpcManagerConfig",
        data: rpcConfigs,
      });

      for (const rpcConfig of rpcConfigs.chains) {
        workersService.notifyThreadWorkers(
          {
            type: "rpcManagerConfig",
            data: rpcConfig,
          },
          {
            chainId: rpcConfig.chainId,
            workerType: "simulator",
          },
        );

        workersService.notifyThreadWorkers(
          {
            type: "rpcManagerConfig",
            data: rpcConfig,
          },
          {
            chainId: rpcConfig.chainId,
            workerType: "executor",
          },
        );
      }
    })
    .on("sync", (rpcProviderSyncConfigs) => {
      workersService.notifyClusterWorkers({
        type: "rpcProviderSyncConfig",
        data: rpcProviderSyncConfigs,
      });

      workersService.notifyThreadWorkers(
        {
          type: "rpcProviderSyncConfig",
          data: rpcProviderSyncConfigs,
        },
        {
          chainId: rpcProviderSyncConfigs.chainId,
          workerType: "simulator",
        },
      );

      workersService.notifyThreadWorkers(
        {
          type: "rpcProviderSyncConfig",
          data: rpcProviderSyncConfigs,
        },
        {
          chainId: rpcProviderSyncConfigs.chainId,
          workerType: "executor",
        },
      );
    })
    // RPC providers will be initialized
    .setup(rpcConfigs, true);

  // Workers will be spawned
  await workersService.initialize();

  const gasManagerConfigs = chainsSettings.map((chainSettings) => ({
    chainId: chainSettings.chainId,
    gasFetchInterval: chainSettings.gasCacheDuration,
  }));

  const threadGasInfoSync = true;

  gasManagerService.on("sync", (gasInfoByChain) => {
    workersService.notifyClusterWorkers({
      type: "gasInfoSync",
      data: gasInfoByChain,
    });

    workersService.notifyThreadWorkers(
      {
        type: "gasInfoSync",
        data: gasInfoByChain,
      },
      {
        chainId: gasInfoByChain.chainId,
        workerType: "simulator",
      },
    );

    workersService.notifyThreadWorkers(
      {
        type: "gasInfoSync",
        data: gasInfoByChain,
      },
      {
        chainId: gasInfoByChain.chainId,
        workerType: "executor",
      },
    );
  });

  // Gas manager will be initialized
  await gasManagerService.initialize(gasManagerConfigs, threadGasInfoSync);

  // Batcher will be initialized and this can be initialzed anytime after chain service.
  await batcherService.initialize();

  // node service will be initialized which depends on RPC manager.
  await nodeService.initialize();

  await healthCheckService
    .on("*:healthChecked", async (result) => {
      workersService.notifyClusterWorkers({
        type: "healthCheckResult",
        data: result,
      });
    })
    .on("chain:healthChanged", async (chainId, state) => {
      const queues = [
        Container.get(ExecutorService).getQueue(chainId),
        Container.get(SimulatorService).getQueue(chainId),
      ];

      for (const queue of queues) {
        switch (state) {
          case "healthy":
            await queue.resume();
            break;

          case "unhealthy":
            await queue.pause();
            break;
        }
      }
    })
    .on("nodeService:healthChecked", async (result) => {
      if (!result.chains) {
        console.log("Node Health Check Issue: ", result);
        logger.error("Unknown NodeService health");
        return;
      }

      const { chains } = result;

      for (const [chainId, { workers }] of entries(chains)) {
        workersService.notifyThreadWorkers(
          {
            type: "nodeWalletsStates",
            data: map(entries(workers), ([address, { active }]) => ({
              address,
              active,
            })),
          },
          {
            chainId,
            workerType: "executor",
          },
        );
      }
    })
    // Finally the health service is initialized and workers will be activated for execution processing
    .initialize();
}
