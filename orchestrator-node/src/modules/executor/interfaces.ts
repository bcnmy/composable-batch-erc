import { type Job, type JobCounts } from "@/core/queue";
import { type HealthCheckDataWithChains } from "@/health-check";
import { type MeeUserOpBatch } from "@/user-ops";
import {
  type Hex,
  type TransactionReceipt,
  type TransactionRequestEIP1559,
  type TransactionRequestEIP7702,
  type TransactionRequestLegacy,
} from "viem";

export type ExecutorJob = Job<MeeUserOpBatch, boolean, Hex>;

export type ExecutorHealthCheckData = HealthCheckDataWithChains<{
  totalJobs?: JobCounts;
}>;

type LegacyFields = Required<
  Pick<TransactionRequestLegacy, "type" | "gasPrice" | "nonce">
>;

type EIP1559Fields = Required<
  Pick<
    TransactionRequestEIP1559,
    "type" | "maxFeePerGas" | "maxPriorityFeePerGas" | "nonce"
  >
>;

type EIP7702FieldsBase = Required<
  Pick<TransactionRequestEIP7702, "type" | "nonce" | "authorizationList">
>;

// // TODO: Once viem supports gasPrice case with proper types ? Please extract the type from TransactionRequestEIP7702
// type EIP7702GasPrice = {
//   gasPrice?: bigint; // This is optional for now. Will be changed once non 1559 chain issues is resolved
// };

type EIP7702FeeMarket = Required<
  Pick<TransactionRequestEIP7702, "maxFeePerGas" | "maxPriorityFeePerGas">
>;

type EIP7702Fields = EIP7702FieldsBase & EIP7702FeeMarket;

export type ExecutorTxRequest = LegacyFields | EIP1559Fields | EIP7702Fields;

export enum USER_OP_EXECUTION_ERRORS {
  EXECUTION_FAILED = 0,
  GAS_PRICE_TOO_LOW = 1,
  MAX_FEE_TOO_LOW = 2,
  NONCE_EXPIRED = 3,
  PRIORITY_FEE_TOO_HIGH = 4,
  UNRECOGNIZED_ERROR = 5,
  TRANSACTION_RECEIPT_ERROR = 6,
  TRANSACTION_RECEIPT_TIMEOUT_ERROR = 7,
  BLOCK_GAS_LIMIT_EXCEEDS_ERROR = 8,
  REPLACEMENT_TRANSACTION_GAS_PRICE_TOO_LOW = 9,
  TRANSACTION_EXECUTION_SYNC_ERROR = 10,
}

export const USER_OP_ERROR_MESSAGES: Record<USER_OP_EXECUTION_ERRORS, string> =
  {
    [USER_OP_EXECUTION_ERRORS.EXECUTION_FAILED]: "Transaction execution failed",
    [USER_OP_EXECUTION_ERRORS.GAS_PRICE_TOO_LOW]:
      "Gas price is too low for this transaction",
    [USER_OP_EXECUTION_ERRORS.MAX_FEE_TOO_LOW]:
      "Maximum fee per gas is too low",
    [USER_OP_EXECUTION_ERRORS.PRIORITY_FEE_TOO_HIGH]:
      "Maximum priority fee per gas is higher than the maximum fee per gas",
    [USER_OP_EXECUTION_ERRORS.NONCE_EXPIRED]: "Transaction nonce has expired",
    [USER_OP_EXECUTION_ERRORS.UNRECOGNIZED_ERROR]:
      "An unrecognized error occurred",
    [USER_OP_EXECUTION_ERRORS.TRANSACTION_RECEIPT_ERROR]:
      "Failed to retrieve transaction receipt",
    [USER_OP_EXECUTION_ERRORS.TRANSACTION_RECEIPT_TIMEOUT_ERROR]:
      "Transaction receipt timeout",
    [USER_OP_EXECUTION_ERRORS.BLOCK_GAS_LIMIT_EXCEEDS_ERROR]:
      "Block gas limit exceeds",
    [USER_OP_EXECUTION_ERRORS.REPLACEMENT_TRANSACTION_GAS_PRICE_TOO_LOW]:
      "Replacement transaction gas price is too low for this transaction",
    [USER_OP_EXECUTION_ERRORS.TRANSACTION_EXECUTION_SYNC_ERROR]:
      "Failed to execute transaction from the mempool",
  };

export interface ExecuteOptions {
  maxFeePerGas: bigint;
  maxPriorityFeePerGas: bigint;
  nonce: number;
}

export interface BumpGasAndNonceOptions {
  percentage: bigint;
  executeOptions: ExecuteOptions;
}

export type ExecuteBlockResponse = {
  transactionReceipt?: TransactionReceipt;
  txHash?: Hex;
  isError?: boolean;
  errorType?: USER_OP_EXECUTION_ERRORS;
  isRetriableError?: boolean;
};
