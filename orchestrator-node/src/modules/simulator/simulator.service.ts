import { ChainsService } from "@/chains";
import { sleep, withTrace } from "@/common";
import { type ConfigType, InjectConfig } from "@/core/config";
import { Logger } from "@/core/logger";
import {
  type JobOptions,
  QueueService,
  type WorkerOptions,
} from "@/core/queue";
import {
  type HealthCheckState,
  type ServiceHealthCheckResult,
  type ServiceWithHealthCheck,
} from "@/health-check";
import { WORKER_SPAWN_DELAY } from "@/node/node.config";
import { fromEntries } from "remeda";
import { Service } from "typedi";
import { type Hex, stringify } from "viem";
import {
  type SimulatorHealthCheckData,
  type SimulatorJobData,
} from "./interfaces";
import { simulatorConfig } from "./simulator.config";
import { type SimulatorProcessor } from "./simulator.processor";
import { buildQueueName } from "./utils";

@Service()
export class SimulatorService
  implements ServiceWithHealthCheck<SimulatorHealthCheckData>
{
  constructor(
    @InjectConfig(simulatorConfig)
    private readonly config: ConfigType<typeof simulatorConfig>,
    private readonly chainsService: ChainsService,
    private readonly queueService: QueueService<SimulatorJobData, boolean, Hex>,
    private readonly logger: Logger,
  ) {
    logger.setCaller(SimulatorService);
  }

  async performHealthCheck(): Promise<
    ServiceHealthCheckResult<SimulatorHealthCheckData>
  > {
    try {
      const chains = fromEntries(
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
                "Failed to check health for simulator worker",
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
        "Failed to check health for simulator service",
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
      "simulatorQueue.getJobCounts",
      async () =>
        await this.queueService.getJobCounts({
          queueName: buildQueueName(chainId),
        }),
      { chainId },
    )();
  }

  async getCompletedJobs(chainId: string) {
    return await withTrace(
      "simulatorQueue.getCompletedJobs",
      async () =>
        await this.queueService.getJobs({
          queueName: buildQueueName(chainId),
          type: "completed",
        }),
      { chainId },
    )();
  }

  async addJob(
    chainId: string,
    data: SimulatorJobData,
    options: Pick<JobOptions, "delay"> = {},
  ) {
    const { meeUserOpHash } = data.meeUserOp;

    return await withTrace(
      "simulatorQueue.addJob",
      async () => {
        return await this.queueService.addJob(
          {
            name: meeUserOpHash,
            data,
          },
          {
            queueName: buildQueueName(chainId),
            ...this.config.job,
            ...options,
          },
        );
      },
      { chainId },
    )();
  }

  async addJobs(chainId: string, data: SimulatorJobData[]) {
    return await withTrace(
      "simulatorQueue.addJobs",
      async () => {
        return await this.queueService.addJobs(
          data.map((_data) => {
            const { meeUserOpHash } = _data.meeUserOp;

            return {
              name: meeUserOpHash,
              data: _data,
            };
          }),
          {
            queueName: buildQueueName(chainId),
            ...this.config.job,
          },
        );
      },
      { chainId },
    )();
  }

  async createWorker(
    chainId: string,
    processor: SimulatorProcessor,
    options: WorkerOptions,
  ) {
    // Intentially delaying the work creation to avoid spikes in startup
    await sleep(WORKER_SPAWN_DELAY);
    return await this.queueService.createWorker(processor, {
      queueName: buildQueueName(chainId),
      ...options,
    });
  }
}
