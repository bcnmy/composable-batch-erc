import { ChainsService } from "@/chains";
import {
  BadRequestException,
  SomethingWentWrongException,
  sanitizeUrl,
  unixTimestamp,
  withTrace,
} from "@/common";
import { ContractsService } from "@/contracts";
import { Logger } from "@/core/logger";
import { type Processor, UnrecoverableError } from "@/core/queue";
import { EntryPointService } from "@/entry-point";
import { GasConditions } from "@/gas-estimator";
import { GasEstimatorServiceV2 } from "@/gas-estimator/gas-estimator-v2.service";
import { NODE_ACCOUNT_TOKEN, type NodeAccount } from "@/node";
import { NonceManagerService } from "@/nonce-manager";
import { RpcManagerService } from "@/rpc-manager";
import { trackSimulationTransactionData } from "@/simulator/utils";
import { DEFAULT_GLOBAL_EXPIRATION_TIME, StorageService } from "@/storage";
import {
  type EIP7702Auth,
  type SignedPackedMeeUserOp,
  UserOpService,
} from "@/user-ops";
import { Inject, Service } from "typedi";
import {
  ContractFunctionExecutionError,
  ContractFunctionRevertedError,
  type Hash,
  type Hex,
  type TransactionReceipt,
  parseEventLogs,
  stringify,
  toHex,
} from "viem";
import {
  BLOCK_GAS_LIMIT_EXCEEDS_ERROR_MESSAGES,
  GAS_PRICE_ERROR_MESSAGES,
  MAX_FEE_ERROR_MESSAGES,
  NONCE_ERROR_MESSAGES,
  PRIORITY_FEE_ERROR_MESSAGES,
  REPLACEMENT_TRANSACTION_GAS_PRICE_ERROR_MESSAGES,
  TIME_OUT_ERROR_MESSAGES,
  TRANSACTION_EXECUTION_SYNC_ERROR_MESSAGES,
} from "./constants";
import { EXECUTOR_QUEUE_JOB_ATTEMPTS } from "./executor.config";
import { ExecutorService } from "./executor.service";
import {
  BumpGasAndNonceOptions,
  type ExecuteBlockResponse,
  ExecuteOptions,
  type ExecutorJob,
  type ExecutorTxRequest,
  USER_OP_ERROR_MESSAGES,
  USER_OP_EXECUTION_ERRORS,
} from "./interfaces";

@Service({
  transient: true,
})
export class ExecutorProcessor implements Processor<ExecutorJob> {
  constructor(
    private readonly logger: Logger,
    private readonly chainsService: ChainsService,
    private readonly contractsService: ContractsService,
    private readonly gasEstimatorService: GasEstimatorServiceV2,
    private readonly executorService: ExecutorService,
    private readonly storageService: StorageService,
    @Inject(NODE_ACCOUNT_TOKEN)
    private readonly nodeAccount: NodeAccount,
    private readonly userOpService: UserOpService,
    private readonly entryPointService: EntryPointService,
    private readonly rpcManagerService: RpcManagerService,
    private readonly nonceManagerService: NonceManagerService,
  ) {
    logger.setCaller(ExecutorProcessor);
  }

