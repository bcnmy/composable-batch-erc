import { randomBytes } from "node:crypto";
import {
  type ChainClientTraceTransactionCallType,
  type ChainIdLike,
  ChainsService,
} from "@/chains";
import { unixTimestamp, withTrace } from "@/common";
import { validateTimestamps } from "@/common/utils/timestamp";
import { ContractsService } from "@/contracts";
import { type ConfigType, InjectConfig } from "@/core/config";
import { Logger } from "@/core/logger";
import { EstimationGasLimits, GasConditions } from "@/gas-estimator";
import { GasEstimatorServiceV2 } from "@/gas-estimator/gas-estimator-v2.service";
import { gasEstimatorConfig } from "@/gas-estimator/gas-estimator.config";
import { NodeService } from "@/node";
import { PaymentInfo } from "@/payment";
import { PriceFeedsService } from "@/price-feeds";
import { NodePmMode, NodePmPremium } from "@/quotes/constants";
import { RpcManagerService } from "@/rpc-manager";
import { StorageService } from "@/storage";
import { Service } from "typedi";
import {
  type Hash,
  type Hex,
  type TransactionReceipt,
  concatHex,
  decodeEventLog,
  decodeFunctionData,
  encodeAbiParameters,
  encodeFunctionData,
  erc20Abi,
  formatUnits,
  getAddress,
  keccak256,
  zeroAddress,
} from "viem";
import {
  BEFORE_EXECUTION_EVENT_TOPIC,
  INNER_HANDLE_OP_ABI,
  INNER_HANDLE_OP_SELECTOR,
  POST_OP_SELECTIOR,
  TRANSFER_EVENT_ABI,
  TRANSFER_EVENT_TOPIC,
  USER_OPERATION_EVENT_ABI,
  USER_OPERATION_EVENT_TOPIC,
  WITHDRAWN_EVENT_ABI,
  WITHDRAWN_EVENT_TOPIC,
} from "./constants";
import {
  EIP7702Auth,
  ERC20TokenStateTransition,
  MeeUserOpRequest,
  NativeTokenStateTransition,
  PackedMeeUserOp,
  PackedUserOp,
  UserOp,
  type UserOpTranferStateTransition,
} from "./interfaces";
import { userOpConfig } from "./userop.config";
import { packUserOp } from "./utils";
import { getOverrideOrDefault } from "./utils/get-override-or-default";
import {
  getMeeUserOpHash,
  getMeeUserOpHashEip712,
} from "./utils/hash-mee-userop";
import { packPaymasterData } from "./utils/pack-paymaster-and-data";

@Service()
export class UserOpService {
  constructor(
    @InjectConfig(gasEstimatorConfig)
    private readonly gasEstimatorConfiguration: ConfigType<
      typeof gasEstimatorConfig
    >,
    @InjectConfig(userOpConfig)
    private readonly userOpConfiguration: ConfigType<typeof userOpConfig>,
    private readonly chainsService: ChainsService,
    private readonly logger: Logger,
    private readonly gasEstimatorService: GasEstimatorServiceV2,
    private readonly contractsService: ContractsService,
    private readonly priceFeedsService: PriceFeedsService,
    private readonly nodeService: NodeService,
    private readonly storageService: StorageService,
    private readonly rpcManagerService: RpcManagerService,
  ) {}

  getEntryPointV7UserOpHash(
    chainId: string,
    userOpHash: Hash,
    options?: { generateRandomHash?: boolean },
  ) {
    // For trusted sponsorship payment userOp, the userOp values are zero values and always returns a same userOp hash. To make sure a random value is
    // used to always make sure the userOp hash is unique irrespective of userOp value itself. This is a special case the userOp will not be executed at all
    if (options?.generateRandomHash) {
      return `0x${randomBytes(32).toString("hex")}` as Hex;
    }

    const entryPointV7 = this.chainsService.getChainContractAddress(
      chainId,
      "entryPointV7",
    );

    const encoded = encodeAbiParameters(
      [
        { type: "bytes32" }, //
        { type: "address" },
        { type: "uint256" },
      ],
      [
        userOpHash, //
        entryPointV7,
        BigInt(chainId),
      ],
    );

    return keccak256(encoded);
  }

