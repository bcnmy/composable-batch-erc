import { Address } from "viem";

export type CalldataType = "batch-call" | "composable-call";

export type InputParam = {
  paramType?: InputParamType;
  fetcherType: InputParamFetcherType;
  paramData: string;
  constraints: Constraint[];
};

export type OutputParam = {
  fetcherType: OutputParamFetcherType;
  paramData: string;
};

export const InputParamType = {
  TARGET: 0,
  VALUE: 1,
  CALL_DATA: 2,
} as const;

export const InputParamFetcherType = {
  RAW_BYTES: 0,
  STATIC_CALL: 1,
  BALANCE: 2,
} as const;

export const OutputParamFetcherType = {
  EXEC_RESULT: 0,
  STATIC_CALL: 1,
} as const;

export const ConstraintType = {
  EQ: 0,
  GTE: 1,
  LTE: 2,
  IN: 3,
} as const;

export type InputParamFetcherType =
  (typeof InputParamFetcherType)[keyof typeof InputParamFetcherType];
export type OutputParamFetcherType =
  (typeof OutputParamFetcherType)[keyof typeof OutputParamFetcherType];
export type ConstraintType =
  (typeof ConstraintType)[keyof typeof ConstraintType];
export type InputParamType =
  (typeof InputParamType)[keyof typeof InputParamType];

export type Constraint = {
  constraintType: ConstraintType;
  referenceData: string;
};

export type BaseComposableCall = {
  to?: Address;
  value?: bigint;
  functionSig: string;
  inputParams: InputParam[];
  outputParams: OutputParam[];
};

export type ComposableCall = BaseComposableCall & {
  gasLimit?: bigint;
};