  async processJob(job: ExecutorJob) {
    const { name: batchHash, data, attemptsMade: executionAttempts } = job;
    let { meeUserOps, batchGasLimit, previousTxHash } = data;
    const { chainId } = this.chainsService;

    return await withTrace(
      "executionPhase",
      async () => {
        try {
          this.logger.trace(
            {
              chainId,
              batchHash,
              meeUserOpHashes: meeUserOps.map(
                (meeUserOp) => meeUserOp.meeUserOpHash,
              ),
              eoaWorkerAddress: this.nodeAccount.address,
              executionAttempts,
              previousTxHash,
            },
            "Executor job started",
          );

          if (previousTxHash) {
            // Previous txHash receipt will be fetched before attempting a fresh execution. So if the last execution tx receipt is delayed to sync ?
            // It will be fetched here and finalized before retrying the execution again
            try {
              const transactionReceipt = await withTrace(
                "executionPhase.defaultBlockTxReceiptForPreviousTxHash",
                async () => {
                  // Tx receipt is always fetched from primary RPC provider to make sure to avoid RPC node state sync issues in confirmations
                  const { client } =
                    this.rpcManagerService.getPrimaryRpcProvider(chainId);

                  if (!client)
                    throw new SomethingWentWrongException(
                      "Failed to fetch primary RPC provider public client",
                    );

                  return client.getTransactionReceipt({ hash: previousTxHash });
                },
                { chainId, batchHash },
              )();

              // This is non retriable scenario. As a result, the entire userOp list is simulated again
              // and faulty userOps will be removed and retried with a new job.
              if (transactionReceipt?.status === "reverted") {
                // The faulty userOps will be excluded and a new block will be created here.
                // Current job will be completed by returing false here.
                return await this.handleUserOpsRevertsFromBlock(
                  job,
                  meeUserOps,
                  chainId,
                  {
                    splitUserOpsIntoSeparateBlocks: false,
                    removePreviousTxHash: true,
                  },
                );
              }

              this.handlePostExecution(
                job.name,
                chainId,
                batchHash,
                meeUserOps,
                batchGasLimit,
                executionAttempts,
                previousTxHash,
                transactionReceipt,
              );

              // This will mark the job as completed and end the job here
              return true;
            } catch (error) {
              this.logger.trace(
                {
                  chainId,
                  batchHash,
                  meeUserOpHashes: meeUserOps.map(
                    (meeUserOp) => meeUserOp.meeUserOpHash,
                  ),
                  eoaWorkerAddress: this.nodeAccount.address,
                  previousTxHash,
                },
                "Failed to fetch tx receipt for previous txHash, block execution continues",
              );

              // Remove the previous tx hash from the job
              await job.updateData({
                meeUserOps,
                batchGasLimit,
                previousTxHash: undefined,
              });
            }
          }

          const authorizationList: EIP7702Auth[] = [];
          const authHashMap = new Map<Hex, boolean>();
          const meeUserOpHashes: Hash[] = [];

          const initialMeeUserOpsLength = meeUserOps.length;

          // Ignoreing the meeUserOp duplication check optimisitically to reduce latency here.
          // If incase the userOp duplication happens here ? Either they might be executed for the first time where there is no problem.
          // If it is being executed second time ? The entire block will be reverted and this duplicate userOp will be considered as faulty userOp
          // Faulty userOps will be removed from the block and remaining userOps will be executed again. So it is not a big deal to disable this now
          // IMPORTANT NOTE: the code is being commented and kept here to re-enable if something bad happens with any worst case scenarios

          // const userOpDuplicationFilterResult = await Promise.all(
          //   meeUserOps.map(async (meeUserOp) => {
          //     const { meeUserOpHash, maxGasLimit } = meeUserOp;

          //     // Check for duplicate userOp execution
          //     const isNonDuplicateMeeUserOp = await withTrace(
          //       "executorPhase.isNonDuplicateMeeUserOp",
          //       async () =>
          //         await this.storageService.setUserOpCustomField(
          //           meeUserOpHash,
          //           "batchHash",
          //           batchHash,
          //          // 15 days expiration
          //          { ttl: DEFAULT_GLOBAL_EXPIRATION_TIME },
          //         ),
          //       {
          //         chainId,
          //         meeUserOpHash,
          //       },
          //     )();

          //     if (isNonDuplicateMeeUserOp) {
          //       return { isDuplicate: false, meeUserOp, gasLimit: 0n };
          //     }

          //     this.logger.trace(
          //       {
          //         chainId,
          //         batchHash,
          //         eoaWorkerAddress: this.nodeAccount.address,
          //         meeUserOpHash,
          //       },
          //       "Duplicate userOp execution is identified. Removing the userop from block",
          //     );

          //     return {
          //       isDuplicate: true,
          //       meeUserOp: null,
          //       gasLimit: maxGasLimit,
          //     };
          //   }),
          // );

          // const nonDuplicateUserOps: SignedPackedMeeUserOp[] = [];
          // let gasLimitToReduce = 0n;

          // for (const {
          //   meeUserOp,
          //   gasLimit,
          //   isDuplicate,
          // } of userOpDuplicationFilterResult) {
          //   if (isDuplicate) {
          //     gasLimitToReduce += gasLimit;
          //   } else if (meeUserOp) {
          //     nonDuplicateUserOps.push(meeUserOp);
          //   }
          // }

          // // initialMeeUserOpsLength !== nonDuplicateUserOps.length => true ? It means there are duplicate userOps and it will be removed
          // if (initialMeeUserOpsLength !== nonDuplicateUserOps.length) {
          //   meeUserOps = nonDuplicateUserOps;
          //   batchGasLimit -= gasLimitToReduce;
          // }

          // Validate the userOp execution window. If it is expired, the expired userOps will be marked as failed
          const { validMeeUserOps, expiredMeeUserOps } =
            this.validateMeeUserOpTimebounds(meeUserOps);

          const currentTime = Date.now();

          if (expiredMeeUserOps.length > 0) {
            // Optimistically marking the expired userOp as failed in background to improve latency
            Promise.all(
              expiredMeeUserOps.map((expiredMeeUserOp) => {
                return this.storageService.updateUserOpCustomFields(
                  expiredMeeUserOp.meeUserOpHash,
                  {
                    error: "Execution deadline limit exceeded",
                    executionStartedAt: currentTime,
                    executionFinishedAt: currentTime,
                  },
                  // 15 days expiration
                  { ttl: DEFAULT_GLOBAL_EXPIRATION_TIME },
                );
              }),
            ).catch((error) => {
              this.logger.error({
                chainId,
                batchHash,
                expiredMeeUserOpHashes: expiredMeeUserOps.map(
                  (meeUserOp) => meeUserOp.meeUserOpHash,
                ),
                eoaWorkerAddress: this.nodeAccount.address,
                executionAttempts,
                error,
              });
            });
          }

          // New block gas limit with validMeeUserOps
          const newBlockGasLimit = validMeeUserOps.reduce(
            (gasLimit, { maxGasLimit }) => gasLimit + maxGasLimit,
            0n,
          );

          // This is unexpired valid userOps and non duplicates
          meeUserOps = validMeeUserOps;
          batchGasLimit = newBlockGasLimit;

          // initialMeeUserOpsLength !== meeUserOps.length => true ? It means there are either duplicate or expired userOps and it will be removed
          if (initialMeeUserOpsLength !== meeUserOps.length) {
            await job.updateData({
              batchGasLimit,
              meeUserOps,
            });

            if (!meeUserOps.length) {
              this.logger.trace(
                {
                  chainId,
                  batchHash,
                  eoaWorkerAddress: this.nodeAccount.address,
                },
                "No userop remaining to execute. The entire block is full of duplicate userOps",
              );

              // Returning a value resolves the processor and block will be marked as executed by default
              return false;
            }
          }

          for (const { eip7702Auth, meeUserOpHash } of meeUserOps) {
            if (eip7702Auth) {
              const authHash = toHex(stringify(eip7702Auth));

              if (!authHashMap.has(authHash)) {
                authorizationList.push(eip7702Auth);
                authHashMap.set(authHash, true);
              }

              this.logger.trace(
                {
                  chainId,
                  batchHash,
                  eoaWorkerAddress: this.nodeAccount.address,
                  meeUserOpHash,
                  eip7702Auth,
                },
                "Adding EIP7702 authorization to transaction authorization list",
              );
            }

            // Update storage in background to reduce latency
            this.storageService.createUserOpCustomField(
              meeUserOpHash,
              "executionStartedAt",
              currentTime,
              // 15 days expiration
              { ttl: DEFAULT_GLOBAL_EXPIRATION_TIME },
            );

            meeUserOpHashes.push(meeUserOpHash);
          }

          this.logger.info(
            {
              chainId,
              batchHash,
              eoaWorkerAddress: this.nodeAccount.address,
              meeUserOpHashes,
              executionAttempts,
              retry: executionAttempts !== 0,
              immediateRetry: false,
            },
            `Started executing the userOp block from the job (${job.name})`,
          );

          const [feeData, nonce] = await Promise.all([
            withTrace(
              "executorPhase.getCurrentGasConditions",
              () => this.gasEstimatorService.getCurrentGasConditions(chainId),
              {
                chainId,
              },
            )(),
            withTrace(
              "executorPhase.getNonce",
              () =>
                this.nonceManagerService.getNonce(
                  this.nodeAccount.address,
                  chainId,
                ),
              {
                chainId,
                workerAddress: this.nodeAccount.address,
              },
            )(),
          ]);

          let executionOptions = {
            nonce,
            maxFeePerGas: feeData.maxFeePerGas,
            maxPriorityFeePerGas: feeData.maxPriorityFeePerGas,
          };

          let {
            txHash,
            transactionReceipt,
            isError,
            errorType,
            isRetriableError,
          } = await this.executeBlock(
            batchHash,
            meeUserOps,
            authorizationList,
            executionOptions,
          );

          if (isError === true && errorType !== undefined) {
            if (isRetriableError === false) {
              const isBlockGasLimitExceedsError =
                errorType ===
                USER_OP_EXECUTION_ERRORS.BLOCK_GAS_LIMIT_EXCEEDS_ERROR;

              // If the block gas limit is exceeded and also the block contains only one userOp ? It will be retired for several configured queue
              // retry cycles and fail
              if (isBlockGasLimitExceedsError && meeUserOps.length === 1) {
                // Throwing an error will trigger a queue retry
                throw new SomethingWentWrongException(
                  `Block reverted, failed to execute meeUserOps due to the error (${USER_OP_ERROR_MESSAGES[errorType]})`,
                );
              }

              // If the error is block gas limit exceeds ? The userOps in the block will be separated into individual blocks and retried as a fresh block.
              const splitUserOpsIntoSeparateBlocks =
                isBlockGasLimitExceedsError;

              // The faulty userOps will be excluded and a new block will be created here.
              // Current job will be completed by returing false here.
              return await this.handleUserOpsRevertsFromBlock(
                job,
                meeUserOps,
                chainId,
                { splitUserOpsIntoSeparateBlocks },
              );
            }

            // When the execution fails with txReceipt timeout, maybe the tx might be already executed and txReceipt is not synced
            // So we update the prevTxHash and ignore immediate retry where the retry happens via queue and txReceipt is fetched before retry.
            // if the tx itself not broadcasted and that's why txReceipt is not found ? Still the retry happens so no problem.
            if (
              errorType ===
                USER_OP_EXECUTION_ERRORS.TRANSACTION_RECEIPT_TIMEOUT_ERROR &&
              txHash
            ) {
              await Promise.all([
                // If there is a transaction receipt timeout error, it means the transaction is either dropped or pending in the mempool.
                // For nonce manager, there is a chance where futuristic nonce might be used for transaction and it will be always pending due to
                // nonce sequential dependency. eg: current nonce is 1 but we sent the tx with nonce 2
                // In this case the tx will be stuck without errors. If this worst case happens, it will usually endup as tx receipt timeout error
                // So to handle this future nonce case, we forcefully fetch the latest nonce from RPC which will automatically sync the local nonce in cache
                // for the RPC manager for this worker. To know more about this edge case, refer the nonce manager code description at the top
                this.nonceManagerService.getNonce(
                  this.nodeAccount.address,
                  chainId,
                  true, // force fetch nonce to refresh the cache and fetch latest proper nonce
                ),
                // Add the current tx hash into the job
                job.updateData({
                  meeUserOps,
                  batchGasLimit,
                  previousTxHash: txHash,
                }),
              ]);

              // If it is a retriable error, throwing an error will trigger a queue retry
              throw new SomethingWentWrongException(
                `Failed to fetch the transaction receipt, request timed out (${USER_OP_ERROR_MESSAGES[errorType]})`,
              );
            }

            // On retriable error, the gas and nonce will be bumped with one retry before executing the queue retries.
            const { maxFeePerGas, maxPriorityFeePerGas, nonce } =
              await this.adjustNonceAndGasByError(errorType, {
                percentage: BigInt(executionAttempts || 1) * 20n, // 20% increase in every retry. It will go upto 90% throughout the entire retries
                executeOptions: executionOptions,
              });

            executionOptions = {
              nonce: nonce || executionOptions.nonce,
              maxFeePerGas: maxFeePerGas || executionOptions.maxFeePerGas,
              maxPriorityFeePerGas:
                maxPriorityFeePerGas || executionOptions.maxPriorityFeePerGas,
            };

            this.logger.info(
              {
                chainId,
                batchHash,
                eoaWorkerAddress: this.nodeAccount.address,
                meeUserOpHashes,
                executionAttempts,
                retry: executionAttempts !== 0,
                immediateRetry: true,
              },
              `Started retrying the userOp block from the job (${job.name}) with more gas and fresh nonce`,
            );

            // Retry happens here with new gas and nonce based on revert reason
            const retryExecutionResult = await this.executeBlock(
              batchHash,
              meeUserOps,
              authorizationList,
              executionOptions,
            );

            if (
              retryExecutionResult.isError === true &&
              retryExecutionResult.errorType !== undefined
            ) {
              if (retryExecutionResult.isRetriableError === false) {
                const isBlockGasLimitExceedsError =
                  retryExecutionResult.errorType ===
                  USER_OP_EXECUTION_ERRORS.BLOCK_GAS_LIMIT_EXCEEDS_ERROR;

                // If the block gas limit is exceeded and also the block contains only one userOp ? It will be retired for several configured queue
                // retry cycles and fail
                if (isBlockGasLimitExceedsError && meeUserOps.length === 1) {
                  // Throwing an error will trigger a queue retry
                  throw new SomethingWentWrongException(
                    `Block reverted during retry, failed to execute meeUserOps due to the error (${USER_OP_ERROR_MESSAGES[retryExecutionResult.errorType]})`,
                  );
                }

                // If the error is block gas limit exceeds ? The userOps in the block will be separated into individual blocks and retried as a fresh block.
                const splitUserOpsIntoSeparateBlocks =
                  isBlockGasLimitExceedsError;

                // The faulty userOps will be excluded and a new block will be created here.
                // Current job will be completed by returing false here.
                return await this.handleUserOpsRevertsFromBlock(
                  job,
                  meeUserOps,
                  chainId,
                  { splitUserOpsIntoSeparateBlocks },
                );
              }

              // If it is a retriable error, throwing an error will trigger a queue retry
              throw new SomethingWentWrongException(
                `Block reverted during retry, failed to execute meeUserOps due to the error (${USER_OP_ERROR_MESSAGES[retryExecutionResult.errorType]})`,
              );
            }

            transactionReceipt = retryExecutionResult.transactionReceipt;
            txHash = retryExecutionResult.txHash;
          }

          this.handlePostExecution(
            job.name,
            chainId,
            batchHash,
            meeUserOps,
            batchGasLimit,
            executionAttempts,
            txHash,
            transactionReceipt,
          );

          // This will mark the job as completed and end the job here
          return true;
        } catch (error) {
          let errorMessage =
            USER_OP_ERROR_MESSAGES[USER_OP_EXECUTION_ERRORS.EXECUTION_FAILED];

          if (
            error instanceof UnrecoverableError ||
            error instanceof SomethingWentWrongException ||
            error instanceof BadRequestException ||
            error instanceof Error
          ) {
            errorMessage = error.message;
          }

          this.logger.error(
            {
              chainId,
              batchHash,
              meeUserOpHashes: meeUserOps.map(
                (meeUserOp) => meeUserOp.meeUserOpHash,
              ),
              eoaWorkerAddress: this.nodeAccount.address,
              executionAttempts,
              errorMessage,
            },
            "Executor job failed with error",
          );

          const isLastExecutionAttempt =
            executionAttempts === EXECUTOR_QUEUE_JOB_ATTEMPTS - 1 ||
            // If the error is unrecoverable ? no retries will be done. This will the final failure
            // So we have to add executionFinishedAt timestamp as well
            error instanceof UnrecoverableError;

          if (isLastExecutionAttempt) {
            for (const meeUserOp of meeUserOps) {
              const { meeUserOpHash } = meeUserOp;
              this.storageService.updateUserOpCustomFields(
                meeUserOpHash,
                {
                  error: sanitizeUrl(errorMessage),
                  executionFinishedAt: Date.now(),
                }, // 15 days expiration
                { ttl: DEFAULT_GLOBAL_EXPIRATION_TIME },
              );

              // Tracking in background to improve latency
              trackSimulationTransactionData(meeUserOp);
            }
          }

          // This error triggers the queue retry if it is not unrecoverable error
          throw error;
        }
      },
      {
        chainId,
        batchHash,
      },
    )();
  }

