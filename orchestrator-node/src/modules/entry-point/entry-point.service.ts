import { ChainsService, RawStateOverrides } from "@/chains";
import {
  BadRequestException,
  SomethingWentWrongException,
  sanitizeUrl,
  withTrace,
} from "@/common";
import { ContractsService } from "@/contracts";
import { Logger } from "@/core/logger";
import { NodeService } from "@/node";
import { RpcManagerService } from "@/rpc-manager";
import { DEFAULT_GLOBAL_EXPIRATION_TIME, StorageService } from "@/storage";
import {
  type EIP7702Auth,
  type PackedUserOp,
  type SignedPackedMeeUserOp,
  type SignedPackedUserOp,
} from "@/user-ops";
import { Service } from "typedi";
import {
  type Address,
  ContractFunctionExecutionError,
  ContractFunctionRevertedError,
  type Hex,
  type StateOverride,
  type TransactionRequest,
  decodeAbiParameters,
  decodeErrorResult,
  encodeFunctionData,
  fromHex,
  isAddress,
  toHex,
  zeroAddress,
} from "viem";
import { resolveStateOverrides } from "../simulator/utils";
import { simulateHandleOpExecutionResultAbi } from "./constants";
import {
  type AccountValidationData,
  SimulationHandleOpExecutionResult,
  type SimulationOptions,
} from "./interfaces";
import { flatTraceCallResult, unpackAccountValidationData } from "./utils";

@Service()
export class EntryPointService {
  constructor(
    private readonly logger: Logger,
    private readonly chainsService: ChainsService,
    private readonly contractsService: ContractsService,
    private readonly storageService: StorageService,
    private readonly nodeService: NodeService,
    private readonly rpcManagerService: RpcManagerService,
  ) {
    logger.setCaller(EntryPointService);
  }

  decodeSimulateHandleOpOutput(outputData: Hex) {
    try {
      const decoded = decodeAbiParameters(
        simulateHandleOpExecutionResultAbi,
        outputData,
      );

      const executionResult = decoded[0] as SimulationHandleOpExecutionResult;

      return {
        preOpGas: executionResult.preOpGas,
        paid: executionResult.paid,
        accountValidationData: executionResult.accountValidationData,
        paymasterValidationData: executionResult.paymasterValidationData,
        targetSuccess: executionResult.targetSuccess,
        targetResult: executionResult.targetResult,
      };
    } catch (error) {
      throw new BadRequestException("Failed to decode simulateHandleOp output");
    }
  }

  generateErrorMessage(to: Address, output?: Hex) {
    let errorMessage = `Execution reverted at contract ${to}`;

    // Check if output exists and has content
    if (output && output !== "0x") {
      // Extract the error selector (first 4 bytes = 8 hex characters + '0x')
      const selector = output.slice(0, 10);
      errorMessage += ` and reverted with error selector ${selector}`;
    } else {
      // No output or empty output
      errorMessage += " with no error data";
    }

    return errorMessage;
  }

  prepareRawStateOverrides(stateOverrides: StateOverride): RawStateOverrides {
    const overrides: RawStateOverrides = {};

    for (const entry of stateOverrides) {
      const { address, state, stateDiff, balance, ...rest } = entry;

      const formatted: RawStateOverrides[Address] = {
        ...(balance ? { balance: toHex(balance) } : {}),
        ...rest,
      };

      if (state) {
        formatted.state = Object.fromEntries(
          state.map(({ slot, value }) => [slot, value]),
        );
      }

      if (stateDiff) {
        formatted.stateDiff = Object.fromEntries(
          stateDiff.map(({ slot, value }) => [slot, value]),
        );
      }

      overrides[address] = formatted;
    }

    return overrides;
  }

