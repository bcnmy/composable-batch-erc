import { ChainsService } from "@/chains";
import {
  SomethingWentWrongException,
  sanitizeUrl,
  unixTimestamp,
  withTrace,
} from "@/common";
import { Logger } from "@/core/logger";
import { type Processor, UnrecoverableError } from "@/core/queue";
import { type AccountValidationData, EntryPointService } from "@/entry-point";
import { DEFAULT_GLOBAL_EXPIRATION_TIME, StorageService } from "@/storage";
import { USEROP_SAFE_WINDOW_BEFORE_EXEC_END } from "@/user-ops/userop.config";
import { Service } from "typedi";
import { type SimulatorJob } from "./interfaces";
import { SimulatorService } from "./simulator.service";
import { trackSimulationTransactionData } from "./utils";

@Service()
export class SimulatorProcessor implements Processor<SimulatorJob> {
  constructor(
    private readonly logger: Logger,
    private readonly chainsService: ChainsService,
    private readonly entryPointService: EntryPointService,
    private readonly simulatorService: SimulatorService,
    private readonly storageService: StorageService,
  ) {
    logger.setCaller(SimulatorProcessor);
  }

  async simulateValidation(job: SimulatorJob) {
    const { data: simulatorJobData } = job;
    const { meeUserOp, forceExecute } = simulatorJobData;
    const { meeUserOpHash, userOpHash } = meeUserOp;
    const { chainId } = this.chainsService;

    // Custom user defined retry delay for long standing transactions if specified
    const retryDelay = meeUserOp.executionSimulationRetryDelay || 250; // 250 milliseconds

    // Updating userOp in background to improve latency
    this.storageService.createUserOpCustomField(
      meeUserOpHash,
      "simulationStartedAt",
      Date.now(),
      // 15 days expiration
      { ttl: DEFAULT_GLOBAL_EXPIRATION_TIME },
    );

    let accountValidationData: AccountValidationData;

    try {
      accountValidationData =
        await this.entryPointService.simulateSimulateHandleOp(meeUserOp, {
          retries: 0,
          useStorage: false,
        });
    } catch (err) {
      if (err instanceof SomethingWentWrongException) {
        if (err?.message?.includes("AA20")) {
          this.logger.trace(
            {
              meeUserOpHash,
              userOpHash,
              chainId,
            },
            "Account not deployed yet, adding to the queue",
          );

          // account not deployed, wait for account deployment to be successful.
          // This is a special failure which is retried unlimited times as needed
          await this.simulatorService.addJob(
            chainId,
            { meeUserOp, forceExecute, isRetryJob: true },
            {
              delay: retryDelay,
            },
          );

          // don't retry, direct failure
          throw new UnrecoverableError();
        }

        if (err?.message?.includes("AA23")) {
          this.logger.trace(
            {
              meeUserOpHash,
              userOpHash,
              chainId,
            },
            "Reverted with AA23 (OOG: Out of gas), adding to the queue",
          );

          // Reverted with AA23 (OOG: Out of gas
          // This is a special failure which is retried unlimited times as needed
          await this.simulatorService.addJob(
            chainId,
            { meeUserOp, forceExecute, isRetryJob: true },
            {
              delay: retryDelay,
            },
          );

          // don't retry, direct failure
          throw new UnrecoverableError();
        }
      }

      this.logger.error(
        {
          meeUserOpHash,
          userOpHash,
          chainId,
          error: err,
        },
        "UserOp simulation validation failed",
      );

      // Updating userOp in background to improve latency
      this.storageService.createUserOpCustomField(
        meeUserOpHash,
        "error",
        sanitizeUrl(
          (err as Error).message || "UserOp simulation validation failed",
        ),
        // 15 days expiration
        { ttl: DEFAULT_GLOBAL_EXPIRATION_TIME },
      );

      // Tracking in background to improve latency
      trackSimulationTransactionData(meeUserOp);

      // don't retry, direct failure
      throw new UnrecoverableError();
    }

    const { sigFailed, validAfter, validUntil } = accountValidationData;

    const now = unixTimestamp();

    if (sigFailed) {
      this.logger.error(
        {
          meeUserOpHash,
          userOpHash,
          chainId,
        },
        "Invalid signature",
      );

      // Updating userOp in background to improve latency
      this.storageService.createUserOpCustomField(
        meeUserOpHash,
        "error",
        "Invalid signature",
        // 15 days expiration
        { ttl: DEFAULT_GLOBAL_EXPIRATION_TIME },
      );

      // Tracking in background to improve latency
      trackSimulationTransactionData(meeUserOp);

      // don't retry, direct failure
      throw new UnrecoverableError();
    }

    if (now < validAfter) {
      const delay = (validAfter - now) * 1000;

      this.logger.trace(
        {
          meeUserOpHash,
          userOpHash,
          chainId,
          delay,
        },
        "The userOp is expected to be executed in future. Scheduling new job",
      );

      // This job will be scheduled for future execution
      await this.simulatorService.addJob(
        chainId,
        { meeUserOp, forceExecute, isRetryJob: true },
        {
          delay,
        },
      );

      // don't retry, direct failure
      throw new UnrecoverableError();
    }

    if (now > validUntil && validUntil !== 0) {
      this.logger.error(
        {
          meeUserOpHash,
          userOpHash,
          chainId,
          now,
          validUntil,
        },
        "Execution deadline limit exceeded",
      );

      // Updating userOp in background to improve latency
      this.storageService.createUserOpCustomField(
        meeUserOpHash,
        "error",
        "Execution deadline limit exceeded",
        // 15 days expiration
        { ttl: DEFAULT_GLOBAL_EXPIRATION_TIME },
      );

      // Tracking in background to improve latency
      trackSimulationTransactionData(meeUserOp);

      // don't retry, direct failure
      throw new UnrecoverableError();
    }
  }