  handlePostExecution(
    jobName: string,
    chainId: string,
    batchHash: Hex,
    meeUserOps: SignedPackedMeeUserOp[],
    batchGasLimit: bigint,
    executionAttempts: number,
    txHash?: Hex,
    transactionReceipt?: TransactionReceipt,
  ) {
    const meeUserOpHashes = meeUserOps.map(
      (meeUserOp) => meeUserOp.meeUserOpHash,
    );

    // If txHash is not found, it is definitely RPC issue and nothing can be done from our end.
    // So the block is forcefully failed and all the userOps will be marked as failed.
    // This will never happen theoritically but if this happens, this warning can be used to debug further
    if (!txHash) {
      this.logger.error(
        {
          chainId,
          batchHash,
          eoaWorkerAddress: this.nodeAccount.address,
          batchGasLimit,
          meeUserOpHashes,
        },
        "txHash not found. Something is bad in the rpc or execution process",
      );

      throw new UnrecoverableError(
        "Block reverted, failed to execute meeUserOps due to unknown error",
      );
    }

    this.handleSupertransactionExecutionResult(
      batchHash,
      meeUserOps,
      txHash,
      transactionReceipt,
      true,
    );

    this.logger.info(
      {
        chainId,
        batchHash,
        eoaWorkerAddress: this.nodeAccount.address,
        batchGasLimit,
        meeUserOpHashes,
        retry: executionAttempts !== 0,
      },
      `Ended executing the userOp block from the job (${jobName})`,
    );

    this.logger.trace(
      {
        chainId,
        batchHash,
        meeUserOpHashes,
        eoaWorkerAddress: this.nodeAccount.address,
        executionAttempts,
      },
      "Executor job ended",
    );
  }

