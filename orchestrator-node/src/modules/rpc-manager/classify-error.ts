import {
  BLOCK_GAS_LIMIT_EXCEEDS_ERROR_MESSAGES,
  GAS_PRICE_ERROR_MESSAGES,
  MAX_FEE_ERROR_MESSAGES,
  NONCE_ERROR_MESSAGES,
  PRIORITY_FEE_ERROR_MESSAGES,
  REPLACEMENT_TRANSACTION_GAS_PRICE_ERROR_MESSAGES,
  TIME_OUT_ERROR_MESSAGES,
  TRANSACTION_EXECUTION_SYNC_ERROR_MESSAGES,
} from "@/executor/constants";
import {
  CallExecutionError,
  ContractFunctionExecutionError,
  ContractFunctionRevertedError,
  ExecutionRevertedError,
  HttpRequestError,
  InternalRpcError,
  RpcRequestError,
  TimeoutError,
} from "viem";
import { RpcErrorType } from "./interfaces";

/**
 * Check if error message matches any pattern in the given array
 * Both error message and all patterns are compared in lowercase.
 */
export const matchesErrorPattern = (
  errorMessage: string,
  patterns: string[],
): boolean => {
  const messageLowerCase = errorMessage ? errorMessage.toLowerCase() : "";
  const patternsLowerCase = patterns.map((pattern) => pattern.toLowerCase());
  return patternsLowerCase.some((patternLowerCase) =>
    messageLowerCase.includes(patternLowerCase),
  );
};

/**
 * Classify error type to determine if we should retry.
 * Order matters: Most specific cases first.
 */
