import { ChainSettings, ChainsService } from "@/chains";
import { BadRequestException, withTrace } from "@/common";
import { ContractsService } from "@/contracts";
import { Logger } from "@/core/logger";
import { EncoderAndDecoderService } from "@/encoder-and-decoder";
import { GasManagerService } from "@/gas-manager";
import { NodeService } from "@/node";
import type { QuoteType } from "@/quotes";
import { RpcManagerService } from "@/rpc-manager";
import { type GrantPermissionResponse } from "@biconomy/abstractjs/dist/_types/modules/validators/smartSessions/decorators/grantPermission";
import { Inject, Service } from "typedi";
import type { Address, Hex } from "viem";
import { publicActionsL2 } from "viem/op-stack";
import {
  APPROXIMATE_SMART_SESSION_BATCH_CALLDATA_DECODING_GAS_LIMIT,
  APPROXIMATE_SMART_SESSION_SINGLE_CALLDATA_DECODING_GAS_LIMIT,
  ARBITRUM_ORACLE_ADDRESS,
  FIXED_SMART_SESSIONS_COLD_GET_POLICY_GAS_LIMIT,
  FIXED_SMART_SESSIONS_POLICY_COLD_ACCESS_GAS_ESTIMATION_LOOKUP_TABLE,
  FIXED_SMART_SESSIONS_POLICY_WARM_ACCESS_GAS_ESTIMATION_LOOKUP_TABLE,
  FIXED_SMART_SESSIONS_USE_MODE_GAS_LIMIT,
  FIXED_SMART_SESSIONS_WARM_GET_POLICY_GAS_LIMIT,
  FIXED_SMART_SESSION_CHECK_ACTION_GAS_LIMIT,
  FIXED_SMART_SESSION_COLD_CHECK_ACTION_POLICY_GAS_LIMIT,
  FIXED_SMART_SESSION_WARM_CHECK_ACTION_POLICY_GAS_LIMIT,
} from "./constants";
import { GasConditions, GasEstimationLookupKey } from "./interfaces";

@Service()
export class GasEstimatorServiceV2 {
  constructor(
    private readonly logger: Logger,
    @Inject(() => ChainsService)
    private readonly chainsService: ChainsService,
    private readonly contractsService: ContractsService,
    private readonly nodeService: NodeService,
    private readonly rpcManagerService: RpcManagerService,
    private readonly encoderAndDecoderService: EncoderAndDecoderService,
    private readonly gasManagerService: GasManagerService,
  ) {}

