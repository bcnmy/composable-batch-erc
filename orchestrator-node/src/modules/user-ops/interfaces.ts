import type { Address, Hex } from "viem";
import type { z } from "zod";
import type {
  eip7702AuthSchema,
  meeUserOpSchema,
  userOpRequestSchema,
  userOpSchema,
} from "./schemas";

export type EIP7702Auth = z.infer<typeof eip7702AuthSchema>;

export interface UserOp extends z.infer<typeof userOpSchema> {}

export type MeeUserOp = z.infer<typeof meeUserOpSchema>;

// signed

export interface SignedUserOp extends UserOp {
  signature: Hex;
}

export interface SignedMeeUserOp extends Omit<MeeUserOp, "userOp"> {
  userOp: SignedUserOp;
}

// packed

export interface PackedUserOp
  extends Pick<
    UserOp,
    | "sender"
    | "nonce"
    | "initCode"
    | "callData"
    | "paymasterAndData"
    | "signature"
  > {
  accountGasLimits: Hex;
  preVerificationGas: bigint;
  gasFees: Hex;
}

export interface PackedMeeUserOp extends Omit<MeeUserOp, "userOp"> {
  userOp: PackedUserOp;
}

// signed + packed

export interface SignedPackedUserOp extends PackedUserOp {
  signature: Hex;
}

export interface SignedPackedMeeUserOp extends Omit<MeeUserOp, "userOp"> {
  userOp: SignedPackedUserOp;
}

export interface MeeUserOpRequest extends z.infer<typeof userOpRequestSchema> {}

// batch

export interface MeeUserOpBatch {
  batchGasLimit: bigint;
  meeUserOps: SignedPackedMeeUserOp[];
  previousTxHash?: Hex;
}

export type SimulationTransactionData = {
  from: Address;
  to: Address;
  data: Hex;
  value: bigint;
  timestamp: number;
  blockNumber: bigint;
};

// entity

export interface UserOpEntityCustomFields {
  txHash?: Hex;
  batchHash?: Hex;
  error?: string;
  executionStartedAt?: number;
  executionFinishedAt?: number;
  simulationAttempts?: number;
  simulationStartedAt?: number;
  simulationFinishedAt?: number;
  actualGasCost?: bigint;
  revertReason?: string;
  isConfirmed?: boolean;
  confirmations?: bigint;
  isExecutionSkipped?: boolean;
  simulationTransactionData?: SimulationTransactionData;
  stateTransitions?: {
    assetTransfers?: UserOpTransfers;
  };
}

export type UserOpEntity = SignedPackedMeeUserOp & UserOpEntityCustomFields;

export interface ERC20TokenStateTransition {
  tokenAddress: Address;
  fromAddress: Address;
  toAddress: Address;
  name: string;
  symbol: string;
  decimals: number;
  amount: bigint;
  chainId: string;
}

export interface NativeTokenStateTransition {
  fromAddress: Address;
  toAddress: Address;
  amount: bigint;
  chainId: string;
}

export interface UserOpTransfers {
  nativeTokenTransfers: NativeTokenStateTransition[];
  erc20TokenTransfers: ERC20TokenStateTransition[];
}

export type UserOpTranferStateTransition = Record<Hex, UserOpTransfers>;
