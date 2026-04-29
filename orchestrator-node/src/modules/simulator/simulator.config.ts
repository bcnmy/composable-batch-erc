import process from "node:process";
import { parseNum } from "@/common";
import { registerConfigAs } from "@/core/config";
import { type JobOptions, parseJobBackoffType } from "@/core/queue";

export const simulatorConfig = registerConfigAs<{
  job: JobOptions;
}>("simulator", () => {
  return {
    job: {
      removeOnComplete: false,
      removeOnFail: true,
      attempts: parseNum(process.env.SIMULATOR_QUEUE_JOB_ATTEMPTS, 10, {
        min: 0,
      }),
      backoff: {
        type: parseJobBackoffType(
          process.env.SIMULATOR_QUEUE_JOB_BACKOFF_TYPE,
          "fixed",
        ),
        delay: parseNum(process.env.SIMULATOR_QUEUE_JOB_BACKOFF_DELAY, 1000, {
          min: 75,
        }),
      },
    },
  };
});