  async getCurrentGasConditions(
    chainId: string,
    forceRefresh = false,
    fetchL1GasPrice = false,
  ): Promise<GasConditions> {
    const chainSettings = this.chainsService.getChainSettings(chainId);
    try {
      let conditions: GasConditions;

      if (!chainSettings.eip1559) {
        // Legacy chain - fetch gas price and use it for both fields
        const gasPrice = await withTrace(
          "gasEstimator.legacyGasPrice",
          async () =>
            await this.gasManagerService.getLatestGasPrice(
              chainId,
              forceRefresh,
            ),
          {
            chainId,
          },
        )();

        // Chain config may set a minimum (e.g. BSC); apply floor so RPC does not reject
        const minGas = chainSettings.minMaxFeePerGas
          ? BigInt(chainSettings.minMaxFeePerGas)
          : 0n;
        const effectiveGasPrice =
          minGas > 0n && gasPrice < minGas ? minGas : gasPrice;

        conditions = {
          maxFeePerGas: effectiveGasPrice,
          maxPriorityFeePerGas: effectiveGasPrice,
          l1GasPrice: 0n,
          baseFee: effectiveGasPrice,
        };
      } else {
        // EIP-1559 chain - use fee history for prediction
        const [feeHistory, rpcMaxPriorityFee] = await withTrace(
          "gasEstimator.eip1559GasPrice",
          async () =>
            await Promise.all([
              this.getFeeHistory(chainId, forceRefresh),
              // Fetch max priority fee using eth_maxPriorityFeePerGas RPC call
              this.getMaxPriorityFee(chainId, forceRefresh),
            ]),
          {
            chainId,
          },
        )();

        // Get the latest base fee (next block's base fee)
        const latestBaseFee =
          feeHistory.baseFeePerGas[feeHistory.baseFeePerGas.length - 1];

        // Calculate average priority fee
        const priorityFees = Array.isArray(feeHistory.reward)
          ? feeHistory.reward
              .filter(
                (reward) =>
                  Array.isArray(reward) && reward.length > 0 && reward[0] > 0n,
              )
              .map((reward) => reward[0])
          : [];

        // For rapid mode, fallback to 1 gwei in wei units if no priority fee data
        // orelse, fallback to 0 gwei
        let medianPriorityFee =
          chainSettings.gasPriceMode !== "standard" ? 1_000_000_000n : 0n;

        if (priorityFees.length > 0) {
          // Calculate median
          const sortedFees = [...priorityFees].sort((a, b) => {
            if (a < b) return -1;
            if (a > b) return 1;
            return 0;
          });

          const mid = Math.floor(sortedFees.length / 2);
          medianPriorityFee =
            sortedFees.length % 2 === 0
              ? (sortedFees[mid - 1] + sortedFees[mid]) / 2n
              : sortedFees[mid];
        }

        // Median is the primary priority fees for stable and reliable execution
        let maxPriorityFeePerGas = medianPriorityFee;

        if (chainSettings.gasPriceMode !== "standard") {
          // Check recent gas spikes
          if (rpcMaxPriorityFee > 0n && medianPriorityFee > 0n) {
            const rpcToMedianRatio =
              (rpcMaxPriorityFee * 100n) / medianPriorityFee;

            if (rpcToMedianRatio > 200n && rpcToMedianRatio < 500n) {
              // RPC is 2-5x higher → possible real gas spike
              // Use average of median and RPC (weighted toward median)
              maxPriorityFeePerGas =
                (medianPriorityFee * 2n + rpcMaxPriorityFee) / 3n;
            } else if (rpcToMedianRatio > 500n) {
              // RPC is >5x higher → likely outlier, ignore it
              maxPriorityFeePerGas = medianPriorityFee;
            } else if (rpcToMedianRatio < 50n) {
              // RPC is <50% of median → RPC might be stale/broken, ignore it
              maxPriorityFeePerGas = medianPriorityFee;
            } else {
              // RPC is within reasonable range (50%-200%) → use the higher value
              maxPriorityFeePerGas =
                rpcMaxPriorityFee > medianPriorityFee
                  ? rpcMaxPriorityFee
                  : medianPriorityFee;
            }
          }

          // Check recent congestion
          const recentBlocks = feeHistory.gasUsedRatio.slice(-3);
          const avgUtilization =
            recentBlocks.reduce((a, b) => a + b, 0) / recentBlocks.length;

          if (avgUtilization > 0.9) {
            maxPriorityFeePerGas = (maxPriorityFeePerGas * 15n) / 10n; // +50%
          } else if (avgUtilization > 0.7) {
            maxPriorityFeePerGas = (maxPriorityFeePerGas * 12n) / 10n; // +20%
          }
        }

        let multiplier = 1n;
        if (chainSettings.gasPriceMode === "fast") multiplier = 2n;
        if (chainSettings.gasPriceMode === "rapid") multiplier = 3n;

        // A bit non-standard calculation: base fee + max priority fee
        const maxFeePerGas = latestBaseFee * multiplier + maxPriorityFeePerGas;

        let l1GasPrice = 0n;
        if (chainSettings.l1ChainId && fetchL1GasPrice) {
          this.logger.trace(
            { l1ChainId: chainSettings.l1ChainId },
            "Getting L1 gas price",
          );

          const fetchedL1GasPrice = await this.getCurrentGasConditions(
            chainSettings.l1ChainId,
            false,
          );

          this.logger.trace({ fetchedL1GasPrice }, "L1 gas price");

          if (fetchedL1GasPrice) {
            l1GasPrice = fetchedL1GasPrice.baseFee;
          }
        }

        conditions = {
          maxFeePerGas,
          maxPriorityFeePerGas,
          l1GasPrice,
          baseFee: latestBaseFee,
        };
      }

      this.logger.trace(
        { conditions },
        `Current gas conditions on chain ${chainSettings.name}`,
      );

      return conditions;
    } catch (error) {
      this.logger.trace(
        { error },
        `Failed to get gas conditions on chain ${chainSettings.name}`,
      );
      throw new BadRequestException(`Failed to get gas conditions: ${error}`);
    }
  }

