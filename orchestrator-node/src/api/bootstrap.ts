import process from "node:process";
import { ChainsService } from "@/chains";
import { parsePort } from "@/common";
import { Logger } from "@/core/logger";
import { GasManagerService } from "@/gas-manager";
import { HealthCheckService } from "@/health-check";
import { NodeService } from "@/node";
import { RpcManagerService } from "@/rpc-manager";
import { type ClusterWorkerMessage, decodeMessage } from "@/workers";
import cors from "cors";
import express from "express";
import { Container } from "typedi";
import {
  exceptionHandler,
  notFoundHandler,
  requestIdHandler,
} from "./handlers";
import { nodeRouter, v1Router } from "./routers";
import { jsonReplacer } from "./utils";

export async function bootstrap() {
  Logger.setName("api");

  const logger = Container.get(Logger).setCaller("bootstrap");
  const chainsService = Container.get(ChainsService);
  const healthCheckService = Container.get(HealthCheckService);
  const nodeService = Container.get(NodeService);
  const rpcManagerService = Container.get(RpcManagerService);
  const gasManagerService = Container.get(GasManagerService);

  await nodeService.readVersion();

  const port = parsePort(process.env.PORT, 4000);

  const app = express()
    .set("x-powered-by", false)
    .set("json replacer", jsonReplacer)
    .use(cors())
    .use(express.json({ limit: "1mb" }))
    .use(requestIdHandler)
    .use(nodeRouter)
    .use(v1Router)
    .use(notFoundHandler)
    .use(exceptionHandler);

  app.listen(port, (err) => {
    if (err) {
      logger.error(err);
      return;
    }

    logger.info(`Server listening on port: ${port}`);
  });

  process.on("message", (buffer: Buffer) => {
    const { type, data } = decodeMessage<ClusterWorkerMessage>(buffer);

    switch (type) {
      case "chainsSettings": {
        chainsService.setChainSettings(...data);
        break;
      }

      case "healthCheckResult": {
        healthCheckService.setResult(data);
        break;
      }

      case "rpcManagerConfig": {
        rpcManagerService.setup(data, false);
        break;
      }

      case "rpcProviderSyncConfig": {
        rpcManagerService.syncProviders(
          data.chainId,
          data.rpcProviderSyncConfigs,
        );
        break;
      }

      case "gasInfoSync": {
        gasManagerService.syncGasInfo(data.chainId, data.gasInfo);
        break;
      }
    }
  });
}
