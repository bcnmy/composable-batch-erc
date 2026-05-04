export const NONCE_ERROR_MESSAGES = [
  "Try increasing the nonce",
  "find the latest nonce",
  "nonce too low",
  "Nonce provided for the transaction is lower",
  "next nonce",
  "find the latest nonce with `getTransactionCount`",
  "already known",
  "Nonce provided for the transaction is lower than the current nonce of the account",
];

export const REPLACEMENT_TRANSACTION_GAS_PRICE_ERROR_MESSAGES = [
  "replacement transaction underpriced",
  "replacement underpriced",
  "underpriced replacement transaction",
];

export const GAS_PRICE_ERROR_MESSAGES = [
  "transaction underpriced",
  "underpriced transaction",
];

export const MAX_FEE_ERROR_MESSAGES = [
  "cannot be lower than the block base fee",
  "The fee cap (`maxFeePerGas` gwei) cannot be lower than the block base fee",
  "The fee cap cannot be lower than the block base fee",
  "max fee per gas less than block base fee",
];

export const PRIORITY_FEE_ERROR_MESSAGES = [
  "cannot be higher than the fee cap",
  "The provided tip (`maxPriorityFeePerGas` gwei) cannot be higher than the fee cap",
  "The provided tip cannot be higher than the fee cap",
  "max priority fee per gas higher than max fee per gas",
];

export const TIME_OUT_ERROR_MESSAGES = [
  "Timed out while waiting for transaction",
  "Timed out while waiting for transaction hash",
  "timeout exceeded",
  "Timed out",
];

export const BLOCK_GAS_LIMIT_EXCEEDS_ERROR_MESSAGES = [
  "exceeds block gas limit",
  "block gas limit exceeds",
];

export const TRANSACTION_EXECUTION_SYNC_ERROR_MESSAGES = [
  "The transaction was added to the mempool but wasn't processed",
  "Invalid transaction",
];
