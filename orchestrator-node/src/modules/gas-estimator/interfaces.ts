import { GAS_ESTIMATION_LOOKUP_TABLE } from "./constants";

export interface GasConditions {
  l1GasPrice: bigint;
  maxFeePerGas: bigint;
  maxPriorityFeePerGas: bigint;
  baseFee: bigint;
}

export interface EstimationGasLimits {
  verificationGasLimit: bigint;
  callGasLimit: bigint;
}

export interface GasEstimationInfo {
  validateUserOpGasLimit: bigint;
}

export type GasEstimationLookupKey = keyof typeof GAS_ESTIMATION_LOOKUP_TABLE;
