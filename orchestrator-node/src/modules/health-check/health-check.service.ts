import { setTimeout } from "node:timers/promises";
import { type ConfigType, InjectConfig } from "@/core/config";
import { Logger } from "@/core/logger";
import { entries, fromEntries, keys } from "remeda";
import { Service } from "typedi";
import { HealthCheckServices } from "./health-check-services";
import { healthCheckConfig } from "./health-check.config";
import {
  HealthCheckEventHandler,
  HealthCheckEventHandlers,
  HealthCheckEvents,
  HealthCheckResult,
} from "./interfaces";

@Service()
export class HealthCheckService {
  private latestResult: HealthCheckResult | undefined;

  private readonly serviceNames: Array<keyof HealthCheckServices>;

  private readonly eventHandlers: HealthCheckEventHandlers = {};

  constructor(
    @InjectConfig(healthCheckConfig)
    private readonly config: ConfigType<typeof healthCheckConfig>,
    private readonly logger: Logger,
    private readonly services: HealthCheckServices,
  ) {
    this.serviceNames = keys(this.services);

    logger.setCaller(HealthCheckService);
  }

  async initialize() {
    const { initialDelay, interval } = this.config;

    await setTimeout(initialDelay);

    await this.performCheck();

    this.logger.trace("Health check started");

    while (true) {
      await setTimeout(interval);

      await this.performCheck();
    }
  }

  get result() {
    return this.latestResult;
  }

  setResult(result: HealthCheckResult) {
    this.latestResult = result;
  }

  on<K extends keyof HealthCheckEvents>(
    event: K,
    handler: HealthCheckEventHandler<HealthCheckEvents[K]>,
  ) {
    if (!this.eventHandlers[event]) {
      this.eventHandlers[event] = [];
    }

    this.eventHandlers[event].push(handler);

    return this;
  }

  private async performCheck() {
    const servicesEntries = await Promise.all(
      entries(this.services).map(async ([serviceName, service]) => {
        const result = await Promise.resolve(service.performHealthCheck());
        return [serviceName, result] as const;
      }),
    );

    const chains: HealthCheckResult["chains"] = {};

    const services = fromEntries(
      servicesEntries,
    ) as HealthCheckResult["services"];

    for (const chainId of this.chainsService.chainIds) {
      const isHealthy = this.serviceNames.every((serviceName) => {
        switch (serviceName) {
          // If redis is not healthy ? chain is unhealthy
          case "redisService":
            return services[serviceName].status === "healthy";

          // If exec/simulator worker or node or chain is unhealthy ? chain  is unhealthy
          case "simulatorService":
          case "executorService":
          case "nodeService":
          case "chainsService":
            return services[serviceName].chains[chainId]?.status === "healthy";

          // token slot detection health check is always considered as soft health check. So this doesn't determine the chain health.
          // So it will always return true.
          case "tokenSlotDetectionService":
            return true;

          case "workersService":
            return (
              services[serviceName].cluster.status === "healthy" &&
              services[serviceName].chains[chainId]?.status === "healthy"
            );
          default:
            return false;
        }
      });

      chains[chainId] = isHealthy ? "healthy" : "unhealthy";
    }

    // If anyone of the chain is healthy ? The node is considered as healthy
    const isHealthy = Object.values(chains).some(
      (state) => state === "healthy",
    );

    const latestResult: HealthCheckResult = {
      status: isHealthy ? "healthy" : "unhealthy",
      timestamp: Date.now(),
      chains,
      services,
    };

    try {
      await this.emit("*:healthChecked", latestResult);

      const previousResult = this.latestResult;
      const previousChains = previousResult?.chains || {};

      for (const [chainId, state] of entries(chains)) {
        if (state !== previousChains[chainId]) {
          await this.emit("chain:healthChanged", chainId, state);
        }
      }

      for (const serviceName of this.serviceNames) {
        const latestServiceResult = latestResult.services[serviceName];
        await this.emit(`${serviceName}:healthChecked`, latestServiceResult);
      }
    } catch (error) {
      this.logger.error(error);
    }

    this.latestResult = latestResult;
  }

  private get chainsService() {
    return this.services.chainsService;
  }

  private async emit<K extends keyof HealthCheckEvents>(
    event: K,
    ...payload: unknown[]
  ) {
    const handlers = this.eventHandlers[event];

    if (!handlers) {
      return;
    }

    for (const handler of handlers) {
      await handler(...(payload as HealthCheckEvents[K]));
    }
  }
}