  async executeBlock(
    batchHash: Hash,
    meeUserOps: SignedPackedMeeUserOp[],
    authorizationList: EIP7702Auth[],
    options: ExecuteOptions,
  ): Promise<ExecuteBlockResponse> {
    const {
      chainId,
      chainSettings: { executionOverrides, isLowBlockTimeChain },
    } = this.chainsService;

    const fullChainSettings = this.chainsService.getChainSettings(chainId);

    const entryPointV7Abi =
      this.contractsService.getContractAbi("entryPointV7");

    const entryPointV7Address = this.contractsService.getContractAddress(
      "entryPointV7",
      chainId,
    );

    let maxFeePerGas = options.maxFeePerGas;
    let maxPriorityFeePerGas = options.maxPriorityFeePerGas;

    // Enforce chain minimum gas (e.g. BSC) at execution time so RPC does not reject the tx
    const minGas = fullChainSettings.minMaxFeePerGas
      ? BigInt(fullChainSettings.minMaxFeePerGas)
      : 0n;
    if (minGas > 0n) {
      if (maxFeePerGas < minGas) maxFeePerGas = minGas;
      if (maxPriorityFeePerGas < minGas) maxPriorityFeePerGas = minGas;
    }

    const feeData: GasConditions = {
      maxFeePerGas,
      maxPriorityFeePerGas,
      l1GasPrice: 0n,
      baseFee: 0n,
    };

    const nonce: number = options.nonce;

    let txRequest: ExecutorTxRequest;

    if (authorizationList.length === 0) {
      if (maxFeePerGas === maxPriorityFeePerGas) {
        txRequest = {
          type: "legacy",
          nonce,
          gasPrice: maxFeePerGas,
        };
      } else {
        txRequest = {
          type: "eip1559",
          nonce,
          maxFeePerGas,
          maxPriorityFeePerGas,
        };
      }
    } else {
      txRequest = {
        type: "eip7702",
        nonce,
        maxFeePerGas,
        maxPriorityFeePerGas,
        authorizationList,
      };
    }

    // This value is fetched only once during the node initialization for all the RPC providers and will be reused. So no extra RPC call here
    const sendTransactionSyncSupported =
      await this.rpcManagerService.executeRequest(chainId, (client) => {
        return client.transaction.sendTransactionSyncSupported;
      });

    if (isLowBlockTimeChain && sendTransactionSyncSupported) {
      try {
        // Tx receipt with just 1 block confirmation
        const instantTransactionReceipt = await withTrace(
          "executionPhase.executeBlockSync",
          async () =>
            await this.rpcManagerService.executeRequest(
              chainId,
              (chainClient) => {
                return chainClient
                  .connectAccount(this.nodeAccount)
                  .writeContractSync({
                    address: entryPointV7Address,
                    abi: entryPointV7Abi,
                    functionName: "handleOps",
                    args: [
                      meeUserOps.map(({ userOp }) => ({ ...userOp })),
                      this.nodeAccount.address,
                    ],
                    chain: chainClient.chain,
                    account: this.nodeAccount,
                    ...txRequest,
                    ...(executionOverrides.gas
                      ? { gas: executionOverrides.gas }
                      : {}),
                    // Half of the original timeout value
                    timeout:
                      this.chainsService.chainSettings
                        .waitConfirmationsTimeout / 2,
                  });
              },
            ),
          { chainId, batchHash },
        )();

        const txHash = instantTransactionReceipt.transactionHash;

        this.logger.trace(
          {
            chainId,
            batchHash,
            meeUserOpHashes: meeUserOps.map(
              (meeUserOp) => meeUserOp.meeUserOpHash,
            ),
            eoaWorkerAddress: this.nodeAccount.address,
            txHash,
            isLowBlockTimeChain,
            ...txRequest,
          },
          "Userop block execution sync txHash with txReceipt",
        );

        // If the instant transaction receipt is fetched. It guaruntees that the transaction has been mined irrespective of whether it is successful or reverted on chain.
        // So we mark the nonce as used and increase the current nonce to sync the cache in nonce manager to have a fresh nonce for next executions for this worker
        this.nonceManagerService.markNonceAsUsed(
          this.nodeAccount.address,
          chainId,
          nonce,
        );

        // This will skip the quick fast block status update
        if (instantTransactionReceipt.status === "reverted") {
          throw new SomethingWentWrongException(
            "Block reverted, failed to execute userOps",
          );
        }

        // Quick status update for faster block inclusion result but not reliable
        this.handleSupertransactionExecutionResult(
          batchHash,
          meeUserOps,
          txHash,
          instantTransactionReceipt,
          false,
        );

        const defaultBlockTxReceiptResult =
          await this.handleDefaultBlockTxReceipt(
            batchHash,
            meeUserOps,
            txHash,
            nonce,
          );

        if (
          defaultBlockTxReceiptResult.isError !== true &&
          defaultBlockTxReceiptResult.transactionReceipt
        ) {
          // This will end up as non retriable error. As a result, the entire userOp list is simulated again
          // and faulty userOps will be removed and retried with a new job.
          if (
            defaultBlockTxReceiptResult.transactionReceipt.status === "reverted"
          ) {
            throw new SomethingWentWrongException(
              "Block reverted, failed to execute userOps",
            );
          }

          return {
            transactionReceipt: defaultBlockTxReceiptResult.transactionReceipt,
            txHash: defaultBlockTxReceiptResult.txHash,
          };
        }

        return defaultBlockTxReceiptResult;
      } catch (error) {
        return this.handleTransactionExecutionError(
          batchHash,
          meeUserOps,
          error,
        );
      }
    }

    try {
      const txHash = await withTrace(
        "executionPhase.executeBlock",
        async () =>
          await this.rpcManagerService.executeRequest(
            chainId,
            (chainClient) => {
              return chainClient
                .connectAccount(this.nodeAccount)
                .writeContract({
                  address: entryPointV7Address,
                  abi: entryPointV7Abi,
                  functionName: "handleOps",
                  args: [
                    meeUserOps.map(({ userOp }) => ({ ...userOp })),
                    this.nodeAccount.address,
                  ],
                  chain: chainClient.chain,
                  account: this.nodeAccount,
                  ...txRequest,
                  ...(executionOverrides.gas
                    ? { gas: executionOverrides.gas }
                    : {}),
                });
            },
          ),
        { chainId, batchHash },
      )();

      this.logger.trace(
        {
          chainId,
          batchHash,
          meeUserOpHashes: meeUserOps.map(
            (meeUserOp) => meeUserOp.meeUserOpHash,
          ),
          eoaWorkerAddress: this.nodeAccount.address,
          txHash,
          ...txRequest,
        },
        "Userop block execution txHash",
      );

      // This is a soft block inclusion, so error handling is not considered here.
      // Errors and retries will be handled later in the code
      try {
        // By default one block confirmation is considered. For flashblock, we don't have to handle anything special. The RPC nodes will
        // show as 1 block confirmation if the tx is already available in flash block. But the tx can be reorged later in worst case
        const transactionReceipt = await withTrace(
          "executionPhase.fastBlockTxReceipt",
          async () => {
            // Fallback RPC providers are skipped here to avoid timeout retries on all fallbacks which is time consuming
            const { client } =
              this.rpcManagerService.getPrimaryRpcProvider(chainId);

            if (!client)
              throw new SomethingWentWrongException(
                "Failed to fetch primary RPC provider public client",
              );

            return client.waitForTransactionReceipt({
              hash: txHash,
              pollingInterval:
                this.chainsService.chainSettings.executor.pollInterval,
              // Never turn this true with 1 block confirmations. The replacement tx logic in viem can pick a wrong tx and malform the tx receipt
              checkReplacement: false,
              timeout:
                // Half of the original timeout interval for fast block mode.
                this.chainsService.chainSettings.waitConfirmationsTimeout / 2,
              retryCount: 1,
            });
          },
          { chainId, batchHash },
        )();

        // If the transaction receipt is fetched. It guaruntees that the transaction has been mined irrespective of whether it is successful or reverted on chain.
        // So we mark the nonce as used and increase the current nonce to sync the cache in nonce manager to have a fresh nonce for next executions for this worker
        this.nonceManagerService.markNonceAsUsed(
          this.nodeAccount.address,
          chainId,
          nonce,
        );

        // This will skip the quick fast block status update
        if (transactionReceipt.status === "reverted") {
          throw new SomethingWentWrongException(
            "Block reverted, failed to execute userOps",
          );
        }

        // Quick status update for faster block inclusion result but not reliable
        this.handleSupertransactionExecutionResult(
          batchHash,
          meeUserOps,
          txHash,
          transactionReceipt,
          false,
        );
      } catch (error) {
        const errorMessage =
          (error as Error)?.message ||
          "Failed to get the transaction receipt with 1 block confirmations";

        this.logger.error(
          {
            error: sanitizeUrl(errorMessage),
            chainId,
            batchHash,
            meeUserOpHashes: meeUserOps.map(
              (meeUserOp) => meeUserOp.meeUserOpHash,
            ),
            eoaWorkerAddress: this.nodeAccount.address,
            txHash,
          },
          "Failed to get tx receipt with 1 block confirmations ",
        );
      }

      const defaultBlockTxReceiptResult =
        await this.handleDefaultBlockTxReceipt(
          batchHash,
          meeUserOps,
          txHash,
          nonce,
        );

      if (
        defaultBlockTxReceiptResult.isError !== true &&
        defaultBlockTxReceiptResult.transactionReceipt
      ) {
        // This will end up as non retriable error. As a result, the entire userOp list is simulated again
        // and faulty userOps will be removed and retried with a new job.
        if (
          defaultBlockTxReceiptResult.transactionReceipt.status === "reverted"
        ) {
          throw new SomethingWentWrongException(
            "Block reverted, failed to execute userOps",
          );
        }

        return {
          transactionReceipt: defaultBlockTxReceiptResult.transactionReceipt,
          txHash: defaultBlockTxReceiptResult.txHash,
        };
      }

      return defaultBlockTxReceiptResult;
    } catch (error) {
      return this.handleTransactionExecutionError(batchHash, meeUserOps, error);
    }
  }

