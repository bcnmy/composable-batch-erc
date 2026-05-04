import { HealthCheckState } from "@/health-check";

export interface RedisOptions {
  name: string;
  maxRetriesPerRequest?: number | null;
}

export interface RedisHealthCheckData {
  status: HealthCheckState;
  clients?: {
    totalClients?: number;
  };
}