  getPackedUserOpHash(packedUserOp: PackedUserOp) {
    const {
      sender,
      nonce,
      initCode,
      callData,
      preVerificationGas,
      accountGasLimits,
      gasFees,
      paymasterAndData,
    } = packedUserOp;

    const encoded = encodeAbiParameters(
      [
        { type: "address" },
        { type: "uint256" },
        { type: "bytes32" },
        { type: "bytes32" },
        { type: "bytes32" },
        { type: "uint256" },
        { type: "bytes32" },
        { type: "bytes32" },
      ],
      [
        sender,
        nonce,
        keccak256(initCode),
        keccak256(callData),
        accountGasLimits,
        preVerificationGas,
        gasFees,
        keccak256(paymasterAndData),
      ],
    );

    return keccak256(encoded);
  }

  getPaymasterAndData(
    paymentInfo: PaymentInfo,
    isTrustedSponsorship: boolean,
    chainId: ChainIdLike,
  ) {
    const { gasLimitOverrides } = this.chainsService.getChainSettings(chainId);

    const paymasterVerificationGasLimit = getOverrideOrDefault(
      "paymasterVerificationGasLimit",
      this.gasEstimatorConfiguration.paymasterVerificationGas,
      gasLimitOverrides,
    );

    const postOpGasLimit = BigInt(
      this.gasEstimatorConfiguration.paymasterPostOpGas,
    );

    let mode =
      paymentInfo.sponsored || paymentInfo.gasRefundAddress
        ? NodePmMode.DAPP
        : NodePmMode.USER;

    // If it is a trusted sponsorship ? there will be no refunds for any userOps
    if (isTrustedSponsorship) {
      mode = NodePmMode.KEEP;
    }

    const premiumMode = NodePmPremium.FIXED;
    const refundAddress = paymentInfo.sponsored
      ? paymentInfo.sender
      : (paymentInfo.gasRefundAddress ?? "0x");

    return packPaymasterData(
      this.chainsService.getChainPaymasterAddress(
        chainId,
        this.nodeService.address,
      ),
      paymasterVerificationGasLimit,
      postOpGasLimit,
      mode === NodePmMode.KEEP
        ? concatHex([mode])
        : concatHex([mode, premiumMode, refundAddress]),
    );
  }

  getDefaultUserOpGasLimits(
    userOpRequest: MeeUserOpRequest,
    initCode?: Hex,
    eip7702Auth?: EIP7702Auth,
  ) {
    const chainConfig = this.chainsService.getChainSettings(
      userOpRequest.chainId,
    );
    const { gasLimitOverrides } = chainConfig;

    this.logger.trace(
      {
        chainId: userOpRequest.chainId,
        gasLimitOverrides,
        hasInitCode: initCode !== "0x",
      },
      "Getting default userOp gas limits",
    );

    const senderCreateGasLimit =
      initCode !== "0x"
        ? getOverrideOrDefault(
            "senderCreateGasLimit",
            this.gasEstimatorConfiguration.senderCreateGasLimit,
            gasLimitOverrides,
          )
        : 0n;

    const baseVerificationGasLimit =
      userOpRequest.verificationGasLimit ||
      getOverrideOrDefault(
        "baseVerificationGasLimit",
        this.gasEstimatorConfiguration.baseVerificationGaslimit,
        gasLimitOverrides,
      );

    const verificationGasLimit =
      baseVerificationGasLimit + senderCreateGasLimit;

    const fixedHandleOpsGas = getOverrideOrDefault(
      "fixedHandleOpsGas",
      this.gasEstimatorConfiguration.fixedHandleOpsGas,
      gasLimitOverrides,
    );

    let preVerificationGas = fixedHandleOpsGas;

    if (eip7702Auth) {
      const perAuthBaseCost = getOverrideOrDefault(
        "perAuthBaseCost",
        this.gasEstimatorConfiguration.perAuthBaseCost,
        gasLimitOverrides,
      );

      preVerificationGas = preVerificationGas + perAuthBaseCost;
    }

    return { verificationGasLimit, preVerificationGas };
  }