  async processJob(job: SimulatorJob) {
    const { data: simulatorJobData, attemptsMade: simulationAttempts } = job;
    const { meeUserOp, forceExecute, isRetryJob } = simulatorJobData;
    const { meeUserOpHash, userOpHash } = meeUserOp;
    const { chainId } = this.chainsService;

    return await withTrace(
      "simulationPhase",
      async () => {
        this.logger.trace(
          {
            meeUserOpHash,
            userOpHash,
            chainId,
          },
          "Simulation started",
        );

        let execSimulationResult: {
          isError: boolean;
          errorMessage: string;
        } | null = null;

        // Simulation validation will be attempted only once. Execution validation will be tried until the userOp timestamps expires
        if (simulationAttempts === 0 && !isRetryJob) {
          // During the first attempt, both ethCall and debugTraceCall simulations happens concurrently to save some latency here
          // Further attempts, this block of code will be skipped and debugTraceCall will happen individually down the line
          const [hasQuote, , execSimulationResultInfo] = await Promise.all([
            withTrace(
              "simulatorPhase.hasQuote",
              async () => await this.storageService.hasUserOp(meeUserOpHash),
              {
                chainId,
                meeUserOpHash,
              },
            )(),
            this.simulateValidation(job),
            this.entryPointService.simulateHandleOps(meeUserOp, {
              retries: 0,
              useStorage: true,
            }),
          ]);

          if (!hasQuote) {
            this.logger.error(
              {
                meeUserOpHash,
                userOpHash,
                chainId,
              },
              "Failed to fetch meeUserOp quote information. Unknown meeUserOp, simulation validation is skipped",
            );

            // Direct failure without retries
            // This should never happen. If it happens, there is something wrong in exec API storage mechanism
            throw new UnrecoverableError();
          }

          execSimulationResult = execSimulationResultInfo;
        }

        const now = unixTimestamp();

        // If cleanUp userOp is requested for a specific chain, the force execute will be enforced for nonce increment.
        // But the forceExecute can be skipped for cleanUp userOps which is not dependent on nonce increments.
        // Force execution can result in success or failure. It will be handled by entrypoint
        if (forceExecute && !meeUserOp.isCleanUpUserOp) {
          if (
            meeUserOp.upperBoundTimestamp - now <=
            USEROP_SAFE_WINDOW_BEFORE_EXEC_END
          ) {
            this.logger.trace(
              {
                meeUserOpHash,
                userOpHash,
                chainId,
              },
              "Simulation validation deadline almost reached. Forcing userOp for execution",
            );

            // This will mark the job as completed and will be picked up for execution even there is a possibility of failure in entry point
            // Marking the job with returnValue as false incase if we need to differentiate the successful vs unknown simulation result
            return false;
          }
        } else {
          if (now > meeUserOp.upperBoundTimestamp) {
            this.logger.error(
              {
                meeUserOpHash,
                userOpHash,
                chainId,
                now,
                validUntil: meeUserOp.upperBoundTimestamp,
              },
              "Execution deadline limit exceeded during execution simulation",
            );

            // Updating userOp in background to improve latency
            this.storageService.createUserOpCustomField(
              meeUserOpHash,
              "error",
              "Execution deadline limit exceeded",
              // 15 days expiration
              { ttl: DEFAULT_GLOBAL_EXPIRATION_TIME },
            );

            // Tracking in background to improve latency
            trackSimulationTransactionData(meeUserOp);

            // don't retry, direct failure
            throw new UnrecoverableError();
          }
        }

        // If the execution simulation (debugTraceCall) is null, the simulation doesn't happen and we need to simulate here
        if (execSimulationResult === null) {
          execSimulationResult = await this.entryPointService.simulateHandleOps(
            meeUserOp,
            {
              retries: 0,
              useStorage: true,
            },
          );
        }

        if (execSimulationResult.isError) {
          const {
            chainSettings: {
              simulator: { traceCallRetryDelay },
            },
          } = this.chainsService;

          this.logger.trace(
            {
              meeUserOpHash,
              userOpHash,
              chainId,
              error: execSimulationResult.errorMessage,
            },
            "Simulation execution failed, adding to the queue",
          );

          // This is a special revert. Execution simulation will happen until the execution is time expired/out of range
          await this.simulatorService.addJob(
            chainId,
            { meeUserOp, forceExecute, isRetryJob: true },
            {
              // Custom user defined retry delay for long standing transactions if specified
              delay:
                meeUserOp.executionSimulationRetryDelay || traceCallRetryDelay,
            },
          );

          // don't retry, direct failure
          throw new UnrecoverableError();
        }

        // Updating userOp in background to improve latency
        this.storageService.updateUserOpCustomFields(
          meeUserOpHash,
          {
            simulationAttempts,
            simulationFinishedAt: Date.now(),
          }, // 15 days expiration
          { ttl: DEFAULT_GLOBAL_EXPIRATION_TIME },
        );

        this.logger.trace(
          {
            meeUserOpHash,
            userOpHash,
            chainId,
            simulationAttempts,
          },
          "Simulation finished",
        );

        return true;
      },
      {
        chainId,
        userOpHash,
        meeUserOpHash,
      },
    )();
  }
}
