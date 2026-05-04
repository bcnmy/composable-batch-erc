import { type HealthCheckServices } from "./health-check-services";

export type HealthCheckState = "unhealthy" | "healthy";

export interface ServiceWithHealthCheck<Data extends object = object> {
  performHealthCheck():
    | Promise<ServiceHealthCheckResult<Data>>
    | ServiceHealthCheckResult<Data>;
}

export interface HealthCheckDataWithChains<Extra extends object = object> {
  chains: Record<
    string,
    {
      status: HealthCheckState;
    } & Extra
  >;
}

export type ServiceHealthCheckResult<Data extends object = object> = Data;

export type HealthCheckResultServices = {
  [K in keyof HealthCheckServices]: Awaited<
    ReturnType<HealthCheckServices[K]["performHealthCheck"]>
  >;
};

export interface HealthCheckResult {
  status: HealthCheckState;
  timestamp: number;
  chains: Record<string, HealthCheckState>;
  services: HealthCheckResultServices;
}

export type HealthCheckEvents = {
  "*:healthChecked": [HealthCheckResult];
  "*:healthChanged": [HealthCheckResult | undefined, HealthCheckResult];
  "chain:healthChanged": [chainId: string, HealthCheckState];
} & {
  [K in keyof HealthCheckResultServices as `${K & string}:healthChecked`]: [
    HealthCheckResultServices[K],
  ];
} & {
  [K in keyof HealthCheckResultServices as `${K & string}:healthChanged`]: [
    HealthCheckResultServices[K] | undefined,
    HealthCheckResultServices[K],
  ];
};

export type HealthCheckEventHandler<T extends unknown[]> = (
  ...payload: T
) => void | Promise<void>;

export type HealthCheckEventHandlers = {
  [K in keyof HealthCheckEvents]?: HealthCheckEventHandler<
    HealthCheckEvents[K]
  >[];
};