  async getPackedMeeUserOpWithGasEstimates(
    userOpRequest: MeeUserOpRequest,
    paymentInfo: PaymentInfo,
    isTrustedSponsorship: boolean,
    simulationGasLimits?: EstimationGasLimits,
    isAccountDeploymentRequired = false,
    isPaymentUserOp = false,
    isEIP712SupportedMeeVersion = false,
    isSimpleMode = true,
    precalculatedL1Gas:
      | { l1GasUsedInTermsOfL2: bigint; l1Fee: bigint }
      | undefined = undefined,
    precalculatedGasConditions?: GasConditions,
  ) {
    const isTrustedPaymentUserOp = isPaymentUserOp && isTrustedSponsorship;

    const chainId = userOpRequest.chainId;
    const chainConfig = this.chainsService.getChainSettings(chainId);

    const entryPointV7Abi =
      this.contractsService.getContractAbi("entryPointV7");

    // 0. set & validate window of execution
    const lowerBoundTimestamp =
      userOpRequest.lowerBoundTimestamp ??
      (isPaymentUserOp ? 0 : unixTimestamp());

    const upperBoundTimestamp =
      userOpRequest.upperBoundTimestamp ??
      unixTimestamp(this.userOpConfiguration.userOpDefaultExecWindowDuration);

    if (!isPaymentUserOp)
      validateTimestamps(lowerBoundTimestamp, upperBoundTimestamp);

    this.logger.trace(
      { lowerBoundTimestamp, upperBoundTimestamp },
      "Defined timestamps for UserOp",
    );

    // 1. get maxFeePerGas and maxPriorityFeePerGas
    const feeData =
      precalculatedGasConditions ??
      (await this.gasEstimatorService.getCurrentGasConditions(
        chainId,
        false,
        true,
      ));

    const maxFeePerGas = isTrustedPaymentUserOp ? 0n : feeData.maxFeePerGas;
    const maxPriorityFeePerGas = isTrustedPaymentUserOp
      ? 0n
      : feeData.maxPriorityFeePerGas;

    this.logger.trace(
      { maxFeePerGas, maxPriorityFeePerGas },
      "Got maxFeePerGas and maxPriorityFeePerGas",
    );

    // 2. set gas limits
    const enableAccountDeployment =
      userOpRequest.initCode !== "0x" && isAccountDeploymentRequired;

    const initCode = enableAccountDeployment ? userOpRequest.initCode : "0x";

    const defaultUserOpGasLimits = this.getDefaultUserOpGasLimits(
      userOpRequest,
      initCode,
      userOpRequest.eip7702Auth,
    );

    const verificationGasLimit = isTrustedPaymentUserOp
      ? 0n
      : simulationGasLimits?.verificationGasLimit ||
        defaultUserOpGasLimits.verificationGasLimit;

    const callGasLimit = isTrustedPaymentUserOp
      ? 0n
      : simulationGasLimits?.callGasLimit || userOpRequest.callGasLimit;

    const paymasterVerificationGasLimit = isTrustedPaymentUserOp
      ? 0n
      : getOverrideOrDefault(
          "paymasterVerificationGasLimit",
          this.gasEstimatorConfiguration.paymasterVerificationGas,
          chainConfig.gasLimitOverrides,
        );

    const postOpGasLimit = isTrustedPaymentUserOp
      ? 0n
      : BigInt(this.gasEstimatorConfiguration.paymasterPostOpGas);

    this.logger.trace(
      {
        verificationGasLimit,
        callGasLimit,
        chainId,
      },
      "Got gas limits",
    );

    const paymasterAndData = isTrustedPaymentUserOp
      ? "0x"
      : this.getPaymasterAndData(paymentInfo, isTrustedSponsorship, chainId);

    this.logger.trace({ paymasterAndData }, "Got paymasterAndData");

    // 4. set preVerificationGas placeholder
    let preVerificationGas = isTrustedPaymentUserOp
      ? 0n
      : defaultUserOpGasLimits.preVerificationGas;

    // overhead for PER_EMPTY_ACCOUNT_COST + PER_AUTH_BASE_COST
    if (userOpRequest.eip7702Auth) {
      this.logger.trace(
        {
          preVerificationGas,
          authGasLimit: getOverrideOrDefault(
            "perAuthBaseCost",
            this.gasEstimatorConfiguration.perAuthBaseCost,
            chainConfig.gasLimitOverrides,
          ),
        },
        "Increased preVerificationGas because of EIP-7702 auth",
      );
    }

    // 5. set empty signature
    const dummySignature = `0xff${"0".repeat(130)}` as Hex;

    // 6. craft the UserOp with the initial data
    const unpackedUserOp: UserOp = {
      sender: userOpRequest.sender,
      nonce: userOpRequest.nonce,
      initCode,
      callData: userOpRequest.callData,
      callGasLimit,
      verificationGasLimit,
      preVerificationGas,
      maxFeePerGas,
      maxPriorityFeePerGas,
      paymasterAndData,
    };

    let packedUserOp = packUserOp(unpackedUserOp);

    let l1Gas = {
      l1GasUsedInTermsOfL2: 0n,
      l1Fee: 0n,
    };

    // L1 gas calculation will be skipped for trusted payment userOp
    if (!isTrustedPaymentUserOp) {
      const handleOpsCalldata = encodeFunctionData({
        abi: entryPointV7Abi,
        functionName: "handleOps",
        args: [
          [{ ...packedUserOp, signature: dummySignature }],
          this.nodeService.address,
        ],
      });

      l1Gas =
        precalculatedL1Gas ??
        (await this.gasEstimatorService.getL1Gas(
          chainConfig,
          handleOpsCalldata,
          feeData.baseFee,
        ));

      preVerificationGas = preVerificationGas + l1Gas.l1GasUsedInTermsOfL2;

      this.logger.trace(
        {
          preVerificationGas,
          l1GasUsedInTermsOfL2: l1Gas.l1GasUsedInTermsOfL2,
          l1Fee: l1Gas.l1Fee,
          l2BaseFee: feeData.baseFee,
          chainId,
          l1ChainId: chainConfig.l1ChainId,
        },
        "Increased preVerificationGas because of L1 gas limit",
      );

      packedUserOp = { ...packedUserOp, preVerificationGas };
    }

    const packedUserOpHash = this.getPackedUserOpHash(packedUserOp);
    const userOpHash = this.getEntryPointV7UserOpHash(
      chainId,
      packedUserOpHash,
      // If trusted payment userOp, generate a random userOpHash instead of relaying on userOp values
      { generateRandomHash: isTrustedPaymentUserOp },
    );

    this.logger.trace({ userOpHash }, "Got userOpHash");

    let meeUserOpHash: Hex;

    if (isEIP712SupportedMeeVersion && isSimpleMode) {
      // If the meeVersion >= 2.2.0, V2 meeUserOp hash will be generated for simple mode
      meeUserOpHash = getMeeUserOpHashEip712(
        userOpHash,
        lowerBoundTimestamp,
        upperBoundTimestamp,
      );
    } else {
      // If the meeVersion is less than 2.2.0, legacy meeUserOp hash will be generated
      meeUserOpHash = getMeeUserOpHash(
        userOpHash,
        lowerBoundTimestamp,
        upperBoundTimestamp,
      );
    }

    this.logger.trace({ meeUserOpHash }, "Got meeUserOpHash");

    const maxGasLimit =
      preVerificationGas +
      verificationGasLimit +
      callGasLimit +
      paymasterVerificationGasLimit +
      postOpGasLimit;

    const packedMeeUserOp: PackedMeeUserOp = {
      userOp: packedUserOp,
      userOpHash,
      meeUserOpHash,
      lowerBoundTimestamp,
      upperBoundTimestamp,
      executionSimulationRetryDelay:
        userOpRequest.executionSimulationRetryDelay,
      maxGasLimit,
      maxFeePerGas,
      chainId: userOpRequest.chainId,
      eip7702Auth: userOpRequest.eip7702Auth,
      isCleanUpUserOp: userOpRequest.isCleanUpUserOp,
      shortEncoding: userOpRequest.shortEncoding,
      metadata: userOpRequest.metadata,
    };

    return {
      packedMeeUserOp,
      gasConditions: feeData,
      l1Gas: {
        l1GasUsedInTermsOfL2: l1Gas.l1GasUsedInTermsOfL2,
        l1Fee: l1Gas.l1Fee,
      },
    };
  }