  async simulateSimulateHandleOpWithEthCall(
    userOp: SignedPackedUserOp,
    chainId: string,
    workerAddress: Address,
    eip7702Auth?: EIP7702Auth,
    stateOverrides: StateOverride = [],
    metadata: Record<string, string> = {},
  ) {
    const entryPointV7Abi =
      this.contractsService.getContractAbi("entryPointV7");
    const entryPointV7Address = this.contractsService.getContractAddress(
      "entryPointV7",
      chainId,
    );
    const entryPointV7Code =
      this.contractsService.getContractByteCode("entryPointV7");

    try {
      const authorizationList: EIP7702Auth[] = [];

      if (eip7702Auth) {
        authorizationList.push(eip7702Auth);
      }

      const { simulationOverrides } =
        this.chainsService.getChainSettings(chainId);

      const data = encodeFunctionData({
        abi: entryPointV7Abi,
        functionName: "handleOps",
        args: [[userOp], workerAddress],
      });

      // It is unwanted job to decode userOps for debugging manually
      // So we encode the handleOps log directly so we can easily debug from logs
      const tx: TransactionRequest = {
        from: workerAddress,
        to: entryPointV7Address,
        data,
        ...(authorizationList.length > 0 ? { authorizationList } : {}),
        ...(simulationOverrides.gas ? { gas: simulationOverrides.gas } : {}),
      };

      this.logger.trace(
        {
          txParams: tx,
          stateOverrides,
          ...metadata,
          chainId,
        },
        "simulateSimulateHandleOpWithEthCall transaction params",
      );

      const { result } = await withTrace(
        "entrypoint.simulateSimulateHandleOpWithEthCall",
        async () =>
          await this.rpcManagerService.executeRequest(
            chainId,
            (chainClient) => {
              return chainClient.simulateContract({
                address: entryPointV7Address,
                abi: entryPointV7Abi,
                functionName: "simulateHandleOp",
                args: [{ ...userOp }, zeroAddress, "0x"],
                // If empty authorization list is passed, viem is throwing simulation error. So if no auth is there ? skip it completely
                ...(authorizationList.length > 0 ? { authorizationList } : {}),
                ...(simulationOverrides.gas
                  ? { gas: simulationOverrides.gas }
                  : {}),
                account: workerAddress,
                blockTag: "latest",
                stateOverride: [
                  { address: entryPointV7Address, code: entryPointV7Code },
                  ...stateOverrides,
                ],
              });
            },
          ),
        {
          chainId,
          entryPointV7Address: entryPointV7Address,
          workerAddress,
        },
      )();

      return { simulationResult: result, simulationFailed: false };
    } catch (err) {
      this.logger.error(
        { err },
        "simulateSimulateHandleOpWithEthCall error result",
      );
      let revertedError: ContractFunctionRevertedError | undefined;

      let errorMessage =
        sanitizeUrl((err as Error).message) || "Simulation failed";

      if (
        err instanceof ContractFunctionExecutionError &&
        err?.cause instanceof ContractFunctionRevertedError
      ) {
        revertedError = err.cause;
      }

      if (revertedError?.raw) {
        const { args, errorName } = decodeErrorResult({
          abi: entryPointV7Abi,
          data: revertedError.raw,
        });

        switch (errorName) {
          case "FailedOp": {
            const [, message] = args;
            errorMessage = `${errorName}: ${message}`;
            break;
          }
          case "FailedOpWithRevert": {
            const [, message] = args;
            errorMessage = `${errorName}: ${message}`;
            break;
          }
          default: {
            const [, message] = args;
            if (message) errorMessage = message;
            break;
          }
        }
      }

      return { simulationFailed: true, errorMessage };
    }
  }