// biome-ignore lint/suspicious/noExplicitAny: allow any for this variable
export const classifyError = (error: any): RpcErrorType => {
  const errorMessage = error?.message?.toLowerCase?.() || "";
  const errorCode = error?.code;
  const errorName = error?.name?.toLowerCase?.() || "";

  // ========= 1. CHAIN ERRORS (NEVER RETRY; USER/METHOD/CHAIN-STATE ERRORS) =========

  // Contract/function execution errors & low-level call errors
  if (
    error instanceof ContractFunctionExecutionError ||
    error instanceof ContractFunctionRevertedError ||
    error instanceof CallExecutionError ||
    error instanceof ExecutionRevertedError
  ) {
    return RpcErrorType.CHAIN_ERROR;
  }

  // Nonce errors (nonce too low/incorrect) are not retriable
  if (matchesErrorPattern(errorMessage, NONCE_ERROR_MESSAGES)) {
    return RpcErrorType.CHAIN_ERROR;
  }

  // Transaction replacement gas price settings/misconfigurations
  if (
    matchesErrorPattern(
      errorMessage,
      REPLACEMENT_TRANSACTION_GAS_PRICE_ERROR_MESSAGES,
    )
  ) {
    return RpcErrorType.CHAIN_ERROR;
  }

  // Gas price settings/misconfigurations
  if (matchesErrorPattern(errorMessage, GAS_PRICE_ERROR_MESSAGES)) {
    return RpcErrorType.CHAIN_ERROR;
  }

  // Max fee related issues
  if (matchesErrorPattern(errorMessage, MAX_FEE_ERROR_MESSAGES)) {
    return RpcErrorType.CHAIN_ERROR;
  }

  // Priority fee misconfigurations
  if (matchesErrorPattern(errorMessage, PRIORITY_FEE_ERROR_MESSAGES)) {
    return RpcErrorType.CHAIN_ERROR;
  }

  // Block gas limit errors
  if (
    matchesErrorPattern(errorMessage, BLOCK_GAS_LIMIT_EXCEEDS_ERROR_MESSAGES)
  ) {
    return RpcErrorType.CHAIN_ERROR;
  }

  // Execution is reverted
  if (
    errorMessage.includes("revert") ||
    errorMessage.includes("execution reverted") ||
    errorMessage.includes("evm reverted") ||
    errorCode === 3 || // EVM standard reverted
    errorCode === -32015 || // VM exec error (Parity, etc)
    errorCode === -32016 // VM exception
  ) {
    return RpcErrorType.CHAIN_ERROR;
  }

  // Out of gas/gas related/insufficient gas
  if (
    errorMessage.includes("out of gas") ||
    errorMessage.includes("gas required exceeds") ||
    errorMessage.includes("intrinsic gas too low")
  ) {
    return RpcErrorType.CHAIN_ERROR;
  }

  // Insufficient funds/balance for transfer or execution
  if (
    errorMessage.includes("insufficient funds") ||
    errorMessage.includes("insufficient balance") ||
    (errorCode === -32000 && errorMessage.includes("funds")) // -32000 but relevant only if "funds"
  ) {
    return RpcErrorType.CHAIN_ERROR;
  }

  // ========= 2. RATE LIMITING ERRORS =========

  if (
    error?.status === 429 ||
    errorMessage.includes("rate limit") ||
    errorMessage.includes("too many requests") ||
    (errorMessage.includes("exceeded") && errorMessage.includes("quota")) ||
    errorMessage.includes("rate exceeded") ||
    errorMessage.includes("request limit") ||
    errorMessage.includes("over rate") ||
    errorMessage.includes("over quota")
  ) {
    return RpcErrorType.RATE_LIMIT;
  }

  // ========= 3. RETRIABLE TIMEOUT ERRORS =========

  if (matchesErrorPattern(errorMessage, TIME_OUT_ERROR_MESSAGES)) {
    return RpcErrorType.RETRIABLE;
  }

  if (
    error instanceof TimeoutError ||
    errorMessage.includes("timeout") ||
    errorMessage.includes("timed out") ||
    errorMessage.includes("etimedout") ||
    errorCode === "ETIMEDOUT" ||
    errorCode === "ESOCKETTIMEDOUT" ||
    errorMessage.includes("request timeout") // Some providers use this phrasing too
  ) {
    return RpcErrorType.RETRIABLE;
  }

  // Transaction execution sync errors
  if (
    matchesErrorPattern(errorMessage, TRANSACTION_EXECUTION_SYNC_ERROR_MESSAGES)
  ) {
    return RpcErrorType.CHAIN_ERROR;
  }

  // ========= 4. NON-RETRIABLE CLIENT ERRORS (4xx except 408/429) =========

  // HttpRequestError: handle status codes
  if (error instanceof HttpRequestError) {
    const status = error.status;

    // 408/429 are retirable or handled above
    if (status === 408 || status === 429) {
      return status === 429 ? RpcErrorType.RATE_LIMIT : RpcErrorType.RETRIABLE;
    }
    if (status && status >= 400 && status < 500) {
      return RpcErrorType.NON_RETRIABLE;
    }
    if (status && status >= 500) {
      return RpcErrorType.RETRIABLE;
    }
  }

  // Invalid method, params, parse error, etc.
  if (
    errorCode === -32600 || // Invalid request
    errorCode === -32601 || // Method not found
    errorCode === -32602 || // Invalid params
    errorCode === -32700 || // Parse error
    errorMessage.includes("invalid argument") ||
    errorMessage.includes("missing argument") ||
    errorMessage.includes("invalid address") ||
    errorMessage.includes("invalid method") ||
    errorMessage.includes("unsupported method") ||
    errorMessage.includes("invalid value")
  ) {
    return RpcErrorType.NON_RETRIABLE;
  }

  // API key, authentication, permission issues
  if (
    errorMessage.includes("invalid api key") ||
    errorMessage.includes("unauthorized") ||
    errorMessage.includes("forbidden") ||
    errorMessage.includes("authentication failed") ||
    errorMessage.includes("not allowed") ||
    errorMessage.includes("permission denied")
  ) {
    return RpcErrorType.NON_RETRIABLE;
  }

  // ========= 5. RETRIABLE NETWORK/INFRASTRUCTURE ERRORS =========

  // Infrastructure network issues (broad match, order is after previous specific above!)
  if (
    errorName.includes("networkerror") ||
    errorMessage.includes("network error") ||
    errorMessage === "network error" ||
    errorMessage.includes("failed to fetch") || // Browser-like env
    errorMessage.includes("network") ||
    errorMessage.includes("socket hang up") ||
    errorMessage.includes("econnreset") ||
    errorMessage.includes("econnrefused") ||
    errorMessage.includes("enotfound") ||
    errorMessage.includes("ehostunreach") ||
    errorMessage.includes("enetunreach") ||
    errorMessage.includes("dccp error") ||
    errorCode === "ECONNRESET" ||
    errorCode === "ECONNREFUSED" ||
    errorCode === "ENOTFOUND" ||
    errorCode === "EHOSTUNREACH" ||
    errorCode === "ENETUNREACH" ||
    errorCode === "EPIPE"
  ) {
    return RpcErrorType.RETRIABLE;
  }

  // Server errors (5xx), gateway, known server error messages, but not 4xx
  if (
    errorMessage.includes("internal server error") ||
    errorMessage.includes("service unavailable") ||
    errorMessage.includes("bad gateway") ||
    errorMessage.includes("gateway timeout") ||
    errorMessage.includes("server error") ||
    errorMessage.includes("502") ||
    errorMessage.includes("503") ||
    errorMessage.includes("504") ||
    (errorCode === -32603 && !errorMessage.includes("known"))
  ) {
    return RpcErrorType.RETRIABLE;
  }

  // InternalRpcError: catch-all "something failed unexpectedly at the node/provider"
  if (
    error instanceof InternalRpcError ||
    errorMessage.includes("temporarily unavailable") ||
    errorMessage.includes("try again later") ||
    errorMessage.includes("service degraded") ||
    errorMessage.includes("capacity exceeded") ||
    errorMessage.includes("backend error") ||
    errorMessage.includes("maintenance") ||
    errorMessage.includes("server overloaded")
  ) {
    return RpcErrorType.RETRIABLE;
  }

  // ========= 6. EDGE CASES & FALLBACK =========

  // Special case: -32000 is generic "server error". If it's not "insufficient funds" (handled above), treat as retriable.
  if (errorCode === -32000) {
    // Most -32000s except for "insufficient funds" are retriable
    return RpcErrorType.RETRIABLE;
  }

  // Fallback for any unexpected/unclassified errors (better safe than stuck)
  return RpcErrorType.RETRIABLE;
};
