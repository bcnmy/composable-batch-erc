import { ChainsService } from "@/chains";
import {
  BadRequestException,
  NotFoundException,
  packUint128Pair,
  round,
  unixTimestamp,
  withTrace,
} from "@/common";
import { type ConfigType, InjectConfig } from "@/core/config";
import { Logger } from "@/core/logger";
import { EntryPointService } from "@/entry-point";
import { EstimationGasLimits } from "@/gas-estimator";
import { gasEstimatorConfig } from "@/gas-estimator/gas-estimator.config";
import { MerkleTreeService } from "@/merkle-tree";
import { NodeService } from "@/node";
import {
  SPONSORSHIP_GAS_TANK_OWNER,
  TRUSTED_GAS_TANK_ADDRESS,
  nodeConfig,
} from "@/node/node.config";
import {
  ArbitraryPaymentService,
  type FeePaymentType,
  type MeeTransactionType,
} from "@/payment";
import { PaymentService } from "@/payment/payment.service";
import { PriceFeedsService } from "@/price-feeds";
import { RpcManagerService } from "@/rpc-manager";
import {
  type SimulationResult,
  SimulationService,
  SimulatorService,
} from "@/simulator";
import { DEFAULT_GLOBAL_EXPIRATION_TIME, StorageService } from "@/storage";
import {
  type SignedPackedMeeUserOp,
  UserOpService,
  packMeeUserOp,
  unpackPackedMeeUserOp,
} from "@/user-ops";
import { userOpConfig } from "@/user-ops/userop.config";
import { encodeSmartSessionSignature } from "@rhinestone/module-sdk";
import { entries, omit } from "remeda";
import semver from "semver";
import { Service } from "typedi";
import {
  type GetTransactionReturnType,
  type Hex,
  TransactionReceiptNotFoundError,
  concat,
  concatHex,
  decodeAbiParameters,
  encodeAbiParameters,
  erc20Abi,
  formatUnits,
  hexToBigInt,
  isAddressEqual,
  pad,
  recoverMessageAddress,
  serializeTransaction,
  sliceHex,
  toHex,
  zeroAddress,
} from "viem";
import {
  ExecutionStatus,
  MEE_SIGNATURE_TYPE_OFFSET,
  MeeSignatureType,
  SUPERTX_MEEUSEROP_STRUCT_TYPEHASH,
} from "./constants";
import {
  type ExecuteQuoteOptions,
  type GetQuoteOptions,
  type MeeQuote,
  type MeeVersionWithChainIdsType,
  type MeeVersionsType,
  type QuoteType,
  type RequestQuoteOptions,
  type RequestQuotePermitOptions,
} from "./interfaces";
import { calculateOrchestrationFee } from "./utils/calculate-orchestration-fee";

@Service()
export class QuotesService {
  constructor(
    @InjectConfig(nodeConfig)
    private readonly nodeConfiguration: ConfigType<typeof nodeConfig>,
    @InjectConfig(userOpConfig)
    private readonly userOpConfiguration: ConfigType<typeof userOpConfig>,
    @InjectConfig(gasEstimatorConfig)
    private readonly gasEstimatorConfiguration: ConfigType<
      typeof gasEstimatorConfig
    >,
    private readonly chainsService: ChainsService,
    private readonly entryPointService: EntryPointService,
    private readonly merkleTreeService: MerkleTreeService,
    private readonly nodeService: NodeService,
    private readonly priceFeedsService: PriceFeedsService,
    private readonly userOpService: UserOpService,
    private readonly arbitraryPaymentService: ArbitraryPaymentService,
    private readonly paymentService: PaymentService,
    private readonly simulatorService: SimulatorService,
    private readonly simulationService: SimulationService,
    private readonly storageService: StorageService,
    private readonly rpcManagerService: RpcManagerService,
    private readonly logger: Logger,
  ) {}