  handleTransactionExecutionError(
    batchHash: Hash,
    meeUserOps: SignedPackedMeeUserOp[],
    error: unknown,
  ): ExecuteBlockResponse {
    const {
      chainId,
      chainSettings: { isLowBlockTimeChain },
    } = this.chainsService;

    if (
      error instanceof Error ||
      error instanceof SomethingWentWrongException ||
      error instanceof BadRequestException ||
      error instanceof ContractFunctionExecutionError ||
      error instanceof ContractFunctionRevertedError
    ) {
      const err = error as Error;

      const { errorType, isRetriableError } = this.parseExecutionError(
        err.message,
      );

      this.logger.error(
        {
          chainId,
          batchHash,
          meeUserOpHashes: meeUserOps.map(
            (meeUserOp) => meeUserOp.meeUserOpHash,
          ),
          eoaWorkerAddress: this.nodeAccount.address,
          errorType: USER_OP_ERROR_MESSAGES[errorType],
          isRetriableError,
          errorMessage: error.message,
          isLowBlockTimeChain,
        },
        "Failed to execute userOps",
      );

      return { isError: true, errorType, isRetriableError };
    }

    this.logger.error(
      {
        chainId,
        batchHash,
        meeUserOpHashes: meeUserOps.map((meeUserOp) => meeUserOp.meeUserOpHash),
        eoaWorkerAddress: this.nodeAccount.address,
        errorType:
          USER_OP_ERROR_MESSAGES[USER_OP_EXECUTION_ERRORS.UNRECOGNIZED_ERROR],
        error: stringify(error),
        isRetriableError: false,
        isLowBlockTimeChain,
      },
      "Failed to execute userOps",
    );

    return {
      isError: true,
      errorType: USER_OP_EXECUTION_ERRORS.UNRECOGNIZED_ERROR,
      isRetriableError: false,
    };
  }

