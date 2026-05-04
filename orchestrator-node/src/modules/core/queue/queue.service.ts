import { Logger } from "@/core/logger";
import { UnrecoverableError } from "@/core/queue/index";
import { RedisService } from "@/core/redis";
import {
  type Job,
  Queue,
  type QueueBaseOptions,
  QueueEvents,
  Worker,
} from "bullmq";
import { Service } from "typedi";
import {
  type GetJobsOptions,
  type JobCounts,
  type JobOptions,
  type OptionsWithQueueName,
  type Processor,
  type QueueEventsOptions,
  type QueueOptions,
  type WorkerOptions,
} from "./interfaces";
import { decodeJobData, encodeJobData } from "./utils";

@Service()
export class QueueService<
  DataType,
  ResultType,
  NameType extends string = string,
> {
  private readonly queues = new Map<string, Queue>();

  private queueBaseOptions: QueueBaseOptions | undefined;

  constructor(
    private readonly logger: Logger,
    private readonly redisService: RedisService,
  ) {
    logger.setCaller(QueueService);
  }

  getQueue(options: QueueOptions) {
    const { name, ...queueOptions } = options;

    let queue = this.queues.get(name);

    if (!queue) {
      queue = new Queue<DataType, ResultType, NameType>(name, {
        ...this.getQueueBaseOptions(),
        ...queueOptions,
      });

      this.queues.set(name, queue);
    }

    return queue as Queue<
      DataType,
      ResultType,
      NameType,
      DataType,
      ResultType,
      NameType
    >;
  }

  getQueueEvents(options: QueueEventsOptions) {
    const { queueName, ...queueEventsOptions } = options;

    return new QueueEvents(queueName, {
      ...this.getQueueBaseOptions(),
      ...queueEventsOptions,
    });
  }

  async getJobs(options: GetJobsOptions) {
    const { queueName, type } = options;

    const jobs = await this.getQueue({
      name: queueName,
    }).getJobs(type);

    return jobs.map((job) => {
      job.data = decodeJobData(job.data);
      return job;
    });
  }

  async getJobCounts(options: OptionsWithQueueName) {
    const { queueName } = options;

    const jobCounts = await this.getQueue({
      name: queueName,
    }).getJobCounts("active", "waiting", "delayed", "paused");

    return jobCounts as JobCounts;
  }

  addJob(
    job: Pick<Job<DataType, ResultType, NameType>, "name" | "data">,
    options: OptionsWithQueueName<JobOptions>,
  ) {
    const { queueName, ...jobOptions } = options;

    return this.getQueue({
      name: queueName,
    }).add(job.name, encodeJobData(job.data), jobOptions);
  }

  addJobs(
    jobs: Pick<Job<DataType, ResultType, NameType>, "name" | "data">[],
    options: OptionsWithQueueName<JobOptions>,
  ) {
    const { queueName, ...jobOptions } = options;

    return this.getQueue({
      name: queueName,
    }).addBulk(
      jobs.map(({ name, data }) => ({
        name,
        data: encodeJobData(data),
        opts: jobOptions,
      })),
    );
  }

  async createWorker(
    processor: Processor<Job<DataType, ResultType, NameType>>,
    options: OptionsWithQueueName<WorkerOptions>,
  ) {
    const { queueName, name, ...workerOptions } = options;

    const workerLabel = `Queue worker${name ? ` (${name})` : ""}`;

    const getJobLabel = (job?: Job) =>
      `${workerLabel} job (${job?.name || "unknown"})`;

    const worker = await new Promise<Worker<DataType, ResultType, NameType>>(
      (resolve, reject) => {
        const workerInstance = new Worker<DataType, ResultType, NameType>(
          queueName,
          (job, token) => {
            job.data = decodeJobData(job.data);

            const updateData = job.updateData.bind(job);

            job.updateData = (data) => updateData(encodeJobData(data));

            return processor.processJob(job, token);
          },
          {
            ...this.getQueueBaseOptions(),
            ...workerOptions,
          },
        );

        workerInstance
          .once("ready", () => {
            this.logger.trace(`${workerLabel} READY`);
            resolve(workerInstance);
          })
          .once("error", (err) => {
            if (workerInstance.isRunning()) {
              // Handle runtime error once
              this.logger.error(err, workerLabel);
            } else {
              // Handle startup failure
              const errorMessage =
                (err as Error).message || "Failed to start the queue worker";
              reject(errorMessage);
            }
          });
      },
    );

    worker
      .on("ready", () => {
        this.logger.trace(`${workerLabel} READY`);
      })
      .on("paused", () => {
        this.logger.trace(`${workerLabel} PAUSED`);
      })
      .on("resumed", () => {
        this.logger.trace(`${workerLabel} RESUMED`);
      })
      .on("error", (err) => {
        this.logger.error(err, workerLabel);
      })
      .on("active", async (job) => {
        this.logger.trace(`${getJobLabel(job)} ACTIVE`);
      })
      .on("completed", async (job) => {
        this.logger.trace(`${getJobLabel(job)} COMPLETED`);
      })
      .on("failed", async (job, err) => {
        if (err instanceof UnrecoverableError) {
          return;
        }

        this.logger.error(err, `${getJobLabel(job)} FAILED`);
      });

    return worker;
  }

  private getQueueBaseOptions(): QueueBaseOptions {
    if (!this.queueBaseOptions) {
      this.queueBaseOptions = {
        prefix: "queue",
        connection: this.redisService.getClient({
          name: "queue",
          maxRetriesPerRequest: null,
        }),
      };
    }

    return this.queueBaseOptions;
  }
}