  async getL1Gas(
    chainSettings: ChainSettings,
    callData: Hex,
    l2BaseFee: bigint,
  ): Promise<{ l1GasUsedInTermsOfL2: bigint; l1Fee: bigint }> {
    try {
      const entryPointV7Address = this.contractsService.getContractAddress(
        "entryPointV7",
        chainSettings.chainId,
      );

      switch (chainSettings.type) {
        case "optimism": {
          this.logger.trace("Estimating L1 on Optimism gas");

          const l1Fee = await withTrace(
            "gasEstimator.optimismL1GasPrice",
            async () =>
              await this.rpcManagerService.executeRequest(
                chainSettings.chainId,
                (chainClient) => {
                  return chainClient.extend(publicActionsL2()).estimateL1Gas({
                    account: this.nodeService.getMasterAccount().address,
                    to: entryPointV7Address,
                    data: callData,
                  });
                },
              ),
            {
              chainId: chainSettings.chainId,
            },
          )();

          this.logger.trace(
            { l1Fee, l2BaseFee, chainId: chainSettings.chainId },
            "Got L1 fee",
          );

          if (l1Fee === 0n) {
            throw new BadRequestException(
              "Failed to estimate L1 fee. Received 0",
            );
          }

          return { l1GasUsedInTermsOfL2: l1Fee / l2BaseFee, l1Fee };
        }

        case "arbitrum": {
          this.logger.trace("Estimating L1 on Arbitrum gas");

          const arbitrumOracleContractAbi =
            this.contractsService.getContractAbi("arbitrumOracle");

          const simulation = await withTrace(
            "gasEstimator.arbitrumL1GasPrice",
            async () =>
              await this.rpcManagerService.executeRequest(
                chainSettings.chainId,
                (chainClient) => {
                  return chainClient.simulateContract({
                    abi: arbitrumOracleContractAbi,
                    address: ARBITRUM_ORACLE_ADDRESS,
                    functionName: "gasEstimateL1Component",
                    args: [entryPointV7Address, false, callData || "0x"],
                  });
                },
              ),
            { chainId: chainSettings.chainId },
          )();

          if (simulation?.result?.length <= 0) {
            throw new BadRequestException("Failed to estimate L1 gas");
          }

          const gasEstimateForL1 = simulation.result[0];
          const baseFee = simulation.result[1];
          const l1BaseFeeEstimate = simulation.result[2];

          this.logger.trace(
            { gasEstimateForL1, baseFee, l1BaseFeeEstimate },
            "Got L1 gas components on Arb based chain",
          );

          /**
           * Formula taken from here
           * https://github.com/OffchainLabs/arbitrum-tutorials/blob/master/packages/gas-estimation/scripts/exec.ts
           */
          const parentChainCost = gasEstimateForL1 * baseFee;
          const parentChainEstimatedPrice = l1BaseFeeEstimate * 16n;

          const parentChainSize =
            parentChainEstimatedPrice === 0n
              ? 0n
              : parentChainCost / parentChainEstimatedPrice;

          const l1Cost = parentChainEstimatedPrice * parentChainSize;
          const l1GasUsedInTermsOfL2 = l1Cost / baseFee;
          return { l1GasUsedInTermsOfL2, l1Fee: l1Cost };
        }
        default:
          return { l1GasUsedInTermsOfL2: 0n, l1Fee: 0n };
      }
    } catch (error) {
      this.logger.trace(
        { error },
        `Failed to estimate L1 gas on ${chainSettings.name}`,
      );
      throw new BadRequestException(`Failed to estimate L1 gas: ${error}`);
    }
  }

  async getMaxPriorityFee(
    chainId: string,
    forceRefresh = false,
  ): Promise<bigint> {
    // Fetch max priority fee using eth_maxPriorityFeePerGas RPC call
    let rpcMaxPriorityFee = 0n;

    try {
      rpcMaxPriorityFee = await withTrace(
        "gasEstimator.maxPriorityFeePerGas",
        async () =>
          await this.gasManagerService.getLatestMaxPriorityFee(
            chainId,
            forceRefresh,
          ),
        {
          chainId,
        },
      )();
    } catch (rpcError) {
      this.logger.warn({ rpcError }, "Failed to fetch maxPriorityFee");
      rpcMaxPriorityFee = 0n; // Fallback to 0 gwei
    }

    return rpcMaxPriorityFee;
  }

  async getFeeHistory(chainId: string, forceRefresh = false) {
    return await withTrace(
      "gasEstimator.getFeeHistory",
      async () =>
        await this.gasManagerService.getLatestFeeHistory(chainId, forceRefresh),
      { chainId },
    )();
  }

  getGasEstimationLookupKey(options: {
    quoteType: QuoteType;
    isPermitRequired?: boolean;
    isRedeemDelegationRequired?: boolean;
    isSafeExecutionRequired?: boolean;
  }): GasEstimationLookupKey {
    const {
      quoteType,
      isPermitRequired,
      isRedeemDelegationRequired,
      isSafeExecutionRequired,
    } = options;

    const permitKey: "active" | "unactive" = isPermitRequired
      ? "active"
      : "unactive";

    const delegationKey: "delegation" | "non-delegation" =
      isRedeemDelegationRequired ? "delegation" : "non-delegation";

    const safeExecutionKey: "safe-execution" | "non-safe-execution" =
      isSafeExecutionRequired ? "safe-execution" : "non-safe-execution";

    switch (quoteType) {
      case "simple":
        return `${quoteType}-mode`;
      case "permit":
        return `${permitKey}-${quoteType}-mode`;
      case "onchain":
        return `${quoteType}-mode`;
      case "mm-dtk":
        return `${delegationKey}-${quoteType}-mode`;
      case "safe-sa":
        return `${safeExecutionKey}-${quoteType}-mode`;
      default:
        throw new BadRequestException("Failed to estimate gas");
    }
  }

