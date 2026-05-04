import { ChainsService } from "@/chains";
import { withTrace } from "@/common";
import { type ConfigType, InjectConfig } from "@/core/config";
import { Logger } from "@/core/logger";
import { ExecutorService } from "@/executor";
import { gasEstimatorConfig } from "@/gas-estimator/gas-estimator.config";
import { SimulatorService } from "@/simulator";
import { DEFAULT_GLOBAL_EXPIRATION_TIME, StorageService } from "@/storage";
import {
  type MeeUserOpBatch,
  getOverrideOrDefault,
  unpackPackedUserOp,
} from "@/user-ops";
import { Service } from "typedi";

@Service()
export class BatcherService {
  constructor(
    private readonly logger: Logger,
    private readonly chainsService: ChainsService,
    private readonly executorService: ExecutorService,
    private readonly simulatorService: SimulatorService,
    private readonly storageService: StorageService,
    @InjectConfig(gasEstimatorConfig)
    private readonly gasEstimatorConfiguration: ConfigType<
      typeof gasEstimatorConfig
    >,
  ) {
    logger.setCaller(BatcherService);
  }

  async initialize() {
    const supportedChains = await this.chainsService.getSupportedChains();
    const chainIds = supportedChains.map((chainInfo) => chainInfo.chainId);

    for (const chainId of chainIds) {
      const chainSettings = this.chainsService.getChainSettings(chainId);

      const {
        batcher: { batchGasLimit },
      } = chainSettings;

      await this.tryToBatchCompletedSimulations(chainId, batchGasLimit);

      let eventListenerLocked = false;

      const eventListener = () => {
        if (eventListenerLocked) {
          return;
        }

        eventListenerLocked = true;

        this.tryToBatchCompletedSimulations(chainId, batchGasLimit)
          .catch((err) => {
            this.logger.error(
              { err },
              `Failed to batch the userops block for execution on chain ${chainSettings.chainId}`,
            );
          })
          .finally(() => {
            eventListenerLocked = false;
          });
      };

      this.simulatorService.getEvents(chainId).on("completed", eventListener);
      this.executorService.getEvents(chainId).on("completed", eventListener);

      // This is mostly not necessary but added this to cover the extreme edge case where two userOps are ready for batching
      // and emitted completed event from simulator queue at the same time and if there is an already batched block which is still not
      // picked up for execution somehow. The batching will not happen until either new userOp is available or existing block is completed.
      // If there is no new userOp and existing block will take more time (eg: 6s for base sepolia), the sims completed userOps will be sitting idle even
      // though there are some EOA worker available for execution. To prevent this, this 75ms interval will trigger the batching in such scenarios
      setInterval(eventListener, 75); // 75 ms
    }
  }

  async tryToBatchCompletedSimulations(
    chainId: string,
    maxBatchGasLimitCap: bigint,
  ) {
    try {
      await withTrace(
        "batcher.userOpBatching",
        async () => {
          const { gasLimitOverrides } =
            this.chainsService.getChainSettings(chainId);

          const executorJobCount =
            await this.executorService.getJobCounts(chainId);

          // UserOp blocks are still waiting to be executed. So wait for new block creation which will result in
          // more userOps being batched. This is a smart batching feature
          if (executorJobCount.waiting) {
            return;
          }

          const simulatorCompleteJobs =
            await this.simulatorService.getCompletedJobs(chainId);

          // Simulated jobs will be fetched from completed simulator queue
          if (!simulatorCompleteJobs.length) {
            return;
          }

          const batches: MeeUserOpBatch[] = [];

          let batch: MeeUserOpBatch = {
            batchGasLimit: 0n,
            meeUserOps: [],
          };

          for (const { data: simulatedJobData } of simulatorCompleteJobs) {
            const { meeUserOp } = simulatedJobData;
            const { meeUserOpHash } = meeUserOp;
            const unpackedUserOp = unpackPackedUserOp(meeUserOp.userOp);

            const paymasterVerificationGasLimit = getOverrideOrDefault(
              "paymasterVerificationGasLimit",
              this.gasEstimatorConfiguration.paymasterVerificationGas,
              gasLimitOverrides,
            );

            const maxGasLimit = // add all limits except preVerificationGas (that one is not spent during execution)
              unpackedUserOp.verificationGasLimit +
              unpackedUserOp.callGasLimit +
              paymasterVerificationGasLimit +
              BigInt(this.gasEstimatorConfiguration.paymasterPostOpGas);

            // If a userOp's gas limit is more than batch gas limit cap. There is something wrong in
            // the gas limit itself. This userOp will be skipped from being executed
            if (maxGasLimit > maxBatchGasLimitCap) {
              this.logger.error(
                {
                  meeUserOpHash,
                  maxGasLimit,
                  maxBatchGasLimitCap,
                },
                "Invalid maxGasLimit is being used",
              );

              // Update error status in background to improve latency
              this.storageService.setUserOpCustomField(
                meeUserOpHash,
                "error",
                "Invalid maxGasLimit",
                // 15 days expiration
                { ttl: DEFAULT_GLOBAL_EXPIRATION_TIME },
              );

              continue;
            }

            // If a userOp doesn't fit into the block, the existing block will be finalized as full block
            // and the userOp will be assigned for a new batch
            if (batch.batchGasLimit + maxGasLimit > maxBatchGasLimitCap) {
              batches.push(batch);
              batch = { batchGasLimit: 0n, meeUserOps: [] };
            }

            batch.meeUserOps.push(meeUserOp);
            batch.batchGasLimit += maxGasLimit;
          }

          if (batch.meeUserOps.length > 0) {
            batches.push(batch);
          }

          for (const batch of batches) {
            this.logger.info(
              {
                from: "batcher",
                chainId,
                meeUserOpHashes: batch.meeUserOps.map(
                  (meeUserOp) => meeUserOp.meeUserOpHash,
                ),
              },
              `Generated a block of ${batch.meeUserOps.length} meeUserOp(s) for chain (${chainId}) with blockGasLimit (${batch.batchGasLimit})`,
            );
          }

          await this.executorService.addJobs(chainId, batches);

          await Promise.all(simulatorCompleteJobs.map((job) => job.remove()));
        },
        { chainId },
      )();
    } catch (error) {
      this.logger.error(error);
    }
  }
}
