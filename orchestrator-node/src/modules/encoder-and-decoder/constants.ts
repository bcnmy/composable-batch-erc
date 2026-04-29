import { Hex, concat, parseAbi } from "viem";

// define mode and exec type enums
export const CALLTYPE_SINGLE: Hex = "0x00"; // 1 byte
export const CALLTYPE_BATCH: Hex = "0x01"; // 1 byte
export const EXECTYPE_DEFAULT: Hex = "0x00"; // 1 byte
export const EXECTYPE_TRY: Hex = "0x01"; // 1 byte
export const EXECTYPE_DELEGATE: Hex = "0xFF"; // 1 byte
export const MODE_DEFAULT: Hex = "0x00000000"; // 4 bytes
export const UNUSED: Hex = "0x00000000"; // 4 bytes
export const MODE_PAYLOAD: Hex =
  "0x00000000000000000000000000000000000000000000"; // 22 bytes

export const EXECUTE_SINGLE = concat([
  CALLTYPE_SINGLE,
  EXECTYPE_DEFAULT,
  MODE_DEFAULT,
  UNUSED,
  MODE_PAYLOAD,
]);

export const EXECUTE_BATCH = concat([
  CALLTYPE_BATCH,
  EXECTYPE_DEFAULT,
  MODE_DEFAULT,
  UNUSED,
  MODE_PAYLOAD,
]);

export const EXECUTE_INTERFACE = parseAbi([
  "function execute(bytes32 mode, bytes memory executionCalldata) external",
]);

export const EXECUTE_COMPOSABLE_V1_0_0_INTERFACE = parseAbi([
  "function executeComposable((address to, uint256 value, bytes4 functionSig, (uint8 fetcherType, bytes paramData, (uint8 constraintType, bytes referenceData)[])[] inputParams, (uint8 fetcherType, bytes paramData)[] outputParams)[] executions) external payable",
]);

export const EXECUTE_COMPOSABLE_V1_1_0_INTERFACE = parseAbi([
  "function executeComposable((bytes4 functionSig, (uint8 paramType, uint8 fetcherType, bytes paramData, (uint8 constraintType, bytes referenceData)[] constraints)[] inputParams, (uint8 fetcherType, bytes paramData)[] outputParams)[] cExecutions) payable",
]);

export type COMPOSABILITY_VERSION = "1.0.0" | "1.1.0";