  async estimateCallDataGas(
    userOp: PackedUserOp,
    chainId: string,
    eip7702Auth?: EIP7702Auth,
    stateOverrides: StateOverride = [],
  ): Promise<bigint> {
    try {
      const authorizationList: EIP7702Auth[] = [];

      if (eip7702Auth) {
        authorizationList.push(eip7702Auth);
      }

      const epv7 = this.chainsService.getChainContractAddress(
        chainId,
        "entryPointV7",
      );

      this.logger.trace(
        {
          to: userOp.sender,
          data: userOp.callData,
          authorizationList,
          stateOverrides,
        },
        "estimateCallDataGas transaction params",
      );

      const result = await withTrace(
        "entrypoint.estimateCallDataGas",
        async () =>
          await this.rpcManagerService.executeRequest(
            chainId,
            (chainClient) => {
              return chainClient.estimateGas({
                to: userOp.sender,
                data: userOp.callData,
                account: epv7,
                // If empty authorization list is passed, viem is throwing simulation error. So if no auth is there ? skip it completely
                ...(authorizationList.length > 0 ? { authorizationList } : {}),
                stateOverride: stateOverrides,
              });
            },
          ),
        {
          chainId,
        },
      )();

      this.logger.trace({ result }, "estimateCallDataGas result");

      // The buffer can be added when this value is being used. So not need to have buffer here
      return result;
    } catch (error) {
      this.logger.error({ error }, "estimateCallDataGas error result");
      throw new BadRequestException("Failed to estimate call data gas");
    }
  }

  async simulateSimulateHandleOpWithDebugTraceCall(
    userOp: SignedPackedUserOp,
    chainId: string,
    workerAddress: Address,
    eip7702Auth?: EIP7702Auth,
    stateOverrides: StateOverride = [],
    metadata: Record<string, string> = {},
  ) {
    try {
      const authorizationList: EIP7702Auth[] = [];

      if (eip7702Auth) {
        authorizationList.push(eip7702Auth);
      }

      const { simulationOverrides } =
        this.chainsService.getChainSettings(chainId);

      const entryPointV7Abi =
        this.contractsService.getContractAbi("entryPointV7");
      const entryPointV7Address = this.contractsService.getContractAddress(
        "entryPointV7",
        chainId,
      );
      const entryPointV7Code =
        this.contractsService.getContractByteCode("entryPointV7");

      const data = encodeFunctionData({
        abi: entryPointV7Abi,
        functionName: "simulateHandleOp",
        args: [userOp, zeroAddress, "0x"],
      });

      const dataForDebug = encodeFunctionData({
        abi: entryPointV7Abi,
        functionName: "handleOps",
        args: [[userOp], workerAddress],
      });

      const tx: TransactionRequest = {
        from: workerAddress,
        to: entryPointV7Address,
        data,
        // If empty authorization list is passed, viem is throwing simulation error. So if no auth is there ? skip it completely
        ...(authorizationList.length > 0 ? { authorizationList } : {}),
        ...(simulationOverrides.gas ? { gas: simulationOverrides.gas } : {}),
      };

      this.logger.trace(
        {
          txParams: {
            ...tx,
            data: dataForDebug,
          },
          ...metadata,
          stateOverrides,
          chainId,
        },
        "simulateSimulateHandleOpWithDebugTraceCall transaction params",
      );

      const preparedStateOverrides = [
        { address: entryPointV7Address, code: entryPointV7Code },
        ...stateOverrides,
      ];

      const rawStateOverrides = this.prepareRawStateOverrides(
        resolveStateOverrides(preparedStateOverrides),
      );

      const result = await withTrace(
        "entrypoint.simulateSimulateHandleOpWithDebugTraceCall",
        async () =>
          await this.rpcManagerService.executeRequest(
            chainId,
            (chainClient) => {
              return chainClient.debug.traceCall(tx, "latest", {
                tracer: "callTracer",
                stateOverrides: rawStateOverrides,
              });
            },
          ),
        {
          chainId,
          entryPointV7Address: entryPointV7Address,
          workerAddress,
        },
      )();

      let flattenedResult = flatTraceCallResult(result);

      const tracesForGasLimitCalculation = flattenedResult.filter(
        (trace) => trace._depth === 1,
      );

      // Ignore internal reverts which are handled by parent function try catch in solidity
      flattenedResult = flattenedResult.filter((trace) => !trace._shouldIgnore);

      const errCall = flattenedResult.reverse().find((trace) => {
        return (
          (trace.error && trace.error !== "") ||
          (trace.revertReason && trace.revertReason !== "")
        );
      });

      // If there is no error, return false
      if (!errCall) {
        // This fetches the simulateHandleOp trace call result
        const simulateHandleOpTrace = flattenedResult.find(
          (res) => res._depth === 0,
        );

        if (!simulateHandleOpTrace) {
          throw new BadRequestException(
            "Failed to get the simulateHandleOp trace call",
          );
        }

        if (
          !simulateHandleOpTrace.output ||
          simulateHandleOpTrace.output === "0x"
        ) {
          throw new BadRequestException(
            "Failed to get the simulateHandleOp trace call",
          );
        }

        const simulationOutput = simulateHandleOpTrace.output as Hex;

        const simulationResult =
          this.decodeSimulateHandleOpOutput(simulationOutput);

        let accountDeploymentGasLimit = 0n;
        let innerHandleOpGasLimit = 0n;
        let validatePaymasterAndUserOpGasLimit = 0n;

        for (const traceInfo of tracesForGasLimitCalculation) {
          const functionSelector = traceInfo.input.slice(0, 10).toLowerCase();
          const gasUsed = fromHex(traceInfo.gasUsed as Hex, "bigint");

          // validateUserOp doesn't provide a proper gasUsed value. It is very low comparing to the actual one
          // So we don't consider using that here
          switch (functionSelector) {
            // innerHandleOp
            case "0x0042dc53":
              innerHandleOpGasLimit = gasUsed;
              break;
            // createSender
            case "0x570e1a36":
              accountDeploymentGasLimit = gasUsed;
              break;
            // validatePaymasterAndUserOp
            case "0x52b7512c":
              validatePaymasterAndUserOpGasLimit = gasUsed;
              break;
            default:
              break;
          }
        }

        return {
          simulationFailed: false,
          simulationResult: {
            ...simulationResult,
            gasLimits: {
              accountDeploymentGasLimit,
              innerHandleOpGasLimit,
              validatePaymasterAndUserOpGasLimit,
            },
          },
        };
      }

      const { revertReason, error } = errCall;

      this.logger.error(
        {
          errCall,
        },
        "simulateSimulateHandleOpWithDebugTraceCall revert err call",
      );

      let errorMessage =
        revertReason ||
        error ||
        "Unknown error during simulation. Possible 'out of gas' exception.";

      if (errorMessage === "execution reverted") {
        if (isAddress(errCall.to || "")) {
          errorMessage = this.generateErrorMessage(
            errCall.to as Address,
            (errCall.output as Hex) || undefined,
          );
        }
      }

      return { simulationFailed: true, errorMessage };
    } catch (error) {
      this.logger.error({ error }, "simulateHandleOps reverted error result");

      return {
        simulationFailed: true,
        errorMessage: "Error during simulation",
      };
    }
  }