  async getUserOpCost(
    maxGasLimit: bigint,
    maxFeePerGas: bigint,
    chainId: string,
    l1Gas: { l1GasUsedInTermsOfL2: bigint; l1Fee: bigint },
  ): Promise<number> {
    const nativeToken = this.chainsService.getChainPaymentToken(
      chainId,
      zeroAddress,
    );

    const [paymentTokenPrice, paymentTokenDecimals] = await withTrace(
      "nativeToken.getTokenPriceAndDecimals",
      async () =>
        await Promise.all([
          this.priceFeedsService.getPaymentTokenPrice(nativeToken),
          this.priceFeedsService.getPaymentTokenDecimals(nativeToken),
        ]),
    )();

    this.logger.trace(
      { maxGasLimit, maxFeePerGas, chainId, l1Gas },
      "Calculating userOp cost",
    );

    const maxGasCost =
      maxFeePerGas * (maxGasLimit - l1Gas.l1GasUsedInTermsOfL2) + l1Gas.l1Fee;

    this.logger.trace(
      {
        maxGasCost: maxGasCost.toString(),
        maxGasLimit,
        l1GasUsedInTermsOfL2: l1Gas.l1GasUsedInTermsOfL2,
        l1Fee: l1Gas.l1Fee,
      },
      "Got maxGasCost",
    );

    const nativeCoinUsdPrice = paymentTokenPrice;

    this.logger.trace(
      { maxGasCost, nativeCoinUsdPrice },
      "Got maxGasCost and nativeCoinUsdPrice",
    );

    const decimals = paymentTokenDecimals;

    return Number(
      formatUnits(
        maxGasCost * nativeCoinUsdPrice,
        this.gasEstimatorConfiguration.nativeCoinDecimals + decimals,
      ),
    );
  }