  async handleDefaultBlockTxReceipt(
    batchHash: Hash,
    meeUserOps: SignedPackedMeeUserOp[],
    txHash: Hex,
    nonce: number,
  ): Promise<ExecuteBlockResponse> {
    const {
      chainId,
      chainSettings: { isLowBlockTimeChain },
    } = this.chainsService;

    try {
      const transactionReceipt = await withTrace(
        "executionPhase.defaultBlockTxReceipt",
        async () => {
          // Fallback RPC providers are skipped here to avoid timeout retries on all fallbacks which is time consuming
          const { client } =
            this.rpcManagerService.getPrimaryRpcProvider(chainId);

          if (!client)
            throw new SomethingWentWrongException(
              "Failed to fetch primary RPC provider public client",
            );

          return client.waitForTransactionReceipt({
            hash: txHash,
            pollingInterval:
              this.chainsService.chainSettings.executor.pollInterval,
            confirmations: this.chainsService.chainSettings.waitConfirmations,
            timeout: this.chainsService.chainSettings.waitConfirmationsTimeout,
            retryCount: 3,
          });
        },
        { chainId, batchHash },
      )();

      // If the transaction receipt is fetched. It guaruntees that the transaction has been mined irrespective of whether it is successful or reverted on chain.
      // So we mark the nonce as used and increase the current nonce to sync the cache in nonce manager to have a fresh nonce for next executions for this worker
      this.nonceManagerService.markNonceAsUsed(
        this.nodeAccount.address,
        chainId,
        nonce,
      );

      return { transactionReceipt, txHash };
    } catch (error) {
      if (error instanceof Error) {
        const err = error as Error;

        const { errorType, isRetriableError } = this.parseExecutionError(
          err.message,
        );

        // if the error is because of timeout, the tx might not be mined yet. So we consider this as a retriable error.
        // so the block will be immediately retried.
        if (
          isRetriableError === true &&
          errorType ===
            USER_OP_EXECUTION_ERRORS.TRANSACTION_RECEIPT_TIMEOUT_ERROR
        ) {
          this.logger.error(
            {
              chainId,
              batchHash,
              meeUserOpHashes: meeUserOps.map(
                (meeUserOp) => meeUserOp.meeUserOpHash,
              ),
              eoaWorkerAddress: this.nodeAccount.address,
              errorType: USER_OP_ERROR_MESSAGES[errorType],
              isRetriableError,
              errorMessage: err.message,
              isLowBlockTimeChain,
            },
            "Failed to fetch transaction receipt due to timeout error",
          );

          return { isError: true, errorType, isRetriableError, txHash };
        }

        this.logger.error(
          {
            chainId,
            batchHash,
            meeUserOpHashes: meeUserOps.map(
              (meeUserOp) => meeUserOp.meeUserOpHash,
            ),
            eoaWorkerAddress: this.nodeAccount.address,
            errorType: USER_OP_ERROR_MESSAGES[errorType],
            isRetriableError,
            errorMessage: err.message,
            isLowBlockTimeChain,
          },
          "Failed to fetch transaction receipt",
        );

        // If it is failed due to any other reasons like RPC issue ? It will be treated as mentioned below
        return { transactionReceipt: undefined, txHash };
      }

      this.logger.error(
        {
          chainId,
          batchHash,
          meeUserOpHashes: meeUserOps.map(
            (meeUserOp) => meeUserOp.meeUserOpHash,
          ),
          eoaWorkerAddress: this.nodeAccount.address,
          error: stringify(error),
          isLowBlockTimeChain,
        },
        "Failed to fetch transaction receipt",
      );

      // If transaction receipt failed to fetch due to RPC issues ? All the userOps are forcefully marked as successful.
      // There is no way to identify whether userOp is executed or not without checking tx receipt. So it is always
      // better to mark the tx as success than failure. Sending undefined will mark userOps as success down the line.
      return { transactionReceipt: undefined, txHash };
    }
  }

  handleSupertransactionExecutionResult(
    batchHash: Hash,
    meeUserOps: SignedPackedMeeUserOp[],
    txHash: Hash,
    transactionReceipt: TransactionReceipt | undefined,
    isConfirmed: boolean,
  ) {
    const { chainId } = this.chainsService;
    try {
      if (!transactionReceipt) {
        this.logger.error(
          {
            chainId,
            batchHash,
            eoaWorkerAddress: this.nodeAccount.address,
            meeUserOpHashes: meeUserOps.map(
              (meeUserOp) => meeUserOp.meeUserOpHash,
            ),
          },
          "Failed to fetch transaction receipt for the block",
        );

        // We mark all the userOps as executed. If the receipt is not found due to RPC issues. It doesn't mean that the
        // supertransaction is failed to execute. So we don't consider this as error.
        for (const { meeUserOpHash } of meeUserOps) {
          // Update storage in background to improve latency
          // TODO: Add redis transaction later
          this.storageService.updateUserOpCustomFields(
            meeUserOpHash,
            {
              txHash,
              isConfirmed,
              confirmations: isConfirmed
                ? BigInt(this.chainsService.chainSettings.waitConfirmations)
                : 1n,
              executionFinishedAt: Date.now(),
            }, // 15 days expiration
            { ttl: DEFAULT_GLOBAL_EXPIRATION_TIME },
          );
        }
      } else {
        const events = parseEventLogs({
          abi: this.contractsService.getContractAbi("entryPointV7"),
          logs: transactionReceipt.logs,
        });

        const meeUserOpProcessedStateMap = new Map<Hex, boolean>();

        // TODO: Add redis transaction later
        for (const { eventName, args } of events) {
          switch (eventName) {
            case "UserOperationEvent": {
              const { userOpHash, success, actualGasCost } = args;

              const [meeUserOp] = meeUserOps.filter((meeUserOp) => {
                return (
                  meeUserOp.userOpHash.toLowerCase() ===
                  userOpHash.toLowerCase()
                );
              });

              if (meeUserOp) {
                // Update storage in background to improve latency
                this.storageService.updateUserOpCustomFields(
                  meeUserOp.meeUserOpHash,
                  {
                    txHash,
                    executionFinishedAt: Date.now(),
                    // Note: The transaction execution cost is not accurately same as the fee shown in block explorer, there is a minor difference.
                    // TODO: If there are any ways to match these fee number, we should explore this in the future.
                    actualGasCost,
                    isConfirmed,
                    confirmations: isConfirmed
                      ? BigInt(
                          this.chainsService.chainSettings.waitConfirmations,
                        )
                      : 1n,
                    ...(success
                      ? {}
                      : {
                          error: "UserOperation reverted",
                        }),
                  },
                  // 15 days expiration
                  { ttl: DEFAULT_GLOBAL_EXPIRATION_TIME },
                );

                if (!success) {
                  // Tracking in background to improve latency
                  trackSimulationTransactionData(meeUserOp);
                }

                meeUserOpProcessedStateMap.set(meeUserOp.meeUserOpHash, true);
              } else {
                // This should never happen, if this happens ? It means there is something wrong
                // in the execution pipeline
                this.logger.error(
                  {
                    chainId,
                    batchHash,
                    eoaWorkerAddress: this.nodeAccount.address,
                    meeUserOpHashes: meeUserOps.map(
                      (meeUserOp) => meeUserOp.meeUserOpHash,
                    ),
                    userOpHash,
                  },
                  "userOpHash is not matching for any meeUserOps, this is unlikely to happen",
                );
              }
            }
          }
        }

        // Check if all the userOps are processed and updated in storage. If not, something bad happened,
        // so we mark them as failed to execute to avoid pending state in all the extreme worst case scenario's
        for (const { meeUserOpHash } of meeUserOps) {
          const isProcessed = meeUserOpProcessedStateMap.get(meeUserOpHash);

          if (!isProcessed) {
            // This should never happen, if this happens ? Something is wrong in execution pipeline
            this.logger.error(
              {
                chainId,
                batchHash,
                eoaWorkerAddress: this.nodeAccount.address,
                meeUserOpHash,
              },
              "meeUserOp might not be executed due to some issue. This is unlikely to happen",
            );

            // Update storage in background to improve latency
            this.storageService.updateUserOpCustomFields(
              meeUserOpHash,
              {
                txHash,
                isConfirmed,
                confirmations: isConfirmed
                  ? BigInt(this.chainsService.chainSettings.waitConfirmations)
                  : 1n,
                executionFinishedAt: Date.now(),
                error: "Failed to execute userOp",
              }, // 15 days expiration
              { ttl: DEFAULT_GLOBAL_EXPIRATION_TIME },
            );
          }
        }

        this.userOpService
          .getUserOpStateTransitions([{ chainId, receipt: transactionReceipt }])
          .then((userOpTranferStateTransitions) => {
            if (userOpTranferStateTransitions.length > 0) {
              for (const meeUserOp of meeUserOps) {
                const assetTransfers =
                  userOpTranferStateTransitions[0][meeUserOp.userOpHash];

                // Update storage in background to improve latency
                this.storageService.updateUserOpCustomFields(
                  meeUserOp.meeUserOpHash,
                  {
                    stateTransitions: {
                      assetTransfers,
                    },
                  },
                  // 15 days expiration
                  { ttl: DEFAULT_GLOBAL_EXPIRATION_TIME },
                );
              }
            }
          })
          .catch((error) => {
            this.logger.error("Failed to track userOp state transistions", {
              error,
            });
          });
      }
    } catch (error) {
      const errorMessage =
        (error as Error)?.message ||
        "Failed to confirm execution for the block";

      this.logger.error(
        {
          chainId,
          batchHash,
          eoaWorkerAddress: this.nodeAccount.address,
          meeUserOpHashes: meeUserOps.map(
            (meeUserOp) => meeUserOp.meeUserOpHash,
          ),
          errorMessage,
        },
        "Failed to confirm execution for the block",
      );
    }
  }

