import {
  customOverrideSchema,
  overridesSchema,
  tokenOverrideSchema,
} from "@/common";
import { type Job, type JobCounts } from "@/core/queue";
import { GasEstimationInfo } from "@/gas-estimator";
import { type HealthCheckDataWithChains } from "@/health-check";
import { type PaymentInfo } from "@/payment";
import { type QuoteType, type TriggerType } from "@/quotes";
import { type GrantPermissionResponseType } from "@/sessions";
import {
  type EIP7702Auth,
  MeeUserOpRequest,
  type PackedUserOp,
  type SignedPackedMeeUserOp,
} from "@/user-ops";
import { type Address, type Hex } from "viem";
import { z } from "zod";

export interface SimulatorJobData {
  meeUserOp: SignedPackedMeeUserOp;
  forceExecute: boolean;
  isRetryJob?: boolean;
}

export type SimulatorJob = Job<SimulatorJobData, boolean, Hex>;

export type SimulatorHealthCheckData = HealthCheckDataWithChains<{
  totalJobs?: JobCounts;
}>;

export type TokenOverride = z.infer<typeof tokenOverrideSchema>;

export type CustomOverride = z.infer<typeof customOverrideSchema>;

export type Overrides = z.infer<typeof overridesSchema>;

export interface SimulationUserOp {
  packedUserOp: PackedUserOp;
  isSponsoredPaymentUserOp: boolean;
  isTrustedSponsorship: boolean;
  chainId: string;
  precalculatedGasEstimation: GasEstimationInfo;
  isDeploymentRequired: boolean;
  additionalCallGasLimitsToAdd: bigint;
  additionalVerificationGasLimitsToAdd: bigint;
  eip7702Auth?: EIP7702Auth;
  sessionDetails?: GrantPermissionResponseType;
  smartSessionMode?: "ENABLE_AND_USE" | "USE";
  overrides?: Overrides;
}

export interface PrepareSimulationUserOpsParams {
  userOpRequest: MeeUserOpRequest;
  quoteType: QuoteType;
  paymentInfo: PaymentInfo;
  isTrustedSponsorship: boolean;
  trigger?: TriggerType;
  isAccountDeploymentRequired?: boolean;
  initCode?: Hex;
  eip7702Auth?: EIP7702Auth;
  isTriggerTokenPullUserOp?: boolean;
  triggerTokenPullGasLimit: bigint;
  tokenPermitGasLimit: bigint;
  isPaymentUserOp?: boolean;
  isSponsored?: boolean;
  sessionDetails?: GrantPermissionResponseType;
  smartSessionMode?: "ENABLE_AND_USE" | "USE";
}

export type EIP712DomainReturn = [
  Hex,
  string,
  string,
  bigint,
  Address,
  Hex,
  bigint[],
];

export type SimulationResult = {
  userOpIndex: number;
  chainId: string;
  simulationResult: {
    revert: boolean;
    revertReason: string;
    verificationGasLimit: bigint;
    callGasLimit: bigint;
  };
};