  async simulateSimulateHandleOp(
    meeUserOp: SignedPackedMeeUserOp,
    options: SimulationOptions = { retries: 0, useStorage: false },
  ): Promise<AccountValidationData> {
    const { chainId, meeUserOpHash, eip7702Auth, userOp } = meeUserOp;

    // By default the master EOA will be the worker for simulation. Optionally,
    // other workers can be used for simulation from execution phase
    const workerAddress = options.workerAddress || this.nodeService.address;

    const { simulationFailed, simulationResult, errorMessage } =
      await this.simulateSimulateHandleOpWithEthCall(
        userOp,
        chainId,
        workerAddress,
        eip7702Auth,
        [],
        { meeUserOpHash, callFrom: "Simulator phase" },
      );

    if (simulationFailed) {
      if (options.retries <= 0) {
        throw new SomethingWentWrongException(
          errorMessage || "Simulation failed",
        );
      }

      return await this.simulateSimulateHandleOp(meeUserOp, {
        retries: options.retries - 1,
        useStorage: options.useStorage,
        workerAddress,
      });
    }

    // This should never happen but added to satisfy typescript type error
    if (!simulationResult) {
      throw new SomethingWentWrongException(
        "Failed to fetch simulation result",
      );
    }

    const { sigFailed, validAfter, validUntil } = unpackAccountValidationData(
      simulationResult.accountValidationData,
    );

    if (options.retries <= 0 || sigFailed === 0) {
      return { sigFailed, validAfter, validUntil };
    }

    return await this.simulateSimulateHandleOp(meeUserOp, {
      retries: options.retries - 1,
      useStorage: options.useStorage,
      workerAddress,
    });
  }