  // Gas estimation algorithm to calculate the vgl for Smart sessions use mode
  getSmartSessionUseModeVerificationGasLimit(
    userOpCalldata: Hex,
    sessionDetails: GrantPermissionResponse,
  ) {
    try {
      // This fixed gas limit will be always there no matter different execution mode or number of actions or number of action policies
      let verificationGasLimit = FIXED_SMART_SESSIONS_USE_MODE_GAS_LIMIT;

      let decodedCalldataArray: {
        target: Address;
        value: bigint;
        calldata: Hex;
      }[] = [];

      try {
        decodedCalldataArray =
          this.encoderAndDecoderService.decodeERC7579Calldata(userOpCalldata);
      } catch {
        throw new BadRequestException(
          "Failed to decode userop calldata to estimate gas for Smart Sessions use mode",
        );
      }

      if (decodedCalldataArray.length === 0) {
        throw new BadRequestException(
          "Failed to estimate gas for Smart Sessions use mode",
        );
      }

      const isBatch = decodedCalldataArray.length > 1;

      // Based on execution calldata (batch vs single), the approximate decoding calldata gas limit will be added
      verificationGasLimit += isBatch
        ? APPROXIMATE_SMART_SESSION_BATCH_CALLDATA_DECODING_GAS_LIMIT
        : APPROXIMATE_SMART_SESSION_SINGLE_CALLDATA_DECODING_GAS_LIMIT;

      const hasActionAlreadySeen = new Set<string>();

      for (const decodedCalldata of decodedCalldataArray) {
        // Contract address where permission was enabled via policy
        const actionTarget = decodedCalldata.target.toLowerCase();
        // Function selector where permission was enabled via policy
        const actionTargetSelector = decodedCalldata.calldata
          .slice(0, 10)
          .toLowerCase();

        // Fetch the action to calculate gas limits
        const [action] =
          sessionDetails.enableSessionData.enableSession.sessionToEnable.actions.filter(
            (action) => {
              return (
                action.actionTarget.toLowerCase() === actionTarget &&
                action.actionTargetSelector.toLowerCase() ===
                  actionTargetSelector
              );
            },
          );

        // If the action doesn't exists in sessionDetails, skip it. Reverts will be handled by simulation and no need to worry about this case here
        if (action) {
          const actionKey = `${actionTarget}::${actionTargetSelector}`;

          // Sometime the gas is being low drastically due to warm access. So we track this flag to toggle between cold vs warm storage access
          const isColdAccess = !hasActionAlreadySeen.has(actionKey);

          // Fixed gas limits added for check action flow
          verificationGasLimit += FIXED_SMART_SESSION_CHECK_ACTION_GAS_LIMIT;

          // Fixed gas limits added for check action policy flow
          verificationGasLimit += isColdAccess
            ? FIXED_SMART_SESSION_COLD_CHECK_ACTION_POLICY_GAS_LIMIT
            : FIXED_SMART_SESSION_WARM_CHECK_ACTION_POLICY_GAS_LIMIT;

          const actionPolicyLength = BigInt(action.actionPolicies.length);

          // Fixed get policy gas limit will be multiplied by number of policies per action
          verificationGasLimit +=
            (isColdAccess
              ? FIXED_SMART_SESSIONS_COLD_GET_POLICY_GAS_LIMIT
              : FIXED_SMART_SESSIONS_WARM_GET_POLICY_GAS_LIMIT) *
            actionPolicyLength;

          for (const { policy } of action.actionPolicies) {
            const policyGasLimit = isColdAccess
              ? FIXED_SMART_SESSIONS_POLICY_COLD_ACCESS_GAS_ESTIMATION_LOOKUP_TABLE[
                  policy.toLowerCase()
                ]
              : FIXED_SMART_SESSIONS_POLICY_WARM_ACCESS_GAS_ESTIMATION_LOOKUP_TABLE[
                  policy.toLowerCase()
                ];

            // If there is no policy match ? default 20k gas will be used and this is approximate safe value
            // This is to handle unknown policies being used in the smart sessions flow if any
            const defaultPolicyGasLimit = isColdAccess ? 20_000n : 10_000n;

            verificationGasLimit += policyGasLimit || defaultPolicyGasLimit;
          }

          // Mark the action as already seen to reduce gas limit which has warm storage access
          hasActionAlreadySeen.add(actionKey);
        }
      }

      return verificationGasLimit;
    } catch (error) {
      this.logger.error(
        { error },
        "Failed to estimate gas for Smart Sessions use mode",
      );
      throw new BadRequestException(
        "Failed to estimate gas for Smart Sessions use mode",
      );
    }
  }
}
