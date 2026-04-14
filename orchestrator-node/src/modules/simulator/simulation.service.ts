import { ChainsService } from "@/chains";
import { BadRequestException, packUint128Pair, withTrace } from "@/common";
import { SmartSessionsAbi } from "@/contracts/resources/SmartSessionsAbi";
import { TokenWithPermitAbi } from "@/contracts/resources/erc20-with-permit";
import { type ConfigType, InjectConfig } from "@/core/config";
import { Logger } from "@/core/logger";
import {
  type CalldataType,
  type ComposableCall,
  EncoderAndDecoderService,
} from "@/encoder-and-decoder";
import { EntryPointService } from "@/entry-point";
import {
  GAS_ESTIMATION_LOOKUP_TABLE,
  GasEstimatorServiceV2,
  NONCE_VALIDATION_AND_UPDATION_GAS_LIMIT,
} from "@/gas-estimator";
import { gasEstimatorConfig } from "@/gas-estimator/gas-estimator.config";
import { NodeService } from "@/node";
import { PaymentInfo } from "@/payment";
import {
  MeeVersionWithChainIdsType,
  MeeVersionsType,
  type QuoteType,
  type TriggerType,
} from "@/quotes";
import { RpcManagerService } from "@/rpc-manager";
import {
  type GrantPermissionResponseType,
  Session,
  SmartSessionMode,
} from "@/sessions";
import { StorageService } from "@/storage";
import { TokenSlotDetectionService } from "@/token-slot-detection";
import {
  type EIP7702Auth,
  MeeUserOpRequest,
  SignedPackedUserOp,
  UserOp,
  UserOpService,
  packUserOp,
} from "@/user-ops";
import { getMeeUserOpHashEip712 } from "@/user-ops/utils/hash-mee-userop";
import { encodeSmartSessionSignature } from "@rhinestone/module-sdk";
import semver from "semver";
import { Service } from "typedi";
import {
  type Call,
  type Hex,
  type StateOverride,
  concatHex,
  decodeFunctionData,
  encodeAbiParameters,
  encodeFunctionData,
  erc20Abi,
  hexToBigInt,
  isAddressEqual,
  parseEther,
  parseSignature,
  toHex,
  zeroAddress,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { multicall } from "viem/actions";
// Don't import this from "@quotes" alone, it is causing the circular dependency issue
import { SUPERTX_MEEUSEROP_STRUCT_TYPEHASH } from "../quotes/constants";
import {
  type CustomOverride,
  type EIP712DomainReturn,
  type Overrides,
  PrepareSimulationUserOpsParams,
  type SimulationResult,
  SimulationUserOp,
  type TokenOverride,
} from "./interfaces";
import { resolveStateOverrides } from "./utils";

@Service()
export class SimulationService {
  constructor(
    private readonly userOpService: UserOpService,
    private readonly gasEstimatorService: GasEstimatorServiceV2,
    private readonly encoderAndDecoderService: EncoderAndDecoderService,
    private readonly entryPointService: EntryPointService,
    private readonly storageService: StorageService,
    private readonly nodeService: NodeService,
    private readonly tokenSlotDetectionService: TokenSlotDetectionService,
    private readonly rpcManagerService: RpcManagerService,
    private readonly chainsService: ChainsService,
    @InjectConfig(gasEstimatorConfig)
    private readonly gasEstimatorConfiguration: ConfigType<
      typeof gasEstimatorConfig
    >,
    private readonly logger: Logger,
  ) {
    logger.setCaller(SimulationService);
  }

  getEIP712DummySignature(
    lowerBoundTimestamp: number,
    upperBoundTimestamp: number,
    meeUserOpHashes: Hex[],
    isTrustedSponsorship: boolean,
    userOpIndex: number,
    sessionInfo?: {
      sessionDetails: GrantPermissionResponseType;
      smartSessionMode: "ENABLE_AND_USE" | "USE";
    },
  ) {
    // For trusted sponsorship, as we're ignoring the payment userOp, index should be sub by 1 to account for that
    // for all the userOps except the payment userOp itself
    // The payment userOp itself won't be simulated anyways so its index doesn't matter
    let index = userOpIndex;
    if (isTrustedSponsorship && userOpIndex > 0) {
      index = userOpIndex - 1;
    }

    // Dummy 65 bytes supertransaction signature
    // Some random, but cryptographically valid Secp256k1 signature
    const dummyStxSig =
      "0xcae0d1955b99d4832aef73ed0a2237045fad91a738ee5b96ba76b9a12ffc6f824ab2ecaeeeb903b50704fdf4a5d64216adf7d6aaaca0ed2a67b86d8525c4b4bb1c" as Hex;

    if (sessionInfo?.sessionDetails) {
      const dummySignature = concatHex([
        "0x177eee00", // Simple signature type
        encodeAbiParameters(
          [
            { type: "bytes32" }, // stxStructTypeHash
            { type: "uint256" }, // userOp index
            { type: "bytes32[]" }, // meeUserOpHashes - array of hashes
            { type: "bytes" }, // superTxSignature
          ],
          [
            SUPERTX_MEEUSEROP_STRUCT_TYPEHASH,
            BigInt(index),
            // If it is a trusted sponsorship, the payment userop can be skipped because it is not going to be executed at all.
            isTrustedSponsorship ? meeUserOpHashes.slice(1) : meeUserOpHashes,
            dummyStxSig,
          ],
        ),
      ]);

      const dummySessionDetails: GrantPermissionResponseType = {
        ...sessionInfo?.sessionDetails,
        mode:
          sessionInfo.smartSessionMode === "ENABLE_AND_USE"
            ? SmartSessionMode.UNSAFE_ENABLE
            : SmartSessionMode.USE,
        signature: dummySignature,
      };

      return encodeSmartSessionSignature(dummySessionDetails);
    }

    const dummySignature = concatHex([
      "0x177eee00", // Simple signature type
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
          BigInt(index),
          // If it is a trusted sponsorship, the payment userop can be skipped because it is not going to be executed at all.
          isTrustedSponsorship ? meeUserOpHashes.slice(1) : meeUserOpHashes,
          dummyStxSig,
          hexToBigInt(
            packUint128Pair(lowerBoundTimestamp, upperBoundTimestamp),
          ),
        ],
      ),
    ]);

    return dummySignature;
  }

  getDummySignature(
    lowerBoundTimestamp: number,
    upperBoundTimestamp: number,
    sessionInfo?: {
      sessionDetails: GrantPermissionResponseType;
      smartSessionMode: "ENABLE_AND_USE" | "USE";
    },
  ) {
    if (sessionInfo?.sessionDetails) {
      // Short encoded signature
      const dummySignature = concatHex([
        "0x177eee00",
        encodeAbiParameters(
          [{ type: "bytes32" }, { type: "bytes32[]" }, { type: "bytes" }],
          [
            "0xf9ac010d622ece2ccd437cfbfe0bc54cc7978fd1b616d67f6c9cb2aa01af60c1",
            [
              "0xc16771b47ae21ccd6bf5ebeb5adef5e5c3aa1e3bda62e142ddfa263bc9160f5d",
            ],
            "0x70ce3622528aac3d0b5006eccd2f472967e6d83b3912912c3b586e44212b65be1bece24a3d176f537cbd4e46a7bf729a765bb976c2d8524a096b82fc0feb5af51b",
          ],
        ),
      ]);

      const dummySessionDetails: GrantPermissionResponseType = {
        ...sessionInfo?.sessionDetails,
        mode:
          sessionInfo.smartSessionMode === "ENABLE_AND_USE"
            ? SmartSessionMode.UNSAFE_ENABLE
            : SmartSessionMode.USE,
        signature: dummySignature,
      };

      return encodeSmartSessionSignature(dummySessionDetails);
    }

    return concatHex([
      "0x177eee00",
      encodeAbiParameters(
        [
          { type: "bytes32" },
          { type: "uint48" },
          { type: "uint48" },
          { type: "bytes32[]" },
          { type: "bytes" },
        ],
        [
          "0x2993775d52ce4ca8ee89cdd7eeba49a4d21431cd2bc63a275da53591f7fa63f1",
          lowerBoundTimestamp,
          upperBoundTimestamp,
          [
            "0x2cd97ddd68ee183a99f36ff3591820b4f7e055014186a2ec47c1d5912ece4437",
          ],
          "0xabe069247e639371587ba404101d0cb952f3780f4ceca9d2466f4dd745d1570e60b0b3318ab8438c57eac7fb224580cfe461e98281c82984b2e68535635ae4291b",
        ],
      ),
    ]);
  }

  async getTokenBalanceOverride(
    tokenOverride: TokenOverride,
  ): Promise<StateOverride> {
    // If it is native token, the state overrides will override native token balance
    if (tokenOverride.tokenAddress === zeroAddress) {
      return [
        {
          address: tokenOverride.accountAddress,
          balance: tokenOverride.balance,
        },
      ];
    }

    const storageSlot =
      await this.tokenSlotDetectionService.getBalanceStorageSlot(
        tokenOverride.tokenAddress,
        tokenOverride.accountAddress,
        tokenOverride.chainId,
      );

    return [
      {
        address: tokenOverride.tokenAddress,
        stateDiff: [
          {
            slot: storageSlot,
            value: toHex(tokenOverride.balance, { size: 32 }),
          },
        ],
      },
    ];
  }

  getCustomOverride(customOverride: CustomOverride): StateOverride {
    return [
      {
        address: customOverride.contractAddress,
        stateDiff: [
          {
            slot: customOverride.storageSlot,
            value: customOverride.value,
          },
        ],
      },
    ];
  }

  decodeCalldata(encodedCalldata: Hex): {
    calls: Call[] | ComposableCall[];
    calldataType: CalldataType;
  } {
    try {
      const calls =
        this.encoderAndDecoderService.decodeBatchCalldata(encodedCalldata);
      return { calls, calldataType: "batch-call" };
    } catch {}

    try {
      const calls =
        this.encoderAndDecoderService.decodeComposableCalldata(encodedCalldata);
      return { calls, calldataType: "composable-call" };
    } catch {}

    throw new BadRequestException(
      "Simulation failed, Failed to decode the calldata.",
    );
  }

  removeCallFromCalldata(encodedCalldata: Hex, indexToRemove: number): Hex {
    let calls: Call[] | ComposableCall[] = [];
    let calldataType: CalldataType = "batch-call";

    try {
      const decodedCalldata = this.decodeCalldata(encodedCalldata);

      calls = decodedCalldata.calls;
      calldataType = decodedCalldata.calldataType;
    } catch (error) {
      this.logger.error(
        { error },
        "Failed to simulate and estimate gas for userOps. Error: Calldata decoding failed",
      );
      throw new BadRequestException(
        "Failed to simulate and estimate gas for userOps. Error: Calldata decoding failed",
      );
    }

    if (indexToRemove < 0 || indexToRemove >= calls.length) {
      throw new BadRequestException(
        "Failed to simulate and estimate gas for userOps. Unable to modify calldata",
      );
    }

    // If the fusion transaction is being simulated without batching ? The transferFrom EOA to Nexus will be
    // just one instructions in the userOp. So removing this instruction will have emtpy calldata which is invalid
    if (calls.length === 1) {
      throw new BadRequestException(
        "Failed to simulate and estimate gas for userOps. Supertransaction which includes funding instruction should always use batching.",
      );
    }

    const updatedExecutionsCalls = [
      ...calls.slice(0, indexToRemove),
      ...calls.slice(indexToRemove + 1),
    ];

    try {
      switch (calldataType) {
        case "batch-call":
          return this.encoderAndDecoderService.encodeBatchCallData(
            updatedExecutionsCalls as Call[],
          );
        case "composable-call":
          return this.encoderAndDecoderService.encodeComposableCalldata(
            updatedExecutionsCalls as ComposableCall[],
          );
        default:
          throw new BadRequestException(
            "Simulation failed, invalid calldata type",
          );
      }
    } catch (error) {
      this.logger.error(
        { error },
        "Failed to simulate and estimate gas for userOps. Error: Calldata encoding failed",
      );
      throw new BadRequestException(
        "Failed to simulate and estimate gas for userOps. Error: Calldata encoding failed",
      );
    }
  }

  preparePackedUserOpForSimulation(
    params: PrepareSimulationUserOpsParams,
  ): SimulationUserOp {
    const {
      userOpRequest,
      quoteType,
      paymentInfo,
      isTrustedSponsorship,
      trigger,
      isAccountDeploymentRequired = false,
      initCode: initCode_,
      eip7702Auth: eip7702Auth_,
      isTriggerTokenPullUserOp = false,
      triggerTokenPullGasLimit,
      tokenPermitGasLimit,
      isPaymentUserOp = false,
      isSponsored = false,
      sessionDetails,
      smartSessionMode = "USE",
    } = params;

    let additionalCallGasLimitsToAdd = 0n;
    let additionalVerificationGasLimitsToAdd = 0n;

    const paymasterAndData = this.userOpService.getPaymasterAndData(
      paymentInfo,
      isTrustedSponsorship,
      userOpRequest.chainId,
    );

    let initCode = initCode_;
    let eip7702Auth = eip7702Auth_;

    // If the user's smart account is not deployed and needs to be deployed with sponsorship mode ?
    // The init code or EIP 7702 auth will be added to main userOps and no need to have init code or auth for payment userOp during simulation
    if (isSponsored && isPaymentUserOp) {
      initCode = "0x";
      eip7702Auth = undefined;
    }

    const {
      batcher: { batchGasLimit },
    } = this.chainsService.getChainSettings(userOpRequest.chainId);

    // Default vgl & cgl for simulation, this can be anything sufficient and doesn't matter much
    let verificationGasLimit = 1_000_000n;
    const callGasLimit = batchGasLimit || 8_000_000n;

    if (sessionDetails) {
      // For sessions, default gas limits must be high enough to avoid AA26 during simulateHandleOp.
      // Tight gas limits will be used after simulation.
      verificationGasLimit =
        smartSessionMode === "ENABLE_AND_USE" ? 6_000_000n : 5_000_000n;
    }

    let calldata = userOpRequest.callData;

    const isFusionMode = quoteType !== "simple";

    // If it is fusion mode and trigger token pull userOp ? There will be tranferFrom instruction to claim
    // the token into nexus. We will remove this transferFrom and override the token balance for simulation.
    if (
      isFusionMode &&
      isTriggerTokenPullUserOp &&
      trigger &&
      trigger.tokenAddress !== zeroAddress
    ) {
      calldata = this.removeCallFromCalldata(userOpRequest.callData, 0);

      // As we are removing this transfer call ? The simulation will not account for transfer gas limit
      // so this needs to be manually added to simulation gas limit
      additionalCallGasLimitsToAdd +=
        triggerTokenPullGasLimit ||
        BigInt(this.gasEstimatorConfiguration.tokenTransferGasLimit);
    }

    const unpackedUserOp: UserOp = {
      sender: userOpRequest.sender,
      nonce: userOpRequest.nonce,
      ...(eip7702Auth ? { initCode: "0x" } : { initCode: initCode || "0x" }),
      callData: calldata,
      callGasLimit,
      verificationGasLimit,
      // pvg is not important for simulation. pvg will be also added into preOpGas value during simulation so we are skipping this always here
      preVerificationGas: 0n,
      maxFeePerGas: 1n, // This is intentially setting as 1 wei just for simulation
      maxPriorityFeePerGas: 1n, // This is intentially setting as 1 wei just for simulation
      paymasterAndData,
    };

    // We don't have to consider 7702 auth, because if auth exists ? no deployment is required
    // If 7702 auth exists, initCode will be always 0x
    const isDeploymentRequired =
      isAccountDeploymentRequired && unpackedUserOp.initCode !== "0x";

    // Permit will be only true in two cases
    // 1. Fusion mode + non sponsored + payment userOp
    // 2. Fusion mode + sponsorhed + first token pull userOp
    const isPermitRequired =
      (!isSponsored && isFusionMode && isPaymentUserOp) ||
      (isSponsored && isFusionMode && isTriggerTokenPullUserOp);

    // For permit mode, we simulate the permit function based on token implementation and add the gas limit to the estimations
    // As the dummy sig is always simple mode, simulation will never consider the permit gas limits and that's why we are adding this.
    if (isPermitRequired) {
      additionalVerificationGasLimitsToAdd += tokenPermitGasLimit;
    }

    // Redeem delegation will be only true in two cases
    // 1. Fusion mode + non sponsored + payment userOp
    // 2. Fusion mode + sponsorhed + first token pull userOp
    const isRedeemDelegationRequired =
      (!isSponsored && isFusionMode && isPaymentUserOp) ||
      (isSponsored && isFusionMode && isTriggerTokenPullUserOp);

    // Safe execution will be only true in two cases (same as redeem delegation)
    // 1. Fusion mode + non sponsored + payment userOp
    // 2. Fusion mode + sponsored + first token pull userOp
    const isSafeExecutionRequired =
      (!isSponsored && isFusionMode && isPaymentUserOp) ||
      (isSponsored && isFusionMode && isTriggerTokenPullUserOp);

    const gasEstimationLookupKey =
      this.gasEstimatorService.getGasEstimationLookupKey({
        quoteType,
        isPermitRequired,
        isRedeemDelegationRequired,
        isSafeExecutionRequired,
      });

    const precalculatedGasEstimation =
      GAS_ESTIMATION_LOOKUP_TABLE[gasEstimationLookupKey];

    if (!precalculatedGasEstimation) {
      throw new BadRequestException(
        "Failed to fetch gas estimations from gas estimation table",
      );
    }

    const packedUserOp = packUserOp(unpackedUserOp);

    return {
      packedUserOp,
      isSponsoredPaymentUserOp: isSponsored && isPaymentUserOp,
      isTrustedSponsorship,
      eip7702Auth,
      chainId: userOpRequest.chainId,
      precalculatedGasEstimation,
      isDeploymentRequired,
      additionalCallGasLimitsToAdd,
      additionalVerificationGasLimitsToAdd,
      sessionDetails,
      smartSessionMode,
      overrides: params.userOpRequest.simulationOverrides,
    };
  }

  async simulateAndEstimateUserOpGas(
    simulationUserOps: SimulationUserOp[],
    overrides: Overrides,
    meeVersions: MeeVersionWithChainIdsType = [],
  ) {
    const { tokenOverrides, customOverrides } = overrides;

    const lowerBoundTimestamp = Math.floor(Date.now() / 1000);
    const upperBoundTimestamp = Math.floor(Date.now() / 1000) + 300; // 5 mins

    const meeUserOpHashes: Hex[] = [];

    for (const {
      packedUserOp,
      chainId,
      isSponsoredPaymentUserOp,
      isTrustedSponsorship,
    } of simulationUserOps) {
      const isTrustedPaymentUserOp =
        isSponsoredPaymentUserOp && isTrustedSponsorship;

      const packedUserOpHash =
        this.userOpService.getPackedUserOpHash(packedUserOp);

      const userOpHash = this.userOpService.getEntryPointV7UserOpHash(
        chainId,
        packedUserOpHash,
        // The randomUserOpHash generated for trusted payment userOp here is different from the one generated for the final quote. However, that not a big deal
        // because this is only used for simulation and estimation with dummy signature
        { generateRandomHash: isTrustedPaymentUserOp },
      );

      const meeUserOpHash = getMeeUserOpHashEip712(
        userOpHash,
        lowerBoundTimestamp,
        upperBoundTimestamp,
      );

      meeUserOpHashes.push(meeUserOpHash);
    }

    return await Promise.all(
      simulationUserOps.map(async (simUserOp, userOpIndex) => {
        const {
          chainId,
          packedUserOp,
          isSponsoredPaymentUserOp,
          isTrustedSponsorship,
          eip7702Auth,
          isDeploymentRequired,
          precalculatedGasEstimation,
          additionalCallGasLimitsToAdd,
          additionalVerificationGasLimitsToAdd,
          sessionDetails,
          smartSessionMode = "USE",
          overrides: userOpOverrides,
        } = simUserOp;

        // If it is a trusted sponsorship and payment userOp ? No need for simulation and return zero values early
        if (isSponsoredPaymentUserOp && isTrustedSponsorship) {
          return {
            userOpIndex,
            chainId,
            simulationResult: {
              revert: false,
              revertReason: "",
              verificationGasLimit: 0n,
              callGasLimit: 0n,
            },
          };
        }

        // use userOp overrides if present, otherwise use global overrides
        const userOpTokenOverrides =
          userOpOverrides?.tokenOverrides || tokenOverrides;
        const userOpCustomOverrides =
          userOpOverrides?.customOverrides || customOverrides;
        const stateOverrides: StateOverride = [];

        if (userOpTokenOverrides.length > 0) {
          const tokenOverridePromises = userOpTokenOverrides
            .filter((tokenOverride) => tokenOverride.chainId === chainId)
            .map((tokenOverride) =>
              this.getTokenBalanceOverride(tokenOverride),
            );
          const allOverrides = await Promise.all(tokenOverridePromises);
          for (const override of allOverrides) {
            stateOverrides.push(...override);
          }
        }

        if (userOpCustomOverrides.length > 0) {
          for (const customOverride of userOpCustomOverrides) {
            if (customOverride.chainId === chainId) {
              stateOverrides.push(...this.getCustomOverride(customOverride));
            }
          }
        }

        let dummySignature = "0x" as Hex;

        const [meeVersionInfo] = meeVersions.filter(
          (info) => info.chainId === chainId,
        );

        // Default static version will be always 2.0.0
        let meeVersion: MeeVersionsType = "2.0.0";

        // From this version, the EIP712 signatures are being supported and the dummy signature needs to be different here
        const eip712SignatureVersionTarget: MeeVersionsType = "2.2.0";

        if (meeVersionInfo) {
          meeVersion = meeVersionInfo.version.version;
        }

        if (isSponsoredPaymentUserOp) {
          // If the payment userOp is sponsored, the mee version is always 2.0.0
          meeVersion = "2.0.0";
        }

        if (semver.lt(meeVersion, eip712SignatureVersionTarget)) {
          dummySignature = this.getDummySignature(
            lowerBoundTimestamp,
            upperBoundTimestamp,
            sessionDetails ? { sessionDetails, smartSessionMode } : undefined,
          );
        } else {
          dummySignature = this.getEIP712DummySignature(
            lowerBoundTimestamp,
            upperBoundTimestamp,
            meeUserOpHashes,
            isTrustedSponsorship,
            userOpIndex,
            sessionDetails ? { sessionDetails, smartSessionMode } : undefined,
          );
        }

        const signedPackedUserOp: SignedPackedUserOp = {
          ...packedUserOp,
          signature: dummySignature,
        };

        this.logger.trace(
          { chainId, userOpIndex },
          "Userops simulation and gas estimation debugTraceCall started",
        );

        const { simulationFailed, simulationResult, errorMessage } =
          await this.entryPointService.simulateSimulateHandleOpWithDebugTraceCall(
            signedPackedUserOp,
            chainId,
            this.nodeService.address,
            eip7702Auth,
            resolveStateOverrides(stateOverrides),
            { callFrom: "Simulation and gas estimation phase" },
          );

        let additionalSessionEnableVerifcationGasLimit = 0n;

        try {
          // Enable sessions function selector
          const ENABLE_SESSIONS_FUNTION_SELECTOR = "0x21712407";

          const isEnableSessionsFlow = signedPackedUserOp.callData.includes(
            ENABLE_SESSIONS_FUNTION_SELECTOR.slice(2),
          );

          if (isEnableSessionsFlow) {
            const calls = this.decodeCalldata(signedPackedUserOp.callData);

            const [enableSessionsCalls] = calls.calls.filter(
              (call) =>
                (call as ComposableCall).functionSig ===
                ENABLE_SESSIONS_FUNTION_SELECTOR,
            );

            const enableSessionCalldata = (
              (enableSessionsCalls as ComposableCall)
                .inputParams[0] as unknown as [number, Hex]
            )[1];

            const { args } = decodeFunctionData({
              abi: SmartSessionsAbi,
              data: `${ENABLE_SESSIONS_FUNTION_SELECTOR}${enableSessionCalldata.slice(2)}`,
            });

            const [sessions] = args as Session[][];
            if (sessions) {
              for (const session of sessions) {
                for (const action of session.actions) {
                  // Add additional 5K gas for each policies in actions to ensure more vgl for bulk enable permissions
                  additionalSessionEnableVerifcationGasLimit +=
                    BigInt(action.actionPolicies.length) * 5000n;
                }
              }
            }
          }
        } catch (error) {
          this.logger.trace(
            {
              error,
            },
            "Failed to calculate additional verification gas limit for enable sessions flow",
          );
        }

        this.logger.trace(
          {
            simulationFailed,
            simulationResult,
            errorMessage,
            chainId,
            userOpIndex,
          },
          "Userops simulation and gas estimation debugTraceCall result",
        );

        this.logger.trace(
          { chainId, userOpIndex },
          "Userops simulation and gas estimation debugTraceCall ended",
        );

        if (simulationFailed || !simulationResult) {
          return {
            userOpIndex,
            chainId,
            simulationResult: {
              revert: true,
              revertReason: errorMessage || "Simulation failed",
              verificationGasLimit: 0n,
              callGasLimit: 0n,
            },
          };
        }

        let callGasLimit = 0n;
        let verificationGasLimit = 0n;

        try {
          // callGasLimit calculations
          callGasLimit += simulationResult.gasLimits.innerHandleOpGasLimit;

          // During simulation, sometime we remove token pull instruction. To account for those cases, we will add these additional
          // gas limits here which covers the token pull instructions
          callGasLimit += additionalCallGasLimitsToAdd;

          // verificationGasLimit calculations
          // In smart session mode, there will be no account deployment happens here. Because the prepare permission sprtx will fund and deploy the account prior to using the sessions
          if (sessionDetails) {
            const isEnableAndUseMode =
              sessionDetails.mode === SmartSessionMode.UNSAFE_ENABLE;

            if (isEnableAndUseMode) {
              // Calculated directly from the simulation result
              verificationGasLimit += simulationResult.preOpGas;
            } else {
              try {
                // Calculation w.r.t static and dynamic gas limits based on policies and callType
                verificationGasLimit +=
                  this.gasEstimatorService.getSmartSessionUseModeVerificationGasLimit(
                    packedUserOp.callData,
                    sessionDetails,
                  );
              } catch (error) {
                this.logger.error(
                  { error },
                  "Failed to calculate Smart session USE mode verification gas limit",
                );

                // If incase the use mode gas calculation fails due to any unhandled cases, the node will use default overestimation gas limit
                // Default high over estimation for Use mode
                verificationGasLimit += 250_000n;
              }
            }
          } else {
            const createSenderGasLimit =
              simulationResult.gasLimits.accountDeploymentGasLimit;

            // calculation based on lookup table
            const { validateUserOpGasLimit } = precalculatedGasEstimation;

            // formula: vgl = createSenderGasLimit + validateUserOpGasLimit
            verificationGasLimit =
              createSenderGasLimit + validateUserOpGasLimit;

            // If deployment is not required but simulation result has a createSender gas limit ? The deployment is forceful for simulation and we need to exclude this gaslimit
            if (!isDeploymentRequired && createSenderGasLimit !== 0n) {
              verificationGasLimit -= createSenderGasLimit;
            }

            // Dynamic permit activation gas limit will be added here if it is necessary
            verificationGasLimit += additionalVerificationGasLimitsToAdd;
          }

          // All the userOps will have nonce validation and updation, so this gas limit needs to be added to vgl
          verificationGasLimit += NONCE_VALIDATION_AND_UPDATION_GAS_LIMIT;
        } catch (error) {
          this.logger.error(
            { error },
            "Failed to estimate gas limits for supertransaction",
          );
          throw new BadRequestException(
            "Failed to estimate gas limits for supertransaction",
          );
        }

        if (callGasLimit <= 0n || verificationGasLimit <= 0n) {
          this.logger.error(
            { callGasLimit, verificationGasLimit },
            "Invalid gas limits estimated by simulation",
          );
          throw new BadRequestException(
            "Failed to estimate gas limits for supertransaction",
          );
        }

        const { simulationGasLimitBuffers } =
          this.chainsService.getChainSettings(chainId);

        // Chain specific verification and call gas limit buffers to handle any special cases.
        if (simulationGasLimitBuffers.callGasLimit)
          callGasLimit += simulationGasLimitBuffers.callGasLimit;

        if (simulationGasLimitBuffers.verificationGasLimit)
          verificationGasLimit +=
            simulationGasLimitBuffers.verificationGasLimit;

        verificationGasLimit += additionalSessionEnableVerifcationGasLimit;

        return {
          userOpIndex,
          chainId,
          simulationResult: {
            revert: false,
            revertReason: "",
            verificationGasLimit: (verificationGasLimit * 110n) / 100n, // 10% buffer for overestimation and safety
            callGasLimit: (callGasLimit * 110n) / 100n, // 10% buffer for overestimation and safety,
          },
        };
      }),
    );
  }

  async calculateTokenPullTransferGasLimit(
    trigger: TriggerType,
  ): Promise<bigint> {
    const tokenTransferGasLimitCacheKey = `transfer-gas-limit::${trigger.tokenAddress}::${trigger.chainId}`;

    const cacheInfo = await this.storageService.getCache<{ gasLimit: bigint }>(
      tokenTransferGasLimitCacheKey,
    );

    let tokenPullTransferGasLimit = 0n;

    if (cacheInfo) {
      tokenPullTransferGasLimit = cacheInfo.gasLimit;
    } else {
      try {
        const sender = privateKeyToAccount(generatePrivateKey());
        const recipient = privateKeyToAccount(generatePrivateKey());

        const amount = 1n;

        const data = encodeFunctionData({
          abi: erc20Abi,
          functionName: "transfer",
          args: [recipient.address, amount],
        });

        const nativeTokenOverride = await this.getTokenBalanceOverride({
          tokenAddress: zeroAddress,
          accountAddress: sender.address,
          chainId: trigger.chainId,
          balance: parseEther("0.1"),
        });

        const erc20TokenOverride = await this.getTokenBalanceOverride({
          tokenAddress: trigger.tokenAddress,
          accountAddress: sender.address,
          chainId: trigger.chainId,
          balance: amount,
        });

        const gasLimit = await withTrace(
          "simulation.triggerTokenPullGasEstimation",
          async () =>
            await this.rpcManagerService.executeRequest(
              trigger.chainId,
              (chainClient) => {
                return chainClient.estimateGas({
                  to: trigger.tokenAddress,
                  data,
                  account: sender,
                  blockTag: "latest",
                  stateOverride: [
                    ...nativeTokenOverride,
                    ...erc20TokenOverride,
                  ],
                });
              },
            ),
          {
            chainId: trigger.chainId,
            tokenAddress: trigger.tokenAddress,
          },
        )();

        // Adding 25% extra gas limit to cover the gas difference between transfer and transferFrom
        tokenPullTransferGasLimit = (gasLimit * 125n) / 100n;

        this.storageService.setCache(tokenTransferGasLimitCacheKey, {
          gasLimit: tokenPullTransferGasLimit,
        });
      } catch (error) {
        this.logger.error(
          { trigger, error },
          "Trigger token transfer gas limit estimation failed",
        );
        tokenPullTransferGasLimit = BigInt(
          this.gasEstimatorConfiguration.tokenTransferGasLimit,
        );
      }
    }

    return tokenPullTransferGasLimit;
  }

  async calculateTokenPermitGasLimit(trigger: TriggerType) {
    const tokenPermitGasLimitCacheKey = `token-permit-gas-limit::${trigger.tokenAddress}::${trigger.chainId}`;

    const cacheInfo = await this.storageService.getCache<{ gasLimit: bigint }>(
      tokenPermitGasLimitCacheKey,
    );

    let tokenPermitGasLimit = 0n;

    if (cacheInfo) {
      tokenPermitGasLimit = cacheInfo.gasLimit;
    } else {
      try {
        const owner = privateKeyToAccount(generatePrivateKey());
        const spender = privateKeyToAccount(generatePrivateKey());

        const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);
        const amount = 1n;

        const baseParams = {
          address: trigger.tokenAddress,
          abi: TokenWithPermitAbi,
        };

        // This code is taken from the AbstractJs SDK (github.com/bcnmy/abstractjs). The SDK can be installed and reused but copying this small chunk avoids additional dependencies
        // Fetch required token data for EIP-712 domain and permit using multicall
        const values = await withTrace(
          "simulation.fetchPermitValues",
          async () =>
            await this.rpcManagerService.executeRequest(
              trigger.chainId,
              (chainClient) => {
                return multicall(chainClient, {
                  contracts: [
                    {
                      ...baseParams,
                      functionName: "nonces",
                      args: [owner.address],
                    },
                    {
                      ...baseParams,
                      functionName: "name",
                    },
                    {
                      ...baseParams,
                      functionName: "version",
                    },
                    {
                      ...baseParams,
                      functionName: "DOMAIN_SEPARATOR",
                    },
                    {
                      ...baseParams,
                      functionName: "eip712Domain",
                    },
                  ],
                });
              },
            ),
          {
            chainId: trigger.chainId,
            tokenAddress: trigger.tokenAddress,
          },
        )();

        const [nonce, name, version, _domainSeparator, eip712Domain] =
          values.map((value, i) => {
            const key = [
              "nonce",
              "name",
              "version",
              "domainSeparator",
              "eip712Domain",
            ][i];
            if (value.status === "success") {
              return value.result;
            }
            if (value.status === "failure") {
              if (key === "nonce") {
                // Tokens must implement the nonces function, otherwise we throw a error here
                throw new Error(
                  "Permit signing failed: Token does not implement nonces(). This function is required for EIP-2612 compliance.",
                );
              }

              if (key === "domainSeparator") {
                // Tokens must implement the domainSeparator function, otherwise we throw a error here
                throw new Error(
                  "Permit signing failed: Token does not implement DOMAIN_SEPARATOR(). This function is required for EIP-712 domain separation.",
                );
              }

              if (key === "name" || key === "version") {
                // Some tokens do not implement name and version; defaults to undefined
                return undefined;
              }

              if (key === "eip712Domain") {
                // Some tokens do not implement eip712Domain; default to []
                return [];
              }
            }

            // Fallback return value instead of throwing error
            return undefined;
          }) as [bigint, string, string, Hex, EIP712DomainReturn];

        const [, name_, version_] = eip712Domain;

        // Default version will be used as fallback
        const defaultVersion = "1";

        if (version?.length >= 0 && version_?.length >= 0) {
          if (version !== version_)
            console.warn(
              "Warning: Mismatch between token version() and eip712Domain().version. This may cause permit signature verification to fail.",
            );
        }

        if (name?.length >= 0 && name_?.length >= 0) {
          if (name !== name_)
            console.warn(
              "Warning: Mismatch between token name() and eip712Domain().name. This may cause permit signature verification to fail.",
            );
        }

        if (name === undefined && name_ === undefined) {
          throw new Error(
            "Permit signing failed: Token name is missing. Neither name() nor eip712Domain().name is available.",
          );
        }

        const signablePermitQuotePayload = {
          domain: {
            name: name_ ?? name, // name from eip712Domain is mostly safe and more priority is given
            version: version_ ?? version ?? defaultVersion, // version from eip712Domain is mostly safe and more priority is given
            chainId: Number(trigger.chainId),
            verifyingContract: trigger.tokenAddress,
          },
          types: {
            Permit: [
              { name: "owner", type: "address" },
              { name: "spender", type: "address" },
              { name: "value", type: "uint256" },
              { name: "nonce", type: "uint256" },
              { name: "deadline", type: "uint256" },
            ],
          },
          primaryType: "Permit" as const,
          message: {
            owner: owner.address,
            spender: spender.address,
            value: amount,
            nonce,
            deadline,
          },
        };

        const signature = await owner.signTypedData({
          ...signablePermitQuotePayload,
        });

        const sigComponents = parseSignature(signature);

        const data = encodeFunctionData({
          abi: TokenWithPermitAbi,
          functionName: "permit",
          args: [
            owner.address,
            spender.address,
            amount,
            deadline,
            Number(sigComponents.v) || 27,
            sigComponents.r,
            sigComponents.s,
          ],
        });

        const nativeTokenOverride = await this.getTokenBalanceOverride({
          tokenAddress: zeroAddress,
          accountAddress: owner.address,
          chainId: trigger.chainId,
          balance: parseEther("0.1"),
        });

        const erc20TokenOverride = await this.getTokenBalanceOverride({
          tokenAddress: trigger.tokenAddress,
          accountAddress: owner.address,
          chainId: trigger.chainId,
          balance: amount,
        });

        const gasLimit = await withTrace(
          "simulation.triggerTokenPermitGasEstimation",
          async () =>
            await this.rpcManagerService.executeRequest(
              trigger.chainId,
              (chainClient) => {
                return chainClient.estimateGas({
                  to: trigger.tokenAddress,
                  data,
                  account: owner,
                  blockTag: "latest",
                  stateOverride: [
                    ...nativeTokenOverride,
                    ...erc20TokenOverride,
                  ],
                });
              },
            ),
          {
            chainId: trigger.chainId,
            tokenAddress: trigger.tokenAddress,
          },
        )();

        tokenPermitGasLimit = gasLimit;

        this.storageService.setCache(tokenPermitGasLimitCacheKey, {
          gasLimit: tokenPermitGasLimit,
        });
      } catch (error) {
        this.logger.error(
          { trigger, error },
          "Token permit gas limit estimation failed",
        );

        tokenPermitGasLimit = 100_000n;
      }
    }

    return tokenPermitGasLimit;
  }

  async simulateUserOps(
    quoteType: QuoteType,
    userOpRequests: MeeUserOpRequest[],
    paymentInfo: PaymentInfo,
    isTrustedSponsorship: boolean,
    meeVersions: MeeVersionWithChainIdsType = [],
    trigger?: TriggerType,
    overrides?: Overrides,
  ): Promise<SimulationResult[]> {
    this.logger.trace("Userops simulation and gas estimation started");

    let { tokenOverrides, customOverrides } = overrides || {
      tokenOverrides: [],
      customOverrides: [],
    };

    const uniqueChainIds: string[] = [];
    const initCodeByChainId = new Map<string, Hex>();

    const eip7702AuthByChainId = new Map<string, EIP7702Auth>();

    for (const userOpReq of userOpRequests) {
      if (!uniqueChainIds.includes(userOpReq.chainId)) {
        uniqueChainIds.push(userOpReq.chainId);
      }

      if (
        userOpReq.initCode !== "0x" &&
        !initCodeByChainId.get(userOpReq.chainId)
      ) {
        initCodeByChainId.set(userOpReq.chainId, userOpReq.initCode);
      }

      if (
        userOpReq.eip7702Auth &&
        !eip7702AuthByChainId.get(userOpReq.chainId)
      ) {
        eip7702AuthByChainId.set(userOpReq.chainId, userOpReq.eip7702Auth);
      }
    }

    const simulationUserOps: SimulationUserOp[] = [];

    const timesSeenPerSender: Map<string, number> = new Map();
    const timesSeenPerSenderByPos: number[] = [];
    let firstTriggerUserOpSeen = false;

    for (const userOpRequest of userOpRequests) {
      const accountIdentifier = `${userOpRequest.sender}:${userOpRequest.chainId}`;
      const timesSeen = timesSeenPerSender.get(accountIdentifier) ?? 0;
      timesSeenPerSenderByPos.push(timesSeen);
      timesSeenPerSender.set(accountIdentifier, timesSeen + 1);
    }

    const isFusionMode = quoteType !== "simple";

    this.logger.trace("Prepare simulation userOps started");

    const hasSessionEnableAndUseModeByChainId = new Map<string, boolean>();

    for (const req of userOpRequests) {
      if (
        req.sessionDetails &&
        req.sessionDetails.mode === SmartSessionMode.UNSAFE_ENABLE
      ) {
        hasSessionEnableAndUseModeByChainId.set(req.chainId, true);
      }
    }

    let triggerTokenPullGasLimit = 0n;
    let tokenPermitGasLimit = 0n;

    const triggerTokenPullGasLimitPromise: Promise<bigint> = trigger
      ? this.calculateTokenPullTransferGasLimit(trigger)
      : Promise.resolve(0n);

    const tokenPermitGasLimitPromise: Promise<bigint> =
      trigger && quoteType === "permit"
        ? this.calculateTokenPermitGasLimit(trigger)
        : Promise.resolve(0n);

    const triggerAndPermitGasLimits = await Promise.all([
      triggerTokenPullGasLimitPromise,
      tokenPermitGasLimitPromise,
    ]);

    triggerTokenPullGasLimit = triggerAndPermitGasLimits[0];
    tokenPermitGasLimit = triggerAndPermitGasLimits[1];

    userOpRequests.forEach((userOpReq, index) => {
      let isTriggerTokenPullUserOp = false;

      // Fusion mode, non payment userOp, same trigger chain userOp and first seen one.
      // This contains the token pull instruction which will be removed for simulation later
      if (
        isFusionMode &&
        index !== 0 &&
        trigger?.chainId === userOpReq.chainId &&
        !firstTriggerUserOpSeen
      ) {
        firstTriggerUserOpSeen = true;
        isTriggerTokenPullUserOp = true;
      }

      const simulationUserOp = this.preparePackedUserOpForSimulation({
        userOpRequest: userOpReq,
        quoteType,
        isAccountDeploymentRequired: timesSeenPerSenderByPos[index] === 0,
        isTriggerTokenPullUserOp,
        triggerTokenPullGasLimit,
        tokenPermitGasLimit,
        paymentInfo,
        isTrustedSponsorship,
        trigger,
        initCode: initCodeByChainId.get(userOpReq.chainId) || undefined,
        eip7702Auth: eip7702AuthByChainId.get(userOpReq.chainId) || undefined,
        isSponsored: paymentInfo.sponsored,
        isPaymentUserOp: index === 0,
        sessionDetails: userOpReq.sessionDetails,
        // If one userOp has enable and use ? We need to use enable and use for all the other userOps on same chain for simulation
        smartSessionMode: hasSessionEnableAndUseModeByChainId.get(
          userOpReq.chainId,
        )
          ? "ENABLE_AND_USE"
          : "USE",
      });

      simulationUserOps.push(simulationUserOp);
    });

    this.logger.trace("Prepare simulation userOps ended");

    // Incase of fusion mode, we add overrides automatically for triggers
    if (isFusionMode) {
      if (!trigger) {
        throw new BadRequestException(
          "Trigger funding information is required for fusion mode",
        );
      }

      // If sponsored ? The firstDevUserOp is considered to be a userOp at index=1. In that case index=0 is the gas tank nexus userOp.
      // If not sponsored ? The firstDevUserOp is considered to be a userOp at index=0 - which is the user's SCA address.
      const firstDevUserOp = paymentInfo.sponsored
        ? simulationUserOps[1]
        : simulationUserOps[0];

      const userScaAccountAddress = firstDevUserOp.packedUserOp.sender;

      const triggerTokenOverride: TokenOverride = {
        tokenAddress: trigger.tokenAddress,
        balance: trigger.amount,
        chainId: trigger.chainId,
        accountAddress: trigger.recipientAddress || userScaAccountAddress,
      };

      // update global token overrides to support fusion
      tokenOverrides = this.addOrUpdateTokenOverride(
        tokenOverrides,
        triggerTokenOverride,
      );

      // update userOp token overrides to support fusion
      if (
        firstDevUserOp.overrides?.tokenOverrides &&
        firstDevUserOp.overrides.tokenOverrides.length > 0
      ) {
        firstDevUserOp.overrides.tokenOverrides = this.addOrUpdateTokenOverride(
          firstDevUserOp.overrides.tokenOverrides,
          triggerTokenOverride,
        );
      }

      this.logger.trace(
        { triggerTokenOverride },
        "Trigger token overrides has been added",
      );
    }

    const result = await this.simulateAndEstimateUserOpGas(
      simulationUserOps,
      { tokenOverrides, customOverrides },
      meeVersions,
    );

    this.logger.trace(
      { result },
      "Userops simulation and gas estimation result",
    );

    this.logger.trace("Userops simulation and gas estimation ended");

    return result;
  }

  private addOrUpdateTokenOverride(
    tokenOverrides: TokenOverride[],
    newOverride: TokenOverride,
  ): TokenOverride[] {
    // Attempt to find an existing override with the same tokenAddress and accountAddress
    const existingOverrideIndex = tokenOverrides.findIndex(
      (override) =>
        isAddressEqual(override.tokenAddress, newOverride.tokenAddress) &&
        isAddressEqual(override.accountAddress, newOverride.accountAddress),
    );

    if (existingOverrideIndex !== -1) {
      const updatedOverride = {
        ...tokenOverrides[existingOverrideIndex],
        balance:
          tokenOverrides[existingOverrideIndex].balance + newOverride.balance,
      };
      tokenOverrides[existingOverrideIndex] = updatedOverride;
    } else {
      tokenOverrides.unshift(newOverride);
    }

    return tokenOverrides;
  }
}