  async simulateHandleOps(
    meeUserOp: SignedPackedMeeUserOp,
    options: SimulationOptions = { retries: 0, useStorage: false },
  ): Promise<{ isError: boolean; errorMessage: string }> {
    try {
      const { chainId, eip7702Auth, userOp, meeUserOpHash } = meeUserOp;

      // By default the master EOA will be the worker for simulation. Optionally,
      // other workers can be used for simulation from execution phase
      const workerAddress = options.workerAddress || this.nodeService.address;

      const { simulationOverrides } =
        this.chainsService.getChainSettings(chainId);

      const entryPointV7Abi =
        this.contractsService.getContractAbi("entryPointV7");
      const entryPointV7Address = this.contractsService.getContractAddress(
        "entryPointV7",
        chainId,
      );

      const data = encodeFunctionData({
        abi: entryPointV7Abi,
        functionName: "handleOps",
        args: [[userOp], workerAddress],
      });

      const tx: TransactionRequest = {
        from: workerAddress,
        to: entryPointV7Address,
        data,
        ...(eip7702Auth
          ? {
              authorizationList: [eip7702Auth],
            }
          : {}),
        ...(simulationOverrides.gas ? { gas: simulationOverrides.gas } : {}),
      };

      this.logger.trace(
        {
          txParams: tx,
          meeUserOpHash,
          chainId,
        },
        "simulateHandleOps debug trace call tx params",
      );

      const result = await withTrace(
        "entrypoint.simulateHandleOps",
        async () =>
          await this.rpcManagerService.executeRequest(
            chainId,
            (chainClient) => {
              return chainClient.debug.traceCall(tx);
            },
          ),
        {
          chainId,
          entryPointV7Address: entryPointV7Address,
          workerAddress,
        },
      )();

      let flattenedResult = flatTraceCallResult(result);
      // Ignore internal reverts which are handled by parent function try catch in solidity
      flattenedResult = flattenedResult.filter((trace) => !trace._shouldIgnore);

      const errCall = flattenedResult
        .reverse()
        .find(
          (trace) =>
            (trace.error && trace.error !== "") ||
            (trace.revertReason && trace.revertReason !== ""),
        );

      // If there is no error, return false
      if (!errCall) {
        return { isError: false, errorMessage: "" };
      }

      const { revertReason, error } = errCall;

      this.logger.error(
        {
          errCall,
        },
        "simulateHandleOps revert err call",
      );

      let errorMessage =
        revertReason ||
        error ||
        "Unknown error during simulation. Possible 'out of gas' exception.";

      if (errorMessage === "execution reverted") {
        if (isAddress(errCall.to || "")) {
          errorMessage = this.generateErrorMessage(
            errCall.to as Address,
            (errCall.output as Hex) || undefined,
          );
        }
      }

      if (options.useStorage) {
        // Update error in background for improved latency
        this.storageService.updateUserOpCustomFields(
          meeUserOpHash,
          {
            revertReason: sanitizeUrl(errorMessage),
          },
          // 15 days expiration
          { ttl: DEFAULT_GLOBAL_EXPIRATION_TIME },
        );
      }

      // If there is no retries left and err exists, it will return true with error
      if (options.retries <= 0) {
        return { isError: true, errorMessage };
      }

      return await this.simulateHandleOps(meeUserOp, {
        retries: options.retries - 1,
        useStorage: options.useStorage,
        workerAddress,
      });
    } catch (error) {
      this.logger.error({ error }, "simulateHandleOps reverted error result");
      return { isError: true, errorMessage: "Error during simulation" };
    }
  }
}