  async requestQuote(
    requestId: string,
    options: RequestQuoteOptions | RequestQuotePermitOptions,
  ): Promise<MeeQuote> {
    const {
      permit,
      quoteType,
      paymentInfo,
      userOps,
      simulation,
      trigger,
      meeVersions,
    } = options;

    const isEIP712SupportedMeeVersion = this.isVersionConsistentAndAboveTarget(
      "2.2.0",
      meeVersions,
    );

    // If fusion mode, EOA will be the origination of funds
    // If non fusion mode, SCA will be the origination of funds
    // Special case: If incase of trigger call flow, it is expected that the trigger call will send the funds to SCA in SDK itself via onchain mode
    // and the quote is treated as non fusion mode on node side
    const addressForBalanceCheck = permit ? paymentInfo.eoa : userOps[0].sender; // This is a main userOp, so no need to worry about sponsorship here

    // This should never happen
    if (!addressForBalanceCheck) {
      throw new Error("Failed to retrieve user's EOA or SCA account address");
    }

    const paymentChainInfo = this.chainsService.getChainSettings(
      paymentInfo.chainId,
    );

    for (const { chainId } of userOps) {
      const userOpChainInfo = this.chainsService.getChainSettings(chainId);

      if (paymentChainInfo.isTestChain !== userOpChainInfo.isTestChain) {
        throw new BadRequestException(
          "Supertransactions cannot mix testnet and mainnet instructions together.",
        );
      }
    }

    this.logger.trace(
      { requestId, paymentInfo, userOps },
      `Received a ${permit ? "quote-permit" : "quote"} request`,
    );

    const isPaymentTokenSupported =
      this.chainsService.isChainPaymentTokenSupported(
        paymentInfo.chainId,
        paymentInfo.token,
      );

    let feePaymentType: FeePaymentType = "CONFIGURED_TOKEN";

    // If configured payment token doesn't matches the requested payment token ?
    // Arbitrary token payment support is checked
    if (isPaymentTokenSupported) {
      feePaymentType =
        paymentInfo.token === zeroAddress ? "NATIVE" : "CONFIGURED_TOKEN";
    } else {
      const isArbitraryPaymentTokensSupported = await withTrace(
        "requestQuote.isArbitraryPaymentTokensSupported",
        async () => {
          return await this.chainsService.isArbitraryPaymentTokensSupported(
            paymentInfo.chainId,
          );
        },
        { chainId: paymentInfo.chainId },
      )();

      if (!isArbitraryPaymentTokensSupported) {
        throw new BadRequestException(
          "Your selected gas payment token for your supertransaction is not supported. Please use a different token to pay for the supertransaction.",
        );
      }

      // TODO: Remove this check if self hosted sponsorship supports arbitrary tokens
      if (paymentInfo.sponsored && isArbitraryPaymentTokensSupported) {
        throw new BadRequestException(
          "Your selected gas payment token for your sponsored supertransaction is not supported. Please use a different token to pay for the sponsored supertransaction.",
        );
      }

      feePaymentType = "ARBITRARY_TOKEN";
    }

    let transactionType: MeeTransactionType = permit ? "fusion" : "normal";

    // Biconomy hosted sponsorship will be considered as trusted sponsorship
    const isTrustedSponsorship =
      (paymentInfo.sponsored &&
        paymentInfo.sender.toLowerCase() ===
          TRUSTED_GAS_TANK_ADDRESS.toLowerCase()) ||
      false;

    // If it is a sponsored tx, the token transfers are encoded like quote type.
    if (permit && paymentInfo.sponsored) {
      transactionType = "normal";
    }

    let paymentMeeUserOpRequest = this.paymentService.preparePaymentUserOp({
      feePaymentType,
      paymentInfo,
      isTrustedSponsorship,
      paymentCalldataInfo: {
        type: transactionType,
        tokenAddress: paymentInfo.token,
        amount: 0n,
        ...(permit ? { eoa: paymentInfo.eoa } : {}),
      },
    });

    this.logger.trace(
      {
        requestId,
        paymentMeeUserOpRequest,
        isSponsored: paymentInfo.sponsored,
        isTrustedSponsorship,
      },
      "Built a initial mee payment userop request",
    );

    const userOpRequests = [paymentMeeUserOpRequest];
    userOpRequests.push(...userOps);

    const simulationsGasLimits = new Map<number, EstimationGasLimits>();

    // This will be initially zero. If simulation is enabled, this value will be replaced
    let paymentTokenBalance = 0n;

    if (simulation?.simulate) {
      // this is optional only if payment userOp is trustedSponsored payment userOp as this will be skipped and no balance check is needed
      let paymentTokenBalancePromise: Promise<bigint> | null = null;

      // If user paymentUserOps or third party sponsored payment userOp ? Balance should be there for transaction fees.
      if (!isTrustedSponsorship) {
        paymentTokenBalancePromise =
          paymentInfo.token === zeroAddress
            ? this.rpcManagerService.executeRequest(
                paymentInfo.chainId,
                (chainClient) => {
                  return chainClient.getBalance({
                    address: addressForBalanceCheck,
                  });
                },
              )
            : this.rpcManagerService.executeRequest(
                paymentInfo.chainId,
                (chainClient) => {
                  return chainClient.readContract({
                    address: paymentInfo.token,
                    abi: erc20Abi,
                    functionName: "balanceOf",
                    args: [addressForBalanceCheck],
                  });
                },
              );
      }

      // This is optional only if permit and trigger is not available or payment token and trigger token are same
      let triggerTokenBalancePromise: Promise<bigint> | null = null;

      // If fusion mode, the origin account should have sufficient balance for funding
      if (permit) {
        if (!trigger) {
          throw new BadRequestException(
            "Trigger funding information is required for fusion mode",
          );
        }

        if (
          isAddressEqual(paymentInfo.token, trigger.tokenAddress) &&
          paymentTokenBalancePromise !== null
        ) {
          // If payment token and trigger token are same and payment token balance fetch promise is already there ?
          //  Promise can be null so it can be ignored below
          triggerTokenBalancePromise = null;
        } else {
          triggerTokenBalancePromise =
            trigger.tokenAddress === zeroAddress
              ? this.rpcManagerService.executeRequest(
                  trigger.chainId,
                  (chainClient) => {
                    return chainClient.getBalance({
                      address: addressForBalanceCheck,
                    });
                  },
                )
              : this.rpcManagerService.executeRequest(
                  trigger.chainId,
                  (chainClient) => {
                    return chainClient.readContract({
                      address: trigger.tokenAddress,
                      abi: erc20Abi,
                      functionName: "balanceOf",
                      args: [addressForBalanceCheck],
                    });
                  },
                );
        }
      }

      const tokenBalancePromises: Promise<bigint>[] = [];

      if (paymentTokenBalancePromise !== null) {
        tokenBalancePromises.push(paymentTokenBalancePromise);
      }

      if (triggerTokenBalancePromise !== null) {
        tokenBalancePromises.push(triggerTokenBalancePromise);
      }

      if (tokenBalancePromises.length > 0) {
        // length one: it should be either just payment token balance or both payment and trigger token balance
        // length two: it should be payment token balance (pos 0) and trigger token balance (pos 1)
        const tokenBalances = await withTrace(
          "requestQuote.getTokenBalances",
          async () => {
            return await Promise.all(tokenBalancePromises);
          },
        )();

        if (!isTrustedSponsorship) {
          // Payment token balance will be always there in position 0 if simulation is enabled and it is not an trusted sponsored payment mode
          paymentTokenBalance = tokenBalances[0];
        }

        if (permit && trigger) {
          const isPaymentTokenAndTriggerTokenSame = isAddressEqual(
            paymentInfo.token,
            trigger.tokenAddress,
          );

          let triggerTokenBalance = 0n;

          if (isTrustedSponsorship) {
            // If it is a trusted spons ? Payment token balance will be not be there. So only trigger token balance will be there
            triggerTokenBalance = tokenBalances[0];
          } else {
            // If it is not a trsuted spons ? payment token balance will be always there
            if (isPaymentTokenAndTriggerTokenSame) {
              // if payment token and trigger token are same ? then paymentTokenBalance is considered as triggerTokenBalance
              triggerTokenBalance = paymentTokenBalance;
            } else {
              // if payment token and trigger token are not same and it is not a trusted spons ? Both payment token and trigger token
              // balance will be there and we take trigger token balance from position 1
              triggerTokenBalance = tokenBalances[1];
            }
          }

          // If EOA balance is less than trigger amount ? Trigger will fail because of insufficient funds.
          // Fail early without simulation here
          if (triggerTokenBalance < trigger.amount) {
            throw new BadRequestException(
              "Insufficient funding amount for funding transaction",
            );
          }
        }
      }

      if (!quoteType) {
        throw new BadRequestException(
          "Quote type is required when simulation is provided",
        );
      }

      let simulationResults: SimulationResult[] = [];

      try {
        simulationResults = await withTrace(
          "simulation.simulateAndEstimateGasForUserOps",
          async () =>
            await this.simulationService.simulateUserOps(
              quoteType,
              userOpRequests,
              paymentInfo,
              isTrustedSponsorship,
              meeVersions,
              trigger,
              simulation.overrides,
            ),
        )();
      } catch (error) {
        this.logger.error(
          { requestId, error },
          "Pre simulations failed, ignoring the simulations and gas estimation result",
        );
      }

      for (const {
        simulationResult,
        userOpIndex,
        chainId,
      } of simulationResults) {
        if (simulationResult.revert) {
          throw new BadRequestException(
            `UserOp [${userOpIndex}] simulation failed. Revert reason: ${simulationResult.revertReason}`,
          );
        }

        const { verificationGasLimit, callGasLimit } = simulationResult;

        const bufferPercentage = simulation?.gasLimitBuffers?.[chainId] || 0n;

        simulationsGasLimits.set(userOpIndex, {
          verificationGasLimit,
          // Buffer will be not applied for payment userOp and only applied for devUserOps
          callGasLimit:
            userOpIndex !== 0
              ? callGasLimit + (callGasLimit * bufferPercentage) / 100n
              : callGasLimit,
        });
      }
    }

    const timesSeenPerSender: Map<string, number> = new Map();
    const timesSeenPerSenderByPos: number[] = [];

    for (const userOpRequest of userOpRequests) {
      const accountIdentifier = `${userOpRequest.sender}:${userOpRequest.chainId}`;
      const timesSeen = timesSeenPerSender.get(accountIdentifier) ?? 0;
      timesSeenPerSenderByPos.push(timesSeen);
      timesSeenPerSender.set(accountIdentifier, timesSeen + 1);
    }

    const meePackedUserOpsWithGasInfo = await Promise.all(
      userOpRequests.map(async (userOp, index) => {
        return await this.userOpService.getPackedMeeUserOpWithGasEstimates(
          userOp,
          paymentInfo,
          isTrustedSponsorship,
          simulationsGasLimits.get(index),
          timesSeenPerSenderByPos[index] === 0,
          index === 0,
          isEIP712SupportedMeeVersion,
          quoteType === "simple",
        );
      }),
    );

    const unpackedMeeUserOps = meePackedUserOpsWithGasInfo.map(
      ({ packedMeeUserOp }) => unpackPackedMeeUserOp(packedMeeUserOp),
    );

    this.logger.trace(
      { requestId, unpackedMeeUserOps },
      "Prepared all the unpacked userOps",
    );

    const maxGasCostInDollars = (
      await Promise.all(
        unpackedMeeUserOps.map((meeUserOp, index) => {
          // If it is a trusted payment userOp ? cost will be always zero
          if (index === 0 && isTrustedSponsorship) {
            return Promise.resolve(0);
          }

          const { l1Gas } = meePackedUserOpsWithGasInfo[index];
          return this.userOpService.getUserOpCost(
            meeUserOp.maxGasLimit,
            meeUserOp.maxFeePerGas,
            meeUserOp.chainId,
            l1Gas,
          );
        }),
      )
    ).reduce((sum, current) => sum + current, 0);

    const orhcestrationFeeResult = calculateOrchestrationFee(
      unpackedMeeUserOps.slice(1), // skip payment userOp. User doesnt have to pay for the payment userOp
      this.userOpConfiguration,
    );

    this.logger.trace(
      { requestId, orhcestrationFeeResult },
      "Calculated the orchestration fee in dollars",
    );

    const totalCostInDollars =
      maxGasCostInDollars + orhcestrationFeeResult.totalOrchestrationFee;

    this.logger.trace(
      {
        requestId,
        totalCostInDollars,
        maxGasCostInDollars,
        orchestrationFeeInDollars: orhcestrationFeeResult.totalOrchestrationFee,
      },
      "Calcualted the total cost in dollars required for userop execution",
    );

    let tokenAmount = { amount: BigInt(0), decimals: 18 };

    // Gas fees payment amount will be calculated here
    switch (feePaymentType) {
      // Token amount and price will be calculated from orcales configured by node
      case "NATIVE":
      case "CONFIGURED_TOKEN": {
        const paymentToken = this.chainsService.getChainPaymentToken(
          paymentInfo.chainId,
          paymentInfo.token,
        );

        const [paymentTokenPrice, paymentTokenDecimals] = await withTrace(
          "paymentToken.getTokenPriceAndDecimals",
          async () =>
            await Promise.all([
              this.priceFeedsService.getPaymentTokenPrice(paymentToken),
              this.priceFeedsService.getPaymentTokenDecimals(paymentToken),
            ]),
        )();

        tokenAmount = this.paymentService.dollarCostToTokenAmount(
          paymentInfo.token,
          paymentInfo.chainId,
          totalCostInDollars,
          paymentTokenPrice,
          paymentTokenDecimals,
        );
        break;
      }

      // Token amount and price will be calculated by payment providers configured by node
      case "ARBITRARY_TOKEN": {
        // sanity check - if the token is swappable, then the payment token will be transferred using erc20 transfer
        // and rebalanced by the node itself later
        const paymentRouteResponse =
          await this.arbitraryPaymentService.getPaymentRouteTransactionData(
            paymentInfo.sender,
            this.nodeConfiguration.feeBeneficiary,
            paymentInfo.token,
            totalCostInDollars,
            paymentInfo.chainId,
          );

        tokenAmount = paymentRouteResponse.tokenAmount;
        break;
      }

      default: {
        throw new BadRequestException("Invalid fee token type");
      }
    }

    this.logger.trace(
      { requestId, tokenAmount },
      "Converted the total cost in dollars to token amount",
    );

    const gasFee = round(
      maxGasCostInDollars.toString(),
      this.gasEstimatorConfiguration.itxCostDecimals,
    );

    const orchestrationFee = round(
      orhcestrationFeeResult.totalOrchestrationFee.toString(),
      this.gasEstimatorConfiguration.itxCostDecimals,
    );

    if (simulation?.simulate) {
      // If simulation is enabled, fail early when there is insufficient funds for relayer fees + no sponsorship
      if (!paymentInfo.sponsored && paymentTokenBalance < tokenAmount.amount) {
        throw new BadRequestException(
          `Insufficient balance to pay for the gas & orchestration fees. This supertransaction needs $${gasFee} gas fee and $${orchestrationFee} orchestration fee of the provided fee token ${paymentInfo.token} on chain ${paymentInfo.chainId}`,
        );
      }
    }

    // Trusted payment userOp will be not executed so the initially generated payment userOp with zero amount is good enough
    if (!isTrustedSponsorship) {
      paymentMeeUserOpRequest = this.paymentService.preparePaymentUserOp({
        feePaymentType,
        paymentInfo,
        isTrustedSponsorship,
        paymentCalldataInfo: {
          type: transactionType,
          tokenAddress: paymentInfo.token,
          amount: tokenAmount.amount,
          ...(permit ? { eoa: paymentInfo.eoa } : {}),
        },
      });

      // Taking the first userOp which is the payment userOp
      let [paymentMeeUserOpWithGasInfo] = meePackedUserOpsWithGasInfo;

      // Payment userOp is dummy initially for the cost estimation. Once the estimation is done,
      // the payment userOp is regenerated with actual cost
      paymentMeeUserOpWithGasInfo =
        await this.userOpService.getPackedMeeUserOpWithGasEstimates(
          paymentMeeUserOpRequest,
          paymentInfo,
          isTrustedSponsorship,
          simulationsGasLimits.get(0), // payment userOp index is always 0
          true,
          true,
          isEIP712SupportedMeeVersion,
          quoteType === "simple",
          paymentMeeUserOpWithGasInfo.l1Gas,
          paymentMeeUserOpWithGasInfo.gasConditions,
        );

      unpackedMeeUserOps[0] = unpackPackedMeeUserOp(
        paymentMeeUserOpWithGasInfo.packedMeeUserOp,
      );
    }

    const packedMeeUserOps = unpackedMeeUserOps.map((meeUserOp) =>
      packMeeUserOp(meeUserOp),
    );

    const merkleTree = await withTrace(
      "requestQuote.createMerkleTree",
      async () =>
        await this.merkleTreeService.createMerkleTree(
          packedMeeUserOps,
          quoteType === "simple",
          isEIP712SupportedMeeVersion,
          isTrustedSponsorship,
        ),
    )();

    const quoteResponse: MeeQuote = {
      hash: merkleTree.root as Hex,
      node: this.nodeService.address,
      // New slashing algorithm implementation will move this quote level commitment to execution level commitment
      // So that the node don't blindly give commitment to the supertransaction execution
      commitment: await withTrace(
        "requestQuote.signMessage",
        async () => await this.nodeService.signMessage(merkleTree.root),
      )(),
      paymentInfo: {
        ...paymentInfo,
        tokenAmount: round(
          formatUnits(tokenAmount.amount, tokenAmount.decimals),
          this.gasEstimatorConfiguration.itxCostDecimals,
        ),
        tokenWeiAmount: tokenAmount.amount,
        tokenValue: round(
          totalCostInDollars.toString(),
          this.gasEstimatorConfiguration.itxCostDecimals,
        ),
        gasFee,
        orchestrationFee,
      },
      userOps: unpackedMeeUserOps,
      quoteType,
    };

    this.logger.trace({ requestId, quoteResponse }, "Mee quote response");

    return quoteResponse;
  }