  private async getUserOpTransfers(
    receiptLogs: TransactionReceipt["logs"],
    chainId: string,
  ): Promise<UserOpTranferStateTransition> {
    const userOpGroups: UserOpTranferStateTransition = {};

    let nativeTokenTransfers: NativeTokenStateTransition[] = [];
    let erc20TokenTransfers: ERC20TokenStateTransition[] = [];
    let startTrackingTransfers = false;

    for (const log of receiptLogs) {
      // When the userOp execution starts, track all the transfers from there
      if (log.topics?.[0] === BEFORE_EXECUTION_EVENT_TOPIC) {
        startTrackingTransfers = true;
      }

      // If the userOp execution haven't started, don't track any transfers
      if (!startTrackingTransfers) {
        continue;
      }

      // This is where a single userOp execution ends, so track the transfers and map it with userOpHash
      if (log.topics?.[0] === USER_OPERATION_EVENT_TOPIC) {
        try {
          const decoded = decodeEventLog({
            abi: [USER_OPERATION_EVENT_ABI],
            data: log.data,
            topics: log.topics,
          });

          const userOpHash = decoded.args.userOpHash;

          userOpGroups[userOpHash] = {
            nativeTokenTransfers,
            erc20TokenTransfers,
          };
          nativeTokenTransfers = [];
          erc20TokenTransfers = [];
        } catch (error) {
          this.logger.error("Failed to decode UserOperationEvent event log", {
            error,
            nativeTokenTransfers,
            erc20TokenTransfers,
          });

          // Even if there is an error, emtpy the transfer arrays
          nativeTokenTransfers = [];
          erc20TokenTransfers = [];
        }
      }

      // Check if this is a Transfer event and track ERC20 transfers
      if (log.topics?.[0] === TRANSFER_EVENT_TOPIC) {
        try {
          const decoded = decodeEventLog({
            abi: [TRANSFER_EVENT_ABI],
            data: log.data,
            topics: log.topics,
          });

          const tokenAddress = getAddress(log.address);

          const tokenInfoKey = `token-info::${tokenAddress.toLowerCase()}::${chainId}`;

          let tokenInfo = await this.storageService.getCache<{
            name: string;
            decimals: number;
            symbol: string;
          }>(tokenInfoKey);

          if (!tokenInfo) {
            const [name, symbol, decimals] = await Promise.all([
              this.rpcManagerService.executeRequest(chainId, (chainClient) => {
                return chainClient.readContract({
                  address: tokenAddress,
                  abi: erc20Abi,
                  functionName: "name",
                });
              }),
              this.rpcManagerService.executeRequest(chainId, (chainClient) => {
                return chainClient.readContract({
                  address: tokenAddress,
                  abi: erc20Abi,
                  functionName: "symbol",
                });
              }),
              this.rpcManagerService.executeRequest(chainId, (chainClient) => {
                return chainClient.readContract({
                  address: tokenAddress,
                  abi: erc20Abi,
                  functionName: "decimals",
                });
              }),
            ]);

            tokenInfo = { name, symbol, decimals };
            await this.storageService.setCache(tokenInfoKey, tokenInfo);
          }

          erc20TokenTransfers.push({
            tokenAddress,
            fromAddress: getAddress(decoded.args.from),
            toAddress: getAddress(decoded.args.to),
            amount: BigInt(decoded.args.value),
            name: tokenInfo.name,
            symbol: tokenInfo.symbol,
            decimals: tokenInfo.decimals,
            chainId,
          });
        } catch (error) {
          this.logger.error("Failed to decode ERC20 transfer event log", {
            error,
          });
        }
      }

      // Check if this is a Withdraw event and track Native token transfers
      if (log.topics?.[0] === WITHDRAWN_EVENT_TOPIC) {
        try {
          const decoded = decodeEventLog({
            abi: [WITHDRAWN_EVENT_ABI],
            data: log.data,
            topics: log.topics,
          });

          nativeTokenTransfers.push({
            fromAddress: getAddress(log.address),
            toAddress: getAddress(decoded.args.withdrawAddress),
            amount: BigInt(decoded.args.amount),
            chainId,
          });
        } catch (error) {
          this.logger.error("Failed to decode Withdrawn event log", { error });
        }
      }
    }

    return userOpGroups;
  }

