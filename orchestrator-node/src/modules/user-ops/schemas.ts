import { supportedChainIdSchema } from "@/chains";
import {
  addressSchema,
  bigIntLikeSchema,
  booleanSchema,
  hashSchema,
  hexSchema,
  intLikeSchema,
  overridesSchema,
} from "@/common";
import { grantPermissionResponseSchema } from "@/sessions";
import { z } from "zod";

// If any new metadata is added in SDK, needs to update here to accept the new metadata type.
export const metadataTypeSchema = z.enum([
  "TRANSFER",
  "APPROVE",
  "WITHDRAW",
  "BRIDGE",
  "SWAP",
  "ADD_LIQUIDITY",
  "REMOVE_LIQUIDITY",
  "STAKE",
  "UNSTAKE",
  "LEND",
  "BORROW",
  "CUSTOM",
]);

export const userOpMetadataSchema = z
  .object({
    type: metadataTypeSchema, // Metadata type will be strictly validated
  })
  // All the other fields are not validated and considered as unknown. So if SDK decides to change the metadata field ? So no need to worry about the backwards compatibility things.
  .catchall(z.unknown());

export const eip7702AuthSchema = z.object({
  address: addressSchema,
  chainId: supportedChainIdSchema.transform((value) => Number(value)),
  nonce: intLikeSchema,
  r: hexSchema,
  s: hexSchema,
  yParity: intLikeSchema,
});

export const userOpSchema = z.object({
  sender: addressSchema,
  nonce: bigIntLikeSchema,
  initCode: hexSchema.default("0x"),
  callData: hexSchema,
  callGasLimit: bigIntLikeSchema,
  verificationGasLimit: bigIntLikeSchema,
  preVerificationGas: bigIntLikeSchema,
  maxFeePerGas: bigIntLikeSchema,
  maxPriorityFeePerGas: bigIntLikeSchema,
  paymasterAndData: hexSchema,
  signature: hexSchema.optional(),
});

const executionSimulationRetryDelaySchema = intLikeSchema.refine(
  (val) =>
    val === undefined || (Number(val) >= 1000 && Number(val) <= 5 * 60 * 1000),
  {
    message:
      "executionSimulationRetryDelay must be a value in milliseconds between 1000 (1 second) and 300000 (5 minutes)",
  },
);

export const meeUserOpSchema = z.object({
  userOp: userOpSchema,
  userOpHash: hashSchema,
  meeUserOpHash: hashSchema,
  lowerBoundTimestamp: intLikeSchema,
  upperBoundTimestamp: intLikeSchema,
  executionSimulationRetryDelay: executionSimulationRetryDelaySchema.optional(),
  maxGasLimit: bigIntLikeSchema,
  maxFeePerGas: bigIntLikeSchema,
  chainId: supportedChainIdSchema,
  eip7702Auth: eip7702AuthSchema.optional(),
  isCleanUpUserOp: booleanSchema.optional(),
  sessionDetails: grantPermissionResponseSchema.optional(),
  shortEncoding: booleanSchema.default(false),
  metadata: z.array(userOpMetadataSchema).default([]),
});

export const userOpRequestSchema = userOpSchema
  .pick({
    sender: true,
    nonce: true,
    initCode: true,
    callData: true,
    callGasLimit: true,
  })
  .extend({
    verificationGasLimit: bigIntLikeSchema.optional(),
    lowerBoundTimestamp: intLikeSchema.optional(),
    upperBoundTimestamp: intLikeSchema.optional(),
    executionSimulationRetryDelay:
      executionSimulationRetryDelaySchema.optional(),
    chainId: supportedChainIdSchema,
    eip7702Auth: eip7702AuthSchema.optional(),
    isCleanUpUserOp: booleanSchema.optional(),
    shortEncoding: booleanSchema.default(false),
    sessionDetails: grantPermissionResponseSchema.optional(),
    metadata: z.array(userOpMetadataSchema).default([]),
    simulationOverrides: overridesSchema.optional(),
  });
