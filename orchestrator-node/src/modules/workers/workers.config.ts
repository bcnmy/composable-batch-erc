import { availableParallelism } from "node:os";
import process from "node:process";
import { parseNum } from "@/common";
import { registerConfigAs } from "@/core/config";

export const workersConfig = registerConfigAs("workers", () => ({
  numClusterWorkers: parseNum(process.env.NUM_CLUSTER_WORKERS, 1, {
    min: 1,
    max: availableParallelism(),
  }),
}));