  parseExecutionError(errMessage = "") {
    const errorMessage = errMessage.toLowerCase();

    // FailedOp(uint256,string)
    const failedOpFunctionSignature = "0x220266b6";

    if (errorMessage.includes(failedOpFunctionSignature.toLowerCase())) {
      return {
        isRetriableError: false,
        errorType: USER_OP_EXECUTION_ERRORS.EXECUTION_FAILED,
      };
    }

    // Block gas limit exceeded errors will be handled here
    for (const configuredErrorMessage of BLOCK_GAS_LIMIT_EXCEEDS_ERROR_MESSAGES) {
      if (errorMessage.includes(configuredErrorMessage.toLowerCase())) {
        return {
          isRetriableError: false,
          errorType: USER_OP_EXECUTION_ERRORS.BLOCK_GAS_LIMIT_EXCEEDS_ERROR,
        };
      }
    }

    // Nonce too low errors will be handled here
    for (const configuredErrorMessage of NONCE_ERROR_MESSAGES) {
      if (errorMessage.includes(configuredErrorMessage.toLowerCase())) {
        return {
          isRetriableError: true,
          errorType: USER_OP_EXECUTION_ERRORS.NONCE_EXPIRED,
        };
      }
    }

    // IMPORTANT NOTE: order of GAS PRICE and REPLACEMENT GAS PRICE error should not change here because of the similar error messages
    // replacement transaction underpriced errors will be handled here
    for (const configuredErrorMessage of REPLACEMENT_TRANSACTION_GAS_PRICE_ERROR_MESSAGES) {
      if (errorMessage.includes(configuredErrorMessage.toLowerCase())) {
        return {
          isRetriableError: true,
          errorType:
            USER_OP_EXECUTION_ERRORS.REPLACEMENT_TRANSACTION_GAS_PRICE_TOO_LOW,
        };
      }
    }

    // Gas limit too low errors will be handled here
    for (const configuredErrorMessage of GAS_PRICE_ERROR_MESSAGES) {
      if (errorMessage.includes(configuredErrorMessage.toLowerCase())) {
        return {
          isRetriableError: true,
          errorType: USER_OP_EXECUTION_ERRORS.GAS_PRICE_TOO_LOW,
        };
      }
    }

    // Tx receipt timeout errors will be handled here
    for (const configuredErrorMessage of TIME_OUT_ERROR_MESSAGES) {
      if (errorMessage.includes(configuredErrorMessage.toLowerCase())) {
        return {
          isRetriableError: true,
          errorType: USER_OP_EXECUTION_ERRORS.TRANSACTION_RECEIPT_TIMEOUT_ERROR,
        };
      }
    }

    // Max fee too low errors will be handled here
    for (const configuredErrorMessage of MAX_FEE_ERROR_MESSAGES) {
      if (errorMessage.includes(configuredErrorMessage.toLowerCase())) {
        return {
          isRetriableError: true,
          errorType: USER_OP_EXECUTION_ERRORS.MAX_FEE_TOO_LOW,
        };
      }
    }

    // Priority fee too high errors will be handled here
    for (const configuredErrorMessage of PRIORITY_FEE_ERROR_MESSAGES) {
      if (errorMessage.includes(configuredErrorMessage.toLowerCase())) {
        return {
          isRetriableError: true,
          errorType: USER_OP_EXECUTION_ERRORS.PRIORITY_FEE_TOO_HIGH,
        };
      }
    }

    // Transaction execution sync errors will be handled here
    for (const configuredErrorMessage of TRANSACTION_EXECUTION_SYNC_ERROR_MESSAGES) {
      if (errorMessage.includes(configuredErrorMessage.toLowerCase())) {
        return {
          isRetriableError: true,
          errorType: USER_OP_EXECUTION_ERRORS.TRANSACTION_EXECUTION_SYNC_ERROR,
        };
      }
    }

    return {
      isRetriableError: false,
      errorType: USER_OP_EXECUTION_ERRORS.UNRECOGNIZED_ERROR,
    };
  }

  async adjustNonceAndGasByError(
    errorType: USER_OP_EXECUTION_ERRORS,
    options: BumpGasAndNonceOptions,
  ) {
    const { chainId } = this.chainsService;

    switch (errorType) {
      case USER_OP_EXECUTION_ERRORS.REPLACEMENT_TRANSACTION_GAS_PRICE_TOO_LOW:
      case USER_OP_EXECUTION_ERRORS.GAS_PRICE_TOO_LOW:
      case USER_OP_EXECUTION_ERRORS.MAX_FEE_TOO_LOW:
      case USER_OP_EXECUTION_ERRORS.PRIORITY_FEE_TOO_HIGH:
      case USER_OP_EXECUTION_ERRORS.NONCE_EXPIRED: {
        // If it is a nonce error, we ignore cache and forcefully fetch the new nonce from RPC call
        // This handles errors such as nonce already known, nonce too low and etc...
        const forceFetchNonce =
          errorType === USER_OP_EXECUTION_ERRORS.NONCE_EXPIRED;

        const nonce = await withTrace(
          "executorPhase.getNonceOnRetry",
          async () =>
            await this.nonceManagerService.getNonce(
              this.nodeAccount.address,
              chainId,
              forceFetchNonce,
            ),
          {
            chainId,
            workerAddress: this.nodeAccount.address,
            forceFetchNonce,
          },
        )();

        // If it is a gas related error, we ignore cache and forcefully fetch the new new gas info from RPC call
        const forceFetchGasConditions =
          errorType ===
          USER_OP_EXECUTION_ERRORS.REPLACEMENT_TRANSACTION_GAS_PRICE_TOO_LOW;
        errorType === USER_OP_EXECUTION_ERRORS.GAS_PRICE_TOO_LOW ||
          errorType === USER_OP_EXECUTION_ERRORS.PRIORITY_FEE_TOO_HIGH ||
          errorType === USER_OP_EXECUTION_ERRORS.MAX_FEE_TOO_LOW;

        const isAggressiveGasBumpRequired =
          errorType ===
          USER_OP_EXECUTION_ERRORS.REPLACEMENT_TRANSACTION_GAS_PRICE_TOO_LOW;

        const currentGasConditions = await withTrace(
          "executorPhase.getCurrentGasConditionsOnRetry",
          async () =>
            await this.gasEstimatorService.getCurrentGasConditions(
              chainId,
              forceFetchGasConditions,
            ),
          {
            chainId,
            forceFetchGasConditions,
          },
        )();

        // There are 3 retry attempts.
        // On each retry, gas increases by 20% so it can go up to 60%:
        //   - 1st attempt: +20%
        //   - 2nd attempt: +40%
        //   - 3rd attempt: +60%
        // For aggressive gas bump for transaction replacement
        // Bump is 50% + the normal bump:
        //   - 1st attempt: +130% (50% + 20% = 70%)
        //   - 2nd attempt: +160% (50% + 40% = 90%)
        //   - 3rd attempt: +190% (50% + 60% = 110%)
        const gasPriceBumpPercentage = isAggressiveGasBumpRequired
          ? 50n + options.percentage
          : options.percentage;

        return {
          maxFeePerGas:
            (currentGasConditions.maxFeePerGas *
              (100n + gasPriceBumpPercentage)) /
            100n,
          maxPriorityFeePerGas:
            (currentGasConditions.maxPriorityFeePerGas *
              (100n + gasPriceBumpPercentage)) /
            100n,
          nonce,
        };
      }

      default: {
        return options.executeOptions;
      }
    }
  }