  private getUserOpNativeTransfers(
    traces: ChainClientTraceTransactionCallType,
    userOpTransfers: UserOpTranferStateTransition,
    chainId: string,
  ) {
    const userOpGroup = userOpTransfers;
    let nativeTokenTransfers: NativeTokenStateTransition[] = [];

    for (const traceTransactionCall of traces?.calls || []) {
      let userOpHash: Hex = "0x";

      // If innerHandleOp call matches, extract the userOpHash from it
      if (
        traceTransactionCall?.input?.slice(0, 10) === INNER_HANDLE_OP_SELECTOR
      ) {
        try {
          const decoded = decodeFunctionData({
            abi: [INNER_HANDLE_OP_ABI],
            data: traceTransactionCall.input,
          });

          userOpHash = decoded.args[1].userOpHash;
        } catch (error) {
          this.logger.error("Failed to decode innerHandleOp trace call", {
            error,
          });

          // If userOp hash is not derived, we can't store the transfer traces anywhere so skip it
          continue;
        }

        const flatTraceTransactionCalls = (
          txTraceCalls: ChainClientTraceTransactionCallType,
        ) => {
          const { calls, ...rest } = txTraceCalls;
          const result = [rest];

          if (calls) {
            for (const call of calls) {
              result.push(...flatTraceTransactionCalls(call));
            }
          }

          return result;
        };

        // Flatten the trace transaction calls
        const flattenTraceTransactionCalls =
          flatTraceTransactionCalls(traceTransactionCall);

        for (const call of flattenTraceTransactionCalls) {
          if (call.value && call.value !== "0x0") {
            nativeTokenTransfers.push({
              fromAddress: getAddress(call?.from || zeroAddress),
              toAddress: getAddress(call?.to || zeroAddress),
              amount: BigInt(call.value),
              chainId,
            });
          }

          // If postOp call matches, it is the end of the userOp execution. Collect the transfers and map it with userOp hash
          if (call?.input?.slice(0, 10) === POST_OP_SELECTIOR) {
            userOpGroup[userOpHash] = {
              ...userOpGroup[userOpHash],
              nativeTokenTransfers: [
                ...userOpGroup[userOpHash].nativeTokenTransfers,
                ...nativeTokenTransfers,
              ],
            };
            nativeTokenTransfers = [];
            break;
          }
        }
      }
    }

    return userOpGroup;
  }

  async getUserOpStateTransitions(
    txParams: [{ receipt: TransactionReceipt; chainId: string }],
  ) {
    try {
      const userOpTranferStateTransitions = await Promise.all(
        txParams.map(async ({ receipt, chainId }) => {
          let [userOpTransfers, traces] = await Promise.all([
            this.getUserOpTransfers(receipt.logs, chainId),
            this.rpcManagerService.executeRequest(chainId, (chainClient) => {
              return chainClient.trace.transaction(receipt.transactionHash);
            }),
          ]);

          if (traces) {
            userOpTransfers = this.getUserOpNativeTransfers(
              traces,
              userOpTransfers,
              chainId,
            );
          }

          return userOpTransfers;
        }),
      );

      return userOpTranferStateTransitions;
    } catch (error) {
      this.logger.error("Failed to get userOp state transistions", { error });
      return [];
    }
  }
}
