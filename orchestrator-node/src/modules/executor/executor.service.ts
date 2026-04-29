import { ChainsService } from "@/chains";
import { randomHash, sleep, withTrace } from "@/common";
import { type ConfigType, InjectConfig } from "@/core/config";
import { Logger } from "@/core/logger";
import { QueueService, type WorkerOptions } from "@/core/queue";
import {
  type HealthCheckState,
  type ServiceHealthCheckResult,
  type ServiceWithHealthCheck,
} from "@/health-check";
import { WORKER_SPAWN_DELAY } from "@/node/node.config";
import { type MeeUserOpBatch } from "@/user-ops";
import { fromEntries } from "remeda";
import { Service } from "typedi";
import { type Hex, stringify } from "viem";
import { executorConfig } from "./executor.config";
import { type ExecutorProcessor } from "./executor.processor";
import { type ExecutorHealthCheckData } from "./interfaces";
import { buildQueueName } from "./utils";

@Service()
export class ExecutorService
  implements ServiceWithHealthCheck<ExecutorHealthCheckData>
{
  constructor(
    @InjectConfig(executorConfig)
    private config: ConfigType<typeof executorConfig>,
    private readonly chainsService: ChainsService,
    private readonly queueService: QueueService<MeeUserOpBatch, boolean, Hex>,
    private readonly logger: Logger,
  ) {
    logger.setCaller(ExecutorService);
  }

  async performHealthCheck(): Promise<
    ServiceHealthCheckResult<ExecutorHealthCheckData>
  > {
    try {
      const chains: ExecutorHealthCheckData["chains"] = fromEntries(
        await Promise.all(
          this.chainsService.chainIds.map(async (chainId) => {
            try {
              const totalJobs = await this.getJobCounts(chainId).catch(
                () => undefined,
              );

              const state: HealthCheckState = totalJobs
                ? "healthy"
                : "unhealthy";

              return [
                chainId,
                {
                  status: state,
                  totalJobs,
                } as const,
              ];
            } catch (error) {
              this.logger.info(
                {
                  chainId,
                  error: (error as Error).message || stringify(error),
                },
                "Failed to check health for executor worker",
              );

              return [
                chainId,
                {
                  status: "unhealthy" as HealthCheckState,
                  totalJobs: undefined,
                } as const,
              ];
            }
          }),
        ),
      );

      return { chains };
    } catch (error) {
      this.logger.info(
        {
          error: (error as Error).message || stringify(error),
        },
        "Failed to check health for executor service",
      );
      return { chains: {} };
    }
  }

  getQueue(chainId: string) {
    return this.queueService.getQueue({
      name: buildQueueName(chainId),
    });
  }

  getEvents(chainId: string) {
    return this.queueService.getQueueEvents({
      queueName: buildQueueName(chainId),
    });
  }

  async getJobCounts(chainId: string) {
    return await withTrace(
      "executorQueue.getJobCounts",
      async () =>
        await this.queueService.getJobCounts({
          queueName: buildQueueName(chainId),
        }),
      { chainId },
    )();
  }

  async addJobs(chainId: string, meeUserOpBatches: MeeUserOpBatch[]) {
    return await withTrace(
      "executorQueue.addJobs",
      async () =>
        await this.queueService.addJobs(
          meeUserOpBatches.map((data) => ({
            name: randomHash(),
            data,
          })),
          {
            queueName: buildQueueName(chainId),
            ...this.config.job,
          },
        ),
      { chainId },
    )();
  }

  async createWorker(
    chainId: string,
    processor: ExecutorProcessor,
    options: WorkerOptions,
  ) {
    // Intentially delaying the work creation to avoid spikes in startup
    await sleep(WORKER_SPAWN_DELAY);
    return await this.queueService.createWorker(processor, {
      queueName: buildQueueName(chainId),
      ...this.config.worker,
      ...options,
    });
  }
}
