import process from "node:process";
import { parseNum } from "@/common";
import { registerConfigAs } from "@/core/config";
import {
  type JobOptions,
  type WorkerOptions,
  parseJobBackoffType,
} from "@/core/queue";

export const EXECUTOR_QUEUE_JOB_ATTEMPTS = parseNum(
  process.env.EXECUTOR_QUEUE_JOB_ATTEMPTS,
  3,
  {
    min: 0,
  },
);

export const executorConfig = registerConfigAs<{
  job: JobOptions;
  worker: WorkerOptions;
}>("executor", () => ({
  job: {
    removeOnComplete: true,
    removeOnFail: true,
    attempts: EXECUTOR_QUEUE_JOB_ATTEMPTS,
    backoff: {
      type: parseJobBackoffType(
        process.env.EXECUTOR_QUEUE_JOB_BACKOFF_TYPE,
        "fixed",
      ),
      delay: parseNum(process.env.EXECUTOR_QUEUE_JOB_BACKOFF_DELAY, 1000, {
        min: 75,
      }),
    },
  },
  worker: {
    concurrency: 1,
  },
}));
