import process from "node:process";
import { parseSeconds } from "@/common";
import { registerConfigAs } from "@/core/config";

export const healthCheckConfig = registerConfigAs("health-check", () => ({
  initialDelay: parseSeconds(process.env.INITIAL_HEALTH_CHECK_DELAY, 1, {
    min: 1,
  }),
  interval: parseSeconds(process.env.HEALTH_CHECK_INTERVAL, 60, {
    min: 5,
  }),
}));
