import { BadRequestException } from "@/common";
import { withTrace } from "@/common/utils/trace-wrapper";
import { HealthCheckService } from "@/health-check";
import { NodeService } from "@/node";
import { type RequestHandler } from "express";
import { Container } from "typedi";
import { API_VERSION } from "../constants";

export const infoHandler: RequestHandler = await withTrace(
  `/${API_VERSION}/info`,
  async (_req, res) => {
    const nodeService = Container.get(NodeService);
    const healthCheckService = Container.get(HealthCheckService);

    const healthInfo = healthCheckService.result;

    const nodeInfo = await nodeService.getNodeinfo();

    const chainInfoWithHealthCheck = nodeInfo.supportedChains.map(
      (chainInfo) => {
        if (!healthInfo) {
          throw new BadRequestException("Node is getting ready, please wait!");
        }

        const services = healthInfo.services;
        const healthCheck = {
          status: healthInfo.chains[chainInfo.chainId],
          lastChecked: healthInfo.timestamp,
          modules: [
            {
              type: "chain",
              data:
                services.chainsService.chains[chainInfo.chainId] || "unknown",
            },
            {
              type: "simulator",
              data:
                services.simulatorService.chains[chainInfo.chainId] ||
                "unknown",
            },
            {
              type: "executor",
              data:
                services.executorService.chains[chainInfo.chainId] || "unknown",
            },
            {
              type: "node",
              data: services.nodeService.chains[chainInfo.chainId] || "unknown",
            },
            {
              type: "workers",
              data:
                services.workersService.chains[chainInfo.chainId] || "unknown",
            },
            {
              type: "redis",
              data: services.redisService || "unknown",
            },
            {
              type: "token-slot-detection",
              data:
                services.tokenSlotDetectionService.chains[chainInfo.chainId] ||
                "unknown",
            },
          ],
        };

        return { ...chainInfo, healthCheck };
      },
    );

    const info = { ...nodeInfo, supportedChains: chainInfoWithHealthCheck };

    res.send(info);
  },
);