  async handleUserOpsRevertsFromBlock(
    job: ExecutorJob,
    meeUserOps: SignedPackedMeeUserOp[],
    chainId: string,
    options: {
      splitUserOpsIntoSeparateBlocks: boolean;
      removePreviousTxHash?: boolean;
    },
  ) {
    const { splitUserOpsIntoSeparateBlocks } = options;

    const { validMeeUserOps, invalidMeeUserOps } =
      await this.simulateBlockExecution(meeUserOps);

    // If all the userOps are faulty ? New block will not be created
    if (validMeeUserOps.length > 0) {
      // UserOp duplication checks are disabled optimistically for latency improvements
      // // Remove the valid userOps from duplication record for the current block, so that it will be executed in a different block
      // await Promise.all(
      //   validMeeUserOps.map(({ meeUserOpHash }) =>
      //     this.storageService.unsetUserOpCustomField(
      //       meeUserOpHash,
      //       "batchHash",
      //     ),
      //   ),
      // );

      // If there is a block gas limit error, the userOps will be separated into individual blocks and it gets executed.
      if (splitUserOpsIntoSeparateBlocks) {
        await Promise.all(
          validMeeUserOps.map(async (validMeeUserOp) => {
            const newBlockGasLimit = validMeeUserOp.maxGasLimit;

            // This new userOp block will be executed by the next available EOA worker
            await this.executorService.addJobs(chainId, [
              { meeUserOps: [validMeeUserOp], batchGasLimit: newBlockGasLimit },
            ]);

            this.logger.info(
              {
                from: "worker",
                chainId,
                eoaWorkerAddress: this.nodeAccount.address,
                meeUserOpHashes: [validMeeUserOp.meeUserOpHash],
              },
              `Regenerated a block of 1 meeUserOp(s) for chain (${chainId}) with blockGasLimit (${newBlockGasLimit})`,
            );
          }),
        );
      } else {
        // First add the valid userOps into a new job before ending the current job with invalid userOps
        const newBlockGasLimit = validMeeUserOps.reduce(
          (gasLimit, { maxGasLimit }) => gasLimit + maxGasLimit,
          0n,
        );

        // This new userOp block will be executed by the next available EOA worker
        await this.executorService.addJobs(chainId, [
          { meeUserOps: validMeeUserOps, batchGasLimit: newBlockGasLimit },
        ]);

        this.logger.info(
          {
            from: "worker",
            chainId,
            eoaWorkerAddress: this.nodeAccount.address,
            meeUserOpHashes: validMeeUserOps.map(
              (meeUserOp) => meeUserOp.meeUserOpHash,
            ),
          },
          `Regenerated a block of ${validMeeUserOps.length} meeUserOp(s) for chain (${chainId}) with blockGasLimit (${newBlockGasLimit})`,
        );
      }
    }

    // Once the new execution block is created, faulty userOps are retained in the same job and the job is marked as executed with falsy value
    const failureBlockGasLimit = invalidMeeUserOps.reduce(
      (gasLimit, { maxGasLimit }) => gasLimit + maxGasLimit,
      0n,
    );

    await job.updateData({
      meeUserOps: invalidMeeUserOps,
      batchGasLimit: failureBlockGasLimit,
      ...(options.removePreviousTxHash ? { previousTxHash: undefined } : {}),
    });

    // Reverted userOps is marked as failure for explorer
    for (const { meeUserOpHash } of invalidMeeUserOps) {
      // Redis is updated in background to achieve minimal latency
      this.storageService.updateUserOpCustomFields(
        meeUserOpHash,
        {
          error: "UserOperation reverted",
          executionFinishedAt: Date.now(),
        }, // 15 days expiration
        { ttl: DEFAULT_GLOBAL_EXPIRATION_TIME },
      );
    }

    this.logger.trace(
      {
        chainId,
        eoaWorkerAddress: this.nodeAccount.address,
        meeUserOpHashes: invalidMeeUserOps.map(
          (meeUserOp) => meeUserOp.meeUserOpHash,
        ),
      },
      "Faulty userOps are marked as failed/reverted",
    );

    return false;
  }

  async simulateBlockExecution(meeUserOps: SignedPackedMeeUserOp[]) {
    const simulatedUserOps = await Promise.all(
      meeUserOps.map(async (meeUserOp) => {
        const { isError, errorMessage } =
          await this.entryPointService.simulateHandleOps(meeUserOp, {
            retries: 0,
            useStorage: true,
            workerAddress: this.nodeAccount.address,
          });

        return {
          isValidUserOp: !isError,
          gasLimit: meeUserOp.maxGasLimit,
          meeUserOp,
          errorMessage,
        };
      }),
    );

    const validMeeUserOps: SignedPackedMeeUserOp[] = [];
    const invalidMeeUserOps: SignedPackedMeeUserOp[] = [];

    for (const simulatedUserOp of simulatedUserOps) {
      const { meeUserOp, isValidUserOp, errorMessage } = simulatedUserOp;

      if (isValidUserOp) {
        validMeeUserOps.push(meeUserOp);
      } else {
        invalidMeeUserOps.push(meeUserOp);

        this.logger.trace(
          {
            eoaWorkerAddress: this.nodeAccount.address,
            meeUserOpHash: meeUserOp.meeUserOpHash,
            chainId: meeUserOp.chainId,
            errorMessage,
          },
          "Faulty userOp detected, it will be removed from the execution block",
        );
      }
    }

    return { validMeeUserOps, invalidMeeUserOps };
  }

  validateMeeUserOpTimebounds(meeUserOps: SignedPackedMeeUserOp[]) {
    const now = unixTimestamp();

    const validMeeUserOps: SignedPackedMeeUserOp[] = [];
    const expiredMeeUserOps: SignedPackedMeeUserOp[] = [];

    for (const meeUserOp of meeUserOps) {
      const isExpired = now > meeUserOp.upperBoundTimestamp;

      if (isExpired) {
        expiredMeeUserOps.push(meeUserOp);
      } else {
        validMeeUserOps.push(meeUserOp);
      }
    }

    return { validMeeUserOps, expiredMeeUserOps };
  }
}
