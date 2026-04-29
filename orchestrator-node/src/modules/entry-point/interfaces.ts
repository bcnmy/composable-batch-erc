import { type Address, type Hex } from "viem";

export interface AccountValidationData {
  sigFailed: number;
  validAfter: number;
  validUntil: number;
}

export interface SimulationOptions {
  retries: number;
  useStorage: boolean;
  workerAddress?: Address;
}

// Call types enum
enum CallType {
  CALL = "CALL",
  STATICCALL = "STATICCALL",
  DELEGATECALL = "DELEGATECALL",
  CREATE = "CREATE",
  CREATE2 = "CREATE2",
}

// Response interface for debug_traceCall with callTracer
export interface DebugTraceCallCallTracerResponse {
  type: CallType;
  from: string; // Caller address (hex string with 0x prefix)
  to?: string; // Callee address (undefined for CREATE/CREATE2)
  value?: string; // Value transferred in wei (hex string)
  gas: string; // Gas allocated for this call (hex string)
  gasUsed: string; // Gas actually consumed (hex string)
  input: string; // Input data/calldata (hex string)
  output?: string; // Return data (hex string, undefined if error)
  error?: string; // Error message if call failed
  revertReason?: string; // Decoded revert reason if available
  calls?: DebugTraceCallCallTracerResponse[]; // Array of nested/internal calls
}

export interface SimulationHandleOpExecutionResult {
  accountValidationData: 0 | 1;
  paid: bigint;
  paymasterValidationData: 0 | 1;
  preOpGas: bigint;
  targetResult: Hex;
  targetSuccess: boolean;
}
