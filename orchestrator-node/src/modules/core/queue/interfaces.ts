import {
  type BackoffOptions,
  type BaseJobOptions,
  type Processor as DefaultProcessor,
  type QueueEventsOptions as DefaultQueueEventsOptions,
  type QueueOptions as DefaultQueueOptions,
  type WorkerOptions as DefaultWorkerOptions,
  type Job,
  type JobType,
} from "bullmq";

export type OptionsWithQueueName<T extends object = object> = {
  queueName: string;
} & T;

export type JobBackoffType = Extract<
  BackoffOptions["type"],
  "fixed" | "exponential"
>;

export type JobOptions = BaseJobOptions;

export type WorkerOptions = Omit<DefaultWorkerOptions, "connection">;

export interface QueueOptions extends Omit<DefaultQueueOptions, "connection"> {
  name: string;
}

export type QueueEventsOptions = OptionsWithQueueName<
  Omit<DefaultQueueEventsOptions, "connection">
>;

export type GetJobsOptions = OptionsWithQueueName<{
  type: JobType | JobType[];
}>;

export interface Processor<T extends Job> {
  processJob: DefaultProcessor<T["data"], T["returnvalue"], T["name"]>;
}

export type JobCounts = Record<
  "active" | "waiting" | "delayed" | "paused",
  number
>;