  async executeQuote(
    requestId: string,
    options: ExecuteQuoteOptions,
  ): Promise<Pick<GetQuoteOptions, "hash">> {
    const {
      commitment,
      hash,
      signature,
      userOps: meeUserOps,
      meeVersions,
      isEIP712TrustedSponsorshipSupported,
    } = options;

    const isEIP712SupportedMeeVersion = this.isVersionConsistentAndAboveTarget(
      "2.2.0",
      meeVersions,
    );
    const isStxValidatorSupportedMeeVersion =
      this.isVersionConsistentAndAboveTarget("3.0.0", meeVersions);

    const hasQuote = await withTrace(
      "exec.hasQuote",
      async () => {
        return await this.storageService.hasQuote(hash);
      },
      {
        hash,
      },
    )();

    if (hasQuote) {
      throw new BadRequestException(
        `Super transaction ${hash} has already been scheduled for execution`,
      );
    }

    this.logger.trace(
      { requestId, superTransactionHash: hash, quote: options },
      "Received a supertransaction execution request",
    );

    const packedMeeUserOps = meeUserOps.map((meeUserOp) =>
      packMeeUserOp(meeUserOp),
    );

    const isSessionExists = meeUserOps.some(
      (op) => op.sessionDetails !== undefined,
    );

    if (isSessionExists) {
      this.logger.trace(
        { requestId, superTransactionHash: hash },
        "Found userOps with session details",
      );
    }

    const signatureType = sliceHex(signature, 0, MEE_SIGNATURE_TYPE_OFFSET);
    const signatureData = sliceHex(signature, MEE_SIGNATURE_TYPE_OFFSET);

    // make sure quoteType is always defined
    let quoteType: QuoteType;
    // Detect quote type
    if (!options.quoteType) {
      if (
        signatureType === MeeSignatureType.OFF_CHAIN ||
        signatureType === MeeSignatureType.OFF_CHAIN_P256
      ) {
        quoteType = "simple";
      } else if (signatureType === MeeSignatureType.ON_CHAIN) {
        quoteType = "onchain";
      } else if (signatureType === MeeSignatureType.ERC20_PERMIT) {
        quoteType = "permit";
      } else if (signatureType === MeeSignatureType.MM_DTK) {
        quoteType = "mm-dtk";
      } else if (signatureType === MeeSignatureType.SAFE_SA) {
        quoteType = "safe-sa";
      } else {
        throw new BadRequestException(
          `Unsupported signature type for quote type detection ${signatureType}`,
        );
      }
    } else {
      quoteType = options.quoteType;
    }

    // For sponsored supertransaction, the payment userOp will be signed by sponsorship backend
    // Thus for the sponsored stx, the payment userOp signature should be non-empty
    const isSponsoredSupertransaction =
      !!packedMeeUserOps[0].userOp.signature &&
      packedMeeUserOps[0].userOp.signature !== "0x00" && // handling the "0x00" edge case
      packedMeeUserOps[0].userOp.signature !== "0x"; // handling the "0x" edge case

    // Biconomy hosted sponsorship will be considered as trusted sponsorship
    const isTrustedSponsorship =
      (isSponsoredSupertransaction &&
        packedMeeUserOps[0].userOp.sender.toLowerCase() ===
          TRUSTED_GAS_TANK_ADDRESS.toLowerCase()) ||
      false;

    const merkleTree = await withTrace("exec.createMerkleTree", async () =>
      this.merkleTreeService.createMerkleTree(
        packedMeeUserOps,
        quoteType === "simple",
        isEIP712SupportedMeeVersion,
        isTrustedSponsorship,
      ),
    )();

    if (merkleTree.root !== hash) {
      throw new BadRequestException(
        "Your supertransaction seems to be invalid/manipulated. Failed to generate a valid supertransaction hash from the supertransaction data",
      );
    }

    const isCommitmentVerified = await withTrace(
      "exec.verifyCommitment",
      async () =>
        await this.nodeService.verifyMessage(merkleTree.root, commitment),
    )();

    if (!isCommitmentVerified) {
      throw new BadRequestException(
        "Your supertransaction seems to be invalid/manipulated. Failed to verify the commitment given by the MEE node",
      );
    }

    this.logger.trace(
      { requestId, superTransactionHash: hash, signatureType, signatureData },
      "Received signature type and data",
    );

    let transaction: GetTransactionReturnType;

    switch (quoteType) {
      case "simple":
      case "permit":
      case "mm-dtk":
      case "safe-sa":
        break;

      case "onchain": {
        const [hash, chainId] = decodeAbiParameters(
          [
            { type: "bytes32" }, //
            { type: "uint256" },
          ],
          signatureData,
        );

        try {
          transaction = await withTrace(
            "exec.getOnchainTransaction",
            async () => {
              return await this.rpcManagerService.executeRequest(
                chainId.toString(),
                (chainClient) => {
                  return chainClient.getTransaction({
                    hash,
                  });
                },
              );
            },
            {
              hash,
              chainId: chainId.toString(),
            },
          )();
        } catch (err) {
          throw new BadRequestException(
            `Failed to fetch the onchain fusion transaction for your supertransaction. Please verify that your onchain fusion transaction (txHash: ${hash}) has been executed and settled onchain.`,
          );
        }

        if (!transaction) {
          throw new BadRequestException(
            `Failed to fetch the onchain fusion transaction for your supertransaction. Please verify that your onchain fusion transaction (txHash: ${hash}) has been executed and settled onchain.`,
          );
        }

        this.logger.trace(
          { requestId, superTransactionHash: hash, transaction },
          "Onchain transaction data is fetched",
        );
        break;
      }

      default: {
        throw new BadRequestException(`Unsupported quote type (${quoteType})`);
      }
    }

    const meeUserOpHashes = packedMeeUserOps.map(
      ({ meeUserOpHash }) => meeUserOpHash,
    );

    const signedPackedMeeUserOps: SignedPackedMeeUserOp[] =
      packedMeeUserOps.map((packedMeeUserOp, index) => {
        const { lowerBoundTimestamp, upperBoundTimestamp, userOp } =
          packedMeeUserOp;

        // index 0 is a payment userOp
        const isPaymentUserOp = index === 0;
        const isFirstUserOp = index === 1;

        if (isPaymentUserOp && isSponsoredSupertransaction) {
          this.logger.trace(
            {
              requestId,
              superTransactionHash: hash,
              sponsorshipUserOp: packedMeeUserOp,
            },
            "Sponsored supertransaction found",
          );

          return {
            ...packedMeeUserOp,
            userOp: {
              ...userOp,
              signature: packedMeeUserOp.userOp.signature as Hex,
            },
          };
        }

        const proof = merkleTree.getProof(index) as Hex[];

        let signature: Hex;

        switch (quoteType) {
          case "simple": {
            if (isSessionExists) {
              if (isEIP712SupportedMeeVersion) {
                signature = concatHex([
                  signatureType, // Simple signature type
                  encodeAbiParameters(
                    [
                      { type: "bytes32" }, // stxStructTypeHash
                      { type: "uint256" }, // userOp index
                      { type: "bytes32[]" }, // meeUserOpHashes - array of hashes
                      { type: "bytes" }, // superTxSignature
                    ],
                    [
                      SUPERTX_MEEUSEROP_STRUCT_TYPEHASH,
                      // For trusted sponsorship, as we're ignoring the payment userOp, index should be sub by 1 to account for that
                      // The index will be always greater than 1 if its sponsorship mode so sub by 1 is not a problem
                      isEIP712TrustedSponsorshipSupported &&
                      isTrustedSponsorship
                        ? BigInt(index - 1)
                        : BigInt(index),
                      // If it is a trusted sponsorship, the payment userop can be skipped because it is not going to be executed at all.
                      isEIP712TrustedSponsorshipSupported &&
                      isTrustedSponsorship
                        ? meeUserOpHashes.slice(1)
                        : meeUserOpHashes,
                      signatureData,
                    ],
                  ),
                ]);
              } else {
                signature = concatHex([
                  signatureType,
                  encodeAbiParameters(
                    [
                      { type: "bytes32" },
                      { type: "bytes32[]" },
                      { type: "bytes" },
                    ],
                    [hash, proof, signatureData],
                  ),
                ]);
              }
            } else {
              if (isEIP712SupportedMeeVersion) {
                signature = concatHex([
                  signatureType, // Simple signature type
                  encodeAbiParameters(
                    [
                      { type: "bytes32" }, // stxStructTypeHash
                      { type: "uint256" }, // userOp index
                      { type: "bytes32[]" }, // meeUserOpHashes - array of hashes
                      { type: "bytes" }, // superTxSignature
                      { type: "uint256" }, // packed timestamp
                    ],
                    [
                      SUPERTX_MEEUSEROP_STRUCT_TYPEHASH,
                      // For trusted sponsorship, as we're ignoring the payment userOp, index should be sub by 1 to account for that
                      // The index will be always greater than 1 if its sponsorship mode so sub by 1 is not a problem
                      isEIP712TrustedSponsorshipSupported &&
                      isTrustedSponsorship
                        ? BigInt(index - 1)
                        : BigInt(index),
                      // If it is a trusted sponsorship, the payment userop can be skipped because it is not going to be executed at all.
                      isEIP712TrustedSponsorshipSupported &&
                      isTrustedSponsorship
                        ? meeUserOpHashes.slice(1)
                        : meeUserOpHashes,
                      signatureData,
                      hexToBigInt(
                        packUint128Pair(
                          lowerBoundTimestamp,
                          upperBoundTimestamp,
                        ),
                      ),
                    ],
                  ),
                ]);
              } else {
                signature = concatHex([
                  signatureType,
                  encodeAbiParameters(
                    [
                      { type: "bytes32" },
                      { type: "uint48" },
                      { type: "uint48" },
                      { type: "bytes32[]" },
                      { type: "bytes" },
                    ],
                    [
                      hash,
                      lowerBoundTimestamp,
                      upperBoundTimestamp,
                      proof,
                      signatureData,
                    ],
                  ),
                ]);
              }
            }
            break;
          }

          case "onchain": {
            const { r, s, v, ...tx } = transaction;
            const serializableTx = { ...tx, data: tx.input, input: undefined };

            signature = concatHex([
              signatureType,
              transaction.type === "legacy" ? "0x00" : "0x",
              serializeTransaction(serializableTx, { r, s, v }),
              concatHex(proof),
              pad(toHex(proof.length), { size: 1, dir: "left" }),
              pad(toHex(lowerBoundTimestamp), { size: 6, dir: "left" }),
              pad(toHex(upperBoundTimestamp), { size: 6, dir: "left" }),
            ]);
            break;
          }

          case "permit": {
            if (isStxValidatorSupportedMeeVersion) {
              // Stx validator permit signature decoding and re-packing
              // owner is added as an extra parameter to the signature data
              // bytes signature instead of v, r, s
              const [
                token,
                owner,
                spender,
                domainSeparator,
                , //
                amount,
                , //
                nonce,
                signature_,
              ] = decodeAbiParameters(
                [
                  { type: "address" }, // token
                  { type: "address" }, // owner
                  { type: "address" }, // spender
                  { type: "bytes32" }, // domainSeparator
                  { type: "bytes32" }, // permitTypeHash
                  { type: "uint256" }, // amount
                  { type: "uint256" }, // chainId
                  { type: "uint256" }, // nonce
                  { type: "bytes" }, // signature
                ],
                signatureData,
              );

              signature = concatHex([
                signatureType,
                encodeAbiParameters(
                  [
                    {
                      type: "tuple",
                      components: [
                        { type: "address" },
                        { type: "address" },
                        { type: "address" },
                        { type: "bytes32" },
                        { type: "uint256" },
                        { type: "uint256" },
                        { type: "bool" },
                        { type: "bytes32" },
                        { type: "uint48" },
                        { type: "uint48" },
                        { type: "bytes" },
                        { type: "bytes32[]" },
                      ],
                    },
                  ],
                  [
                    [
                      token,
                      owner,
                      spender,
                      domainSeparator,
                      amount,
                      nonce,
                      // For sponsored supertransactions, the permit approval will happen in first user defined userOp
                      // For non sponsored supertransaction, the permit approval will happen in payment userOp
                      isSponsoredSupertransaction
                        ? isFirstUserOp
                        : isPaymentUserOp,
                      hash,
                      lowerBoundTimestamp,
                      upperBoundTimestamp,
                      signature_,
                      proof,
                    ],
                  ],
                ),
              ]);
              break;
            }
            // Legacy permit signature decoding and re-packing: no owner is present
            // v, r, s are present separately instead of signature
            const [
              token,
              spender,
              domainSeparator,
              , //
              amount,
              , //
              nonce,
              v,
              r,
              s,
            ] = decodeAbiParameters(
              [
                { type: "address" },
                { type: "address" },
                { type: "bytes32" },
                { type: "bytes32" },
                { type: "uint256" },
                { type: "uint256" },
                { type: "uint256" },
                { type: "uint256" },
                { type: "bytes32" },
                { type: "bytes32" },
              ],
              signatureData,
            );

            signature = concatHex([
              signatureType,
              encodeAbiParameters(
                [
                  {
                    type: "tuple",
                    components: [
                      { type: "address" },
                      { type: "address" },
                      { type: "bytes32" },
                      { type: "uint256" },
                      { type: "uint256" },
                      { type: "bool" },
                      { type: "bytes32" },
                      { type: "uint48" },
                      { type: "uint48" },
                      { type: "uint256" },
                      { type: "bytes32" },
                      { type: "bytes32" },
                      { type: "bytes32[]" },
                    ],
                  },
                ],
                [
                  [
                    token,
                    spender,
                    domainSeparator,
                    amount,
                    nonce,
                    // For sponsored supertransactions, the permit approval will happen in first user defined userOp
                    // For non sponsored supertransaction, the permit approval will happen in payment userOp
                    isSponsoredSupertransaction
                      ? isFirstUserOp
                      : isPaymentUserOp,
                    hash,
                    lowerBoundTimestamp,
                    upperBoundTimestamp,
                    v,
                    r,
                    s,
                    proof,
                  ],
                ],
              ),
            ]);
            break;
          }

          case "mm-dtk": {
            const delegateManagerAbi = {
              name: "delegationManager",
              type: "address",
            };
            const delegationAbi = {
              name: "delegation",
              type: "tuple",
              components: [
                { name: "delegate", type: "address" },
                { name: "delegator", type: "address" },
                { name: "authority", type: "bytes32" },
                {
                  name: "caveats",
                  type: "tuple[]",
                  components: [
                    { name: "enforcer", type: "address" },
                    { name: "terms", type: "bytes" },
                    { name: "args", type: "bytes" },
                  ],
                },
                { name: "salt", type: "uint256" },
                { name: "signature", type: "bytes" },
              ],
            };
            const redeemDelegationCalldataAbi = {
              name: "redeemDelegationErc7579ExecutionCalldata",
              type: "bytes",
            };

            const [
              delegationManager,
              delegation,
              redeemDelegationErc7579ExecutionCalldata,
            ] = decodeAbiParameters(
              [delegateManagerAbi, delegationAbi, redeemDelegationCalldataAbi],
              signatureData,
            );

            signature = concatHex([
              signatureType,
              encodeAbiParameters(
                [
                  {
                    type: "tuple",
                    components: [
                      delegateManagerAbi,
                      delegationAbi,
                      { type: "bool" },
                      { type: "bytes32" },
                      redeemDelegationCalldataAbi,
                      { type: "uint48" },
                      { type: "uint48" },
                      { type: "bytes32[]" },
                    ],
                  },
                ],
                [
                  [
                    delegationManager,
                    delegation,
                    // For sponsored supertransactions, the permit approval will happen in first user defined userOp
                    // For non sponsored supertransaction, the permit approval will happen in payment userOp
                    isSponsoredSupertransaction
                      ? isFirstUserOp
                      : isPaymentUserOp,
                    "0x0000000000000000000000000000000000000000000000000000000000000000",
                    redeemDelegationErc7579ExecutionCalldata,
                    packedMeeUserOp.lowerBoundTimestamp,
                    packedMeeUserOp.upperBoundTimestamp,
                    proof,
                  ],
                ],
              ),
            ]);
            break;
          }

          case "safe-sa": {
            // SafeTxnData struct definition from stx-contracts
            const safeTxnDataAbi = {
              name: "safeTxnData",
              type: "tuple",
              components: [
                { name: "ogDomainSeparator", type: "bytes32" },
                { name: "to", type: "address" },
                { name: "value", type: "uint256" },
                { name: "data", type: "bytes" },
                { name: "operation", type: "uint8" },
                { name: "safeTxGas", type: "uint256" },
                { name: "baseGas", type: "uint256" },
                { name: "gasPrice", type: "uint256" },
                { name: "gasToken", type: "address" },
                { name: "refundReceiver", type: "address" },
                { name: "nonce", type: "uint256" },
                { name: "signatures", type: "bytes" },
              ],
            } as const;

            // Decode SafeTxnData from signatureData
            const [safeAccount, safeTxnData] = decodeAbiParameters(
              [
                { name: "safeAccount", type: "address" },
                {
                  name: "safeTxnData",
                  type: "tuple",
                  components: safeTxnDataAbi.components,
                },
              ],
              signatureData,
            );

            // Re-encode with DecodedSafeAccountSignatureFull structure
            signature = concatHex([
              signatureType,
              encodeAbiParameters(
                [
                  {
                    type: "tuple",
                    components: [
                      { name: "safeAccount", type: "address" },
                      safeTxnDataAbi,
                      { name: "proof", type: "bytes32[]" },
                      { name: "executeTrigger", type: "bool" },
                      { name: "lowerBoundTimestamp", type: "uint48" },
                      { name: "upperBoundTimestamp", type: "uint48" },
                    ],
                  },
                ],
                [
                  {
                    safeAccount,
                    safeTxnData,
                    proof,
                    // For sponsored supertransactions, the Safe tx execution will happen in first user defined userOp
                    // For non sponsored supertransaction, the Safe tx execution will happen in payment userOp
                    executeTrigger: isSponsoredSupertransaction
                      ? isFirstUserOp
                      : isPaymentUserOp,
                    lowerBoundTimestamp: packedMeeUserOp.lowerBoundTimestamp,
                    upperBoundTimestamp: packedMeeUserOp.upperBoundTimestamp,
                  },
                ],
              ),
            ]);
            break;
          }

          default: {
            throw new BadRequestException(
              `Unsupported quote type (${quoteType})`,
            );
          }
        }

        let finalSignature = signature;

        if (packedMeeUserOp.sessionDetails) {
          packedMeeUserOp.sessionDetails.signature = signature;
          finalSignature = encodeSmartSessionSignature(
            packedMeeUserOp.sessionDetails,
          );
        }

        return {
          ...packedMeeUserOp,
          userOp: {
            ...userOp,
            signature: finalSignature,
          },
        };
      });

    this.logger.trace(
      { requestId, superTransactionHash: hash, signedPackedMeeUserOps },
      "Received all the signedPackedMeeUserOps",
    );

    this.logger.trace(
      { requestId, superTransactionHash: hash },
      "Simulating the payment userOp",
    );

    const paymentMeeUserOp = signedPackedMeeUserOps.at(
      0,
    ) as SignedPackedMeeUserOp;

    const now = unixTimestamp();

    // Biconomy hosted sponsorship userOp simulation is skipped
    if (isSponsoredSupertransaction && isTrustedSponsorship) {
      this.logger.trace(
        { requestId, superTransactionHash: hash },
        "Simulating validation is skipped for the trusted payment userOp",
      );

      if (now > paymentMeeUserOp.upperBoundTimestamp) {
        throw new BadRequestException(
          "Your supertransaction execution window has expired.",
        );
      }

      /**
       * Raw message includes:
       * node - Node address which ensures the sponsorship signature will only be accepted by a specific node
       * hash - Supertransaction hash which ensures sponsorship sig will only be valid for a specific supertransaction
       * userOpHash - UserOp hash ensures the sponosorship sig is signed for the payment userOp
       * length - Number of userOps; ensures the batch length is locked and cannot be modified after signing
       * upperBoundTimestamp - Maximum valid timestamp for userOp execution; prevents replay after this time window
       */
      const rawMessage = concat([
        this.nodeService.address,
        hash,
        paymentMeeUserOp.userOpHash,
        toHex(meeUserOps.length),
        toHex(paymentMeeUserOp.upperBoundTimestamp),
      ]);

      // Recover the address from the signature
      const recoveredAddress = await recoverMessageAddress({
        message: {
          raw: rawMessage,
        },
        signature: paymentMeeUserOp.userOp.signature,
      });

      this.logger.trace(
        {
          chainId: paymentMeeUserOp.chainId,
          recoveredAddress,
          gasTankOwnerAddress: SPONSORSHIP_GAS_TANK_OWNER,
          userOpHash: paymentMeeUserOp.userOpHash,
          signature: paymentMeeUserOp.userOp.signature,
        },
        "Sponsorship payment userOp signature verification",
      );

      if (
        recoveredAddress.toLowerCase() !==
        SPONSORSHIP_GAS_TANK_OWNER.toLowerCase()
      ) {
        throw new Error(
          "Invalid sponsorship payment userOp. Signature verification failed",
        );
      }
    } else {
      // ethCall and debugTraceCall simulations are concurrent now. This will reduce the latency a lot
      const [{ sigFailed, validAfter, validUntil }, execFailedErr] =
        await Promise.all([
          withTrace("exec.simulateSimulateHandleOp", async () => {
            return await this.entryPointService.simulateSimulateHandleOp(
              paymentMeeUserOp,
              {
                retries: 20,
                useStorage: false,
              },
            );
          })(),
          withTrace("exec.simulateHandleOps", async () => {
            return await this.entryPointService.simulateHandleOps(
              paymentMeeUserOp,
              {
                retries: quoteType === "onchain" ? 20 : 0,
                useStorage: false,
              },
            );
          })(),
        ]);

      this.logger.trace(
        {
          requestId,
          superTransactionHash: hash,
          validationResult: { sigFailed, validAfter, validUntil },
          executionValidationResult: { execFailedErr },
        },
        "Payment userOp simulation result is fetched",
      );

      if (sigFailed) {
        switch (quoteType) {
          case "simple":
            throw new BadRequestException(
              "Failed to verify your supertransaction signature. Please check your signature.",
            );
          case "permit":
            throw new BadRequestException(
              "Failed to verify your supertransaction signature. Please check your permit signature and permit token compatibility.",
            );
          case "onchain":
            throw new BadRequestException(
              "Failed to verify your supertransaction signature. Please check your onchain transaction signature.",
            );
          case "mm-dtk":
            throw new BadRequestException(
              "Failed to verify your supertransaction signature. Please check your metamask delegator signature.",
            );
          case "safe-sa":
            throw new BadRequestException(
              "Failed to verify your supertransaction signature. Please check your Safe smart account signature.",
            );
          default:
            throw new BadRequestException(
              "Failed to verify your supertransaction signature. Please check your signature.",
            );
        }
      }

      if (now < validAfter) {
        throw new BadRequestException(
          "Your supertransaction is scheduled for future execution and the start timestamp has not been reached yet.",
        );
      }

      if (now > validUntil && validUntil !== 0) {
        throw new BadRequestException(
          "Your supertransaction execution window has expired.",
        );
      }

      if (execFailedErr.isError) {
        throw new BadRequestException(
          "Your supertransaction gas payment userOp has been reverted",
          execFailedErr.errorMessage,
        );
      }
    }

    await withTrace("exec.createQuote", async () => {
      return await this.storageService.createQuote(
        {
          ...options,
          userOps: signedPackedMeeUserOps,
        },
        // 15 days expiration
        { ttl: DEFAULT_GLOBAL_EXPIRATION_TIME },
      );
    })();

    // grouping the userOps based on chainIds
    const userOpsByChain: Record<string, SignedPackedMeeUserOp[]> = {};
    const userOpsForceExecuteByChain: Record<string, boolean> = {};

    let trustedPaymentUserOp: SignedPackedMeeUserOp | null = null;

    for (let i = 0; i < signedPackedMeeUserOps.length; i++) {
      const signedPackedMeeUserOp = signedPackedMeeUserOps[i];

      // If trusted payment userOp ? Ignore the payment userOp execution
      if (i === 0 && isSponsoredSupertransaction && isTrustedSponsorship) {
        trustedPaymentUserOp = signedPackedMeeUserOp;
        continue;
      }

      const { chainId, isCleanUpUserOp } = signedPackedMeeUserOp;

      if (!userOpsByChain[chainId]) {
        userOpsByChain[chainId] = [signedPackedMeeUserOp];
      } else {
        userOpsByChain[chainId].push(signedPackedMeeUserOp);
      }

      if (isCleanUpUserOp) {
        userOpsForceExecuteByChain[chainId] = true;
      }
    }

    // The userOp simulation execution scheduling is done in the background now. This is inspired from RPC nodes implementation logic
    // where sometime the transaction is accepted and returns txHash but in worst case the tx is not broadcasted internally.
    // This is a optimistic scheduling which reduces a latency a bit
    Promise.all(
      entries(userOpsByChain).map(async ([chainId, meeUserOps]) =>
        this.simulatorService.addJobs(
          chainId,
          meeUserOps.map((meeUserOp) => {
            return {
              meeUserOp,
              forceExecute: userOpsForceExecuteByChain[chainId],
            };
          }),
        ),
      ),
    ).catch((error) => {
      this.logger.error(
        {
          error,
          requestId,
          superTransactionHash: hash,
        },
        "Failed to schedule the supertransaction for simulation and execution phase",
      );
    });

    // Mark the trusted payment userOp as skipped in background
    if (trustedPaymentUserOp) {
      this.storageService.updateUserOpCustomFields(
        trustedPaymentUserOp.meeUserOpHash,
        {
          isConfirmed: true,
          isExecutionSkipped: true,
        },
        // 15 days expiration
        { ttl: DEFAULT_GLOBAL_EXPIRATION_TIME },
      );
    }

    return {
      hash,
    };
  }

