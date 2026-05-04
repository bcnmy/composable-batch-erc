import process from "node:process";
import { parsePort } from "@/common";
import { registerConfigAs } from "@/core/config";

export const redisConfig = registerConfigAs("redis", () => ({
  host: process.env.REDIS_HOST || "localhost",
  port: parsePort(process.env.REDIS_PORT, 6379),
}));
