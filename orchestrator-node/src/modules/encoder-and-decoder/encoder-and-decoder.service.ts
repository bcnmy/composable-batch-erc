import { Service } from "typedi";
import {
  type AbiParameter,
  type Address,
  type Call,
  type Hex,
  decodeAbiParameters,
  decodeFunctionData,
  encodeAbiParameters,
  encodeFunctionData,
  encodePacked,
  getAddress,
  hexToBigInt,
  hexToNumber,
  slice,
} from "viem";
import {
  EXECUTE_BATCH,
  EXECUTE_COMPOSABLE_V1_0_0_INTERFACE,
  EXECUTE_COMPOSABLE_V1_1_0_INTERFACE,
  EXECUTE_INTERFACE,
  EXECUTE_SINGLE,
} from "./constants";
import {
  BaseComposableCall,
  ComposableCall,
  InputParamType,
} from "./interfaces";

@Service()
export class EncoderAndDecoderService {
  encodeCallData(calls: Call[], mode = EXECUTE_SINGLE): Hex {
    if (mode === EXECUTE_SINGLE) {
      return this.encodeSingleCallData(calls[0]);
    }

    return this.encodeBatchCallData(calls);
  }

  encodeSingleCallData(call: Call): Hex {
    const executionCalldata = encodePacked(
      ["address", "uint256", "bytes"],
      [call.to, call.value ?? 0n, call.data ?? "0x"],
    );

    return encodeFunctionData({
      abi: EXECUTE_INTERFACE,
      functionName: "execute",
      args: [EXECUTE_SINGLE, executionCalldata],
    });
  }

  encodeBatchCallData(calls: Call[]): Hex {
    const executionAbiParams: AbiParameter = {
      type: "tuple[]",
      components: [
        { name: "target", type: "address" },
        { name: "value", type: "uint256" },
        { name: "callData", type: "bytes" },
      ],
    };

    const executions = calls.map((tx) => ({
      target: tx.to,
      callData: tx.data ?? "0x",
      value: BigInt(tx.value ?? 0),
    }));

    const executionCalldata = encodeAbiParameters(
      [executionAbiParams],
      [executions],
    );

    return encodeFunctionData({
      abi: EXECUTE_INTERFACE,
      functionName: "execute",
      args: [EXECUTE_BATCH, executionCalldata],
    });
  }

  decodeBatchCalldata(encodedCalldata: Hex): Call[] {
    const executionAbiParams: AbiParameter = {
      type: "tuple[]",
      components: [
        { name: "target", type: "address" },
        { name: "value", type: "uint256" },
        { name: "callData", type: "bytes" },
      ],
    };

    const data = decodeFunctionData({
      abi: EXECUTE_INTERFACE,
      data: encodedCalldata,
    });

    const {
      args: [_mode, executionCalldata],
    } = data;

    const decodedData = decodeAbiParameters(
      [executionAbiParams],
      executionCalldata,
    );

    const [calls] = decodedData as unknown as {
      target: Address;
      value: bigint;
      callData: Hex;
    }[][];

    return calls.map((call) => ({
      to: call.target,
      value: call.value,
      data: call.callData,
    }));
  }

  encodeComposableCalldata(calls: ComposableCall[]): Hex {
    const isComposability_v1_0_0 =
      calls.every((call) => !!call.to) &&
      !calls.every((call) =>
        call.inputParams.some(
          (param) => param.paramType === InputParamType.TARGET,
        ),
      );

    const composableCalls: BaseComposableCall[] = calls.map((call) => {
      return isComposability_v1_0_0
        ? {
            to: call.to,
            value: call.value ?? 0n,
            functionSig: call.functionSig,
            inputParams: call.inputParams,
            outputParams: call.outputParams,
          }
        : {
            functionSig: call.functionSig,
            inputParams: call.inputParams,
            outputParams: call.outputParams,
          };
    });

    return encodeFunctionData({
      abi: isComposability_v1_0_0
        ? EXECUTE_COMPOSABLE_V1_0_0_INTERFACE
        : EXECUTE_COMPOSABLE_V1_1_0_INTERFACE,
      functionName: "executeComposable",
      args: [composableCalls],
    });
  }

