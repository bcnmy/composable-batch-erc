import { NEXUS_120 } from "@/contracts/resources/nexus-120";
import { NEXUS_121 } from "@/contracts/resources/nexus-121";
import { Logger } from "@/core/logger";
import { MeeUserOp } from "@/user-ops";
import Container from "typedi";
import { Abi, type Hex, decodeAbiParameters, decodeFunctionData } from "viem";
import { NexusExecutionMode } from "../constants";

const logger = Container.get(Logger).setCaller("parse-user-op-calldata-utils");

interface InstructionsData {
  instructionsCount: number;
  isComposable: boolean;
}

type ComposableCall = {
  to?: Hex;
  value?: bigint;
  functionSig: Hex;
  inputParams: Hex[];
  outputParams: Hex[];
};

type ExecutionCall = {
  target: Hex;
  value: bigint;
  callData: Hex;
};

function decodeInstructions(
  meeUserOp: MeeUserOp,
): InstructionsData | undefined {
  // attempt to decode with nexus 120 abi
  try {
    logger.trace({ meeUserOp }, "Decoding instructions. Using NEXUS_120.");
    return decodeNexusCallData(meeUserOp.userOp.callData, NEXUS_120 as Abi);
  } catch (executeError) {}

  // attempt to decode with nexus 121 abi
  try {
    logger.trace({ meeUserOp }, "Decoding instructions. Using NEXUS_121.");
    return decodeNexusCallData(meeUserOp.userOp.callData, NEXUS_121 as Abi);
  } catch (executeError) {}

  // no abi found
  logger.trace(
    { meeUserOp },
    "Decoding instructions. Calldata not recognized by NEXUS_120 or NEXUS_121 abis.",
  );
  return undefined;
}

function decodeNexusCallData(
  calldata: Hex,
  abi: Abi,
): InstructionsData | undefined {
  const decodedExecute = decodeFunctionData({
    abi,
    data: calldata,
  });
  if (!decodedExecute.args) {
    logger.error(
      { callData: calldata },
      "Error decoding instructions. No args",
    );
    return undefined;
  }

  switch (decodedExecute.functionName) {
    case "execute": {
      const mode = decodedExecute.args[0] as Hex;
      switch (mode) {
        case NexusExecutionMode.BATCH: {
          const executionCalldata = decodedExecute.args[1] as Hex;
          const executionAbiParams = {
            type: "tuple[]",
            components: [
              { name: "target", type: "address" },
              { name: "value", type: "uint256" },
              { name: "callData", type: "bytes" },
            ],
          };
          const [executions] = decodeAbiParameters(
            [executionAbiParams],
            executionCalldata,
          ) as [ExecutionCall[]];
          return {
            instructionsCount: executions.length,
            isComposable: false,
          };
        }
        case NexusExecutionMode.SINGLE:
          return {
            instructionsCount: 1,
            isComposable: false,
          };
        default:
          return undefined;
      }
    }
    case "executeComposable": {
      const [calls] = decodedExecute.args as [ComposableCall[]];
      return {
        instructionsCount: calls.length,
        isComposable: true,
      };
    }
    default:
      logger.error(
        { callData: calldata },
        "Error decoding instructions. Unrecognized function name",
      );
      return undefined;
  }
}

export { decodeInstructions };