  async getQuote(options: GetQuoteOptions) {
    const { hash, confirmations: customConfirmations } = options;

    const quote = await withTrace(
      "explorer.getQuote",
      async () => await this.storageService.getQuote(hash),
      { hash },
    )();

    if (!quote) {
      throw new NotFoundException(`Supertransaction (${hash}) not found`);
    }

    const { node, commitment, paymentInfo, userOps, trigger } = quote;

    const userOpInfo = await Promise.all(
      userOps.map(async (userOp, index) => {
        let executionStatus = ExecutionStatus.PENDING;

        const {
          txHash: executionData,
          error: executionError,
          revertReason: revertError,
          simulationStartedAt,
          executionStartedAt: miningTimestamp,
          executionFinishedAt: minedTimestamp,
          simulationTransactionData,
          actualGasCost,
          isExecutionSkipped,
          isConfirmed,
          confirmations: confirmationsFromStorage,
          ...rest
        } = userOp;

        let isTransactionConfirmed = isConfirmed || false;

        const { waitConfirmations } = this.chainsService.getChainSettings(
          userOp.chainId,
        );

        const isTxHashExists = executionData && executionData.length > 0;

        if (isExecutionSkipped) {
          executionStatus = ExecutionStatus.SKIPPED;
        } else {
          if (isTxHashExists) {
            if (minedTimestamp) {
              if (executionError && executionError.length > 0) {
                executionStatus = ExecutionStatus.MINED_FAIL;
              } else {
                executionStatus = ExecutionStatus.MINED_SUCCESS;
              }
            } else if (miningTimestamp) {
              executionStatus = ExecutionStatus.MINING;
            }
          } else {
            if (executionError && executionError.length > 0) {
              executionStatus = ExecutionStatus.FAILED;
            }
          }
        }

        const isTxSubmittedOnChain = [
          ExecutionStatus.MINED_SUCCESS,
          ExecutionStatus.MINED_FAIL,
        ].includes(executionStatus);

        // Defaults to zero
        let confirmations = 0n;

        if (isTxSubmittedOnChain) {
          // If the tx got executed, the confirmations are considered from storage. If confirms does not exists in storage ?
          // It will defaults to chain config confirms or fast block confirms for backwards compatibility.
          confirmations =
            confirmationsFromStorage ||
            (isTransactionConfirmed ? BigInt(waitConfirmations) : 1n);
        }

        // Only when non payment userOp and custom confirmations > node's default confirmations for the chain.
        const isCustomBlockConfirmationsToBeApplied =
          index !== 0 && customConfirmations > waitConfirmations;

        const txReceiptError = {
          isError: false,
          isTxDropped: false,
          errorMessage: "",
        };

        // Only when txHash exists, tx got submitted on chain and custom confirmations is requested.
        if (
          isTxHashExists &&
          isTxSubmittedOnChain &&
          isCustomBlockConfirmationsToBeApplied
        ) {
          // Check if existing confirmations are enough and meets the custom confirms requirement.
          const isConfirmationsNotEnough = customConfirmations > confirmations;

          if (isConfirmationsNotEnough) {
            try {
              const [transactionReceipt, currentBlockNumber] =
                await Promise.all([
                  withTrace(
                    "explorer.getTxReceipt",
                    async () =>
                      await this.rpcManagerService.executeRequest(
                        userOp.chainId,
                        (chainClient) => {
                          return chainClient.getTransactionReceipt({
                            hash: executionData,
                          });
                        },
                      ),
                    {
                      chainId: userOp.chainId,
                      meeUserOpHash: userOp.meeUserOpHash,
                    },
                  )(),
                  withTrace(
                    "explorer.blockNumber",
                    async () =>
                      await this.rpcManagerService.executeRequest(
                        userOp.chainId,
                        (chainClient) => {
                          return chainClient.getBlockNumber();
                        },
                      ),
                    {
                      chainId: userOp.chainId,
                      meeUserOpHash: userOp.meeUserOpHash,
                    },
                  )(),
                ]);

              // If there is a reorg happened and the tx is remined in a new block ? The block number can vary.
              // So the number of confirmations might reduced from the previous one as well. However, the new confirmations value
              // will be stored from here which handles the reorg case.
              confirmations =
                currentBlockNumber - transactionReceipt.blockNumber + 1n;

              // Custom confirmations are optimistically stored in the storage layer. So we can avoid RPC calls if customConfirmation is
              // less than the actual confirmations recorded on chain.
              this.storageService.updateUserOpCustomFields(
                userOp.meeUserOpHash,
                {
                  confirmations,
                },
                // 15 days expiration
                { ttl: DEFAULT_GLOBAL_EXPIRATION_TIME },
              );
            } catch (error) {
              txReceiptError.isError = true;

              let errorMessage =
                "Failed to fetch block confirmations for the transaction";

              if (error instanceof TransactionReceiptNotFoundError) {
                // if there is any existing confirmations but the tx was dropped after few blocks either due to reorg or RPC node issue.
                const isTxDrop = confirmations > 0n;

                if (isTxDrop) {
                  txReceiptError.isTxDropped = true;
                  errorMessage =
                    "The transaction might be dropped due to possible block reorg or node propagation failure.";

                  // update the state in storage layer as well. The txHash is no longer valid
                  this.storageService.updateUserOpCustomFields(
                    userOp.meeUserOpHash,
                    {
                      error: errorMessage,
                    },
                    // 15 days expiration
                    { ttl: DEFAULT_GLOBAL_EXPIRATION_TIME },
                  );
                }
              }

              txReceiptError.errorMessage = errorMessage;

              this.logger.error(
                {
                  error,
                  errorMessage,
                  executionData,
                  meeUserOpHash: userOp.meeUserOpHash,
                  chainId: userOp.chainId,
                },
                "Failed to fetch transaction receipt and block number on explorer request",
              );
            }
          }

          const isCustomConfirmationsSatisfied =
            confirmations >= customConfirmations;

          isTransactionConfirmed = isCustomConfirmationsSatisfied
            ? isTransactionConfirmed
            : false;
        }

        const explorerResponse = {
          ...omit(rest, ["simulationAttempts", "batchHash"]),
          executionStatus,
          executionData,
          isConfirmed: isTransactionConfirmed,
          confirmations,
          actualGasCost,
          executionError,
          revertError,
          miningTimestamp,
          minedTimestamp,
          ...([ExecutionStatus.MINED_FAIL, ExecutionStatus.FAILED].includes(
            executionStatus,
          )
            ? { simulationTransactionData }
            : {}),
        };

        if (txReceiptError.isError === true) {
          if (txReceiptError.isTxDropped === true) {
            // If there is a txDrop issue ? The txHash no longer has any on chain submission. So we mark the tx as failed and update the error message
            explorerResponse.executionStatus = ExecutionStatus.FAILED;
            explorerResponse.executionError = txReceiptError.errorMessage;
          }

          // If its any other error, it is purely considered as RPC error and do nothing.
          // In worst case, the confirmations will not be updated from RPC call and the tx will stay isConfirmed false until the RPC issue is fixed.
        }

        return explorerResponse;
      }),
    );

    return {
      itxHash: hash,
      node,
      commitment,
      paymentInfo,
      fundingTransaction: trigger,
      userOps: userOpInfo,
    };
  }

  isVersionConsistentAndAboveTarget(
    targetVersion: MeeVersionsType,
    meeVersions: MeeVersionWithChainIdsType = [],
  ) {
    let res = false;

    if (meeVersions && meeVersions.length > 0) {
      res = semver.gte(meeVersions[0].version.version, targetVersion);

      // If more than one mee version is there, make sure all the mee versions are consistent
      if (meeVersions.length > 1) {
        const isValidMeeVersions = meeVersions.every((meeVersionInfo) => {
          if (res) {
            // All versions must be greater than or equal to target version
            return semver.gte(meeVersionInfo.version.version, targetVersion);
          }
          // All versions must be less than target version
          return semver.lt(meeVersionInfo.version.version, targetVersion);
        });

        if (!isValidMeeVersions) {
          throw new BadRequestException(
            `Can't mix the MEE versions less than ${targetVersion} and greater than or equal to ${targetVersion}`,
          );
        }
      }
    }

    return res;
  }
}