  decodeComposableCalldata(encodedCalldata: Hex): ComposableCall[] {
    try {
      const data = decodeFunctionData({
        abi: EXECUTE_COMPOSABLE_V1_0_0_INTERFACE,
        data: encodedCalldata,
      });

      const { args } = data;
      const [calls] = args || [[]];
      return calls as ComposableCall[];
    } catch {}

    try {
      const data = decodeFunctionData({
        abi: EXECUTE_COMPOSABLE_V1_1_0_INTERFACE,
        data: encodedCalldata,
      });

      const { args } = data;
      const [calls] = args || [[]];
      return calls as ComposableCall[];
    } catch {}

    throw new Error("Failed to decode composable data");
  }

  decodeERC7579SingleCalldata(executionCalldata: Hex) {
    const target = getAddress(slice(executionCalldata, 0, 20));
    const value = hexToBigInt(slice(executionCalldata, 20, 52));
    const calldata = slice(executionCalldata, 52);

    return [{ target, value, calldata }];
  }

  decodeERC7579BatchCalldata(executionCalldata: Hex) {
    // Read the initial offset pointer (32 bytes at start)
    const u = hexToNumber(slice(executionCalldata, 0, 32));

    // Read the batch length (stored at position u)
    const executionBatchLength = hexToNumber(
      slice(executionCalldata, u, u + 32),
    );

    // The actual batch array starts 32 bytes after position u
    const executionBatchOffset = u + 32;

    interface Execution {
      target: Address;
      value: bigint;
      callData: Hex;
    }

    const executions: { target: Address; value: bigint; calldata: Hex }[] = [];

    for (let i = 0; i < executionBatchLength; i++) {
      // Read pointer to i-th execution (pointers are 32 bytes each)
      const pointerOffset = executionBatchOffset + i * 32;
      const p = hexToNumber(
        slice(executionCalldata, pointerOffset, pointerOffset + 32),
      );

      // Calculate absolute position of this execution item
      // The pointer is relative to executionBatchOffset
      const executionItemOffset = executionBatchOffset + p;

      // Parse Execution struct
      // struct Execution { address target; uint256 value; bytes callData; }

      // Read target (first 32 bytes, address is right-aligned/padded left)
      const targetBytes = slice(
        executionCalldata,
        executionItemOffset,
        executionItemOffset + 32,
      );
      const target = getAddress(slice(targetBytes, 12, 32)); // Skip 12 bytes of left padding

      // Read value (next 32 bytes)
      const value = hexToBigInt(
        slice(
          executionCalldata,
          executionItemOffset + 32,
          executionItemOffset + 64,
        ),
      );

      // Read callData offset (next 32 bytes, relative to executionItemOffset)
      const callDataRelativeOffset = hexToNumber(
        slice(
          executionCalldata,
          executionItemOffset + 64,
          executionItemOffset + 96,
        ),
      );

      // Calculate absolute callData position
      const callDataStart = executionItemOffset + callDataRelativeOffset;

      // Read callData length (32 bytes at callDataStart)
      const callDataLength = hexToNumber(
        slice(executionCalldata, callDataStart, callDataStart + 32),
      );

      // Read actual callData bytes
      const calldata = slice(
        executionCalldata,
        callDataStart + 32,
        callDataStart + 32 + callDataLength,
      );

      executions.push({ target, value, calldata });
    }

    return executions;
  }

  decodeERC7579Calldata(userOpCalldata: Hex) {
    // Single vs Batch calldata
    const callType = slice(slice(userOpCalldata, 4, 36), 0, 1);

    // Step 1: Extract executionCalldata using the first function
    // Skip 4 bytes (selector) + 32 bytes (execution mode) = 36 bytes
    const baseOffset = 36;

    // Read the offset pointer (32 bytes at baseOffset position)
    const offsetPointer = hexToNumber(
      slice(userOpCalldata, baseOffset, baseOffset + 32),
    );

    // Calculate actual data offset
    const dataOffset = baseOffset + offsetPointer;

    // Read length stored 32 bytes before the data
    const dataLength = hexToNumber(
      slice(userOpCalldata, dataOffset - 32, dataOffset),
    );

    // Extract the actual execution calldata
    const executionCalldata = slice(
      userOpCalldata,
      dataOffset,
      dataOffset + dataLength,
    );

    switch (callType) {
      case "0x00":
        return this.decodeERC7579SingleCalldata(executionCalldata);
      case "0x01":
        return this.decodeERC7579BatchCalldata(executionCalldata);
      default:
        throw new Error("Unsupported ERC 7579 execution call type");
    }
  }
}
