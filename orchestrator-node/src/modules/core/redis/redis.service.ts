import { type ConfigType, InjectConfig } from "@/core/config";
import { Logger } from "@/core/logger";
import {
  type ServiceHealthCheckResult,
  type ServiceWithHealthCheck,
} from "@/health-check";
import { Redis } from "ioredis";
import { isString } from "remeda";
import { Service } from "typedi";
import { stringify } from "viem";
import { type RedisHealthCheckData, type RedisOptions } from "./interfaces";
import { redisConfig } from "./redis.config";

@Service()
export class RedisService
  implements ServiceWithHealthCheck<RedisHealthCheckData>
{
  private readonly clients = new Map<string, Redis>();

  constructor(
    @InjectConfig(redisConfig)
    private readonly config: ConfigType<typeof redisConfig>,
    private readonly logger: Logger,
  ) {
    logger.setCaller(RedisService);
  }

  async performHealthCheck(): Promise<
    ServiceHealthCheckResult<RedisHealthCheckData>
  > {
    try {
      const totalClients = await this.getTotalClients();

      if (!totalClients) {
        return {
          status: "unhealthy",
          clients: {
            totalClients: 0,
          },
        };
      }

      return {
        status: "healthy",
        clients: {
          totalClients,
        },
      };
    } catch (error) {
      this.logger.info(
        {
          error: (error as Error).message || stringify(error),
        },
        "Failed to check health for redis service",
      );

      return {
        status: "unhealthy",
        clients: {
          totalClients: 0,
        },
      };
    }
  }

  private async getTotalClients() {
    const res = await this.getClient({
      name: "healthCheck",
    }).client("LIST");

    if (!isString(res)) {
      return;
    }

    return res.split("\n").length;
  }

  getClient(options: RedisOptions) {
    const { name, ...redisOptions } = options;

    let client = this.clients.get(name);

    if (!client) {
      client = new Redis({
        ...this.config,
        ...redisOptions,
        lazyConnect: false,
        // Automatic pipelining for the redis calls which improves performance by reducing the roundtrip
        enableAutoPipelining: true,
      });

      client.client("SETNAME", name).catch((err) => this.logger.error(err));

      const label = `Client (${name})`;

      client
        .on("connect", () => {
          this.logger.trace(`${label} CONNECTED`);
        })
        .on("error", (err: Error) => {
          this.logger.error(err, label);
        });

      this.clients.set(name, client);
    }

    return client;
  }
}
