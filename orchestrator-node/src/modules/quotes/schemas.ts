import { supportedChainIdSchema } from "@/chains";
import {
  addressSchema,
  bigIntLikeSchema,
  booleanSchema,
  hashSchema,
  hexSchema,
} from "@/common";
import { simulationSchema } from "@/common";
import { commonPaymentInfoSchema } from "@/payment/schemas";
import { meeUserOpSchema, userOpRequestSchema } from "@/user-ops";
import { z } from "zod";

export const triggerSchema = z.object({
  tokenAddress: addressSchema,
  chainId: supportedChainIdSchema,
  amount: bigIntLikeSchema,
  recipientAddress: addressSchema.optional(),
  useMaxAvailableFunds: booleanSchema.optional(),
});

export const meeVersionSchema = z.enum([
  "3.0.0",
  "2.3.0",
  "2.2.1",
  "2.2.0",
  "2.1.0",
  "2.0.0",
  "1.1.0",
  "1.0.0",
]);

export const meeVersionWithChainIdSchema = z
  .array(
    z.object({
      version: z.object({
        // Currently only using MEE version and not other configs. so ignored them for now
        version: meeVersionSchema,
      }),
      chainId: supportedChainIdSchema,
    }),
  )
  .default([]);

export const quoteTypeSchema = z.enum([
  "simple",
  "onchain",
  "permit",
  "mm-dtk",
  "safe-sa",
]);

// API: `/quote`

export const requestQuotePaymentInfoSchema = commonPaymentInfoSchema.omit({
  eoa: true,
});

export const requestQuoteSchema = z
  .object({
    permit: z.literal(false).default(false), // simplify type detection
    meeVersions: meeVersionWithChainIdSchema.optional(),
    quoteType: quoteTypeSchema.optional(),
    trigger: z.undefined(), // Simplify type detection
    userOps: z.array(userOpRequestSchema).nonempty(),
    paymentInfo: requestQuotePaymentInfoSchema,
    simulation: simulationSchema.optional(),
  })
  .refine(
    (data) => {
      // If simulation exists, quoteType is mandatory
      if (data.simulation?.simulate) {
        return data.quoteType !== undefined;
      }
      return true;
    },
    {
      message: "quoteType is required when simulation is provided",
      path: ["quoteType"],
    },
  );

// API: `/quote-permit`

export const requestQuotePermitSchema = z
  .object({
    permit: z.literal(true).default(true), // simplify type detection
    meeVersions: meeVersionWithChainIdSchema.optional(),
    quoteType: quoteTypeSchema.optional(),
    trigger: triggerSchema.optional(),
    userOps: z.array(userOpRequestSchema).nonempty(),
    paymentInfo: commonPaymentInfoSchema,
    simulation: simulationSchema.optional(),
  })
  .refine(
    (data) => {
      // If simulation exists, quoteType is mandatory
      if (data.simulation?.simulate) {
        return data.quoteType !== undefined;
      }
      return true;
    },
    {
      message: "quoteType is required when simulation is provided",
      path: ["quoteType"],
    },
  );

// API: `/exec`

export const executeQuotePaymentInfoSchema = commonPaymentInfoSchema.extend({
  tokenAmount: z.string(), // This will be ethers format, so no bigint type is required
  tokenWeiAmount: bigIntLikeSchema,
  tokenValue: z.string(), // This will be ethers format, so no bigint type is required
  gasFee: z.string(),
  orchestrationFee: z.string(),
});

export const executeQuoteSchema = z.object({
  userOps: z.array(meeUserOpSchema).min(1),
  paymentInfo: executeQuotePaymentInfoSchema,
  trigger: triggerSchema.optional(),
  hash: hashSchema,
  commitment: hexSchema,
  node: addressSchema,
  signature: hexSchema,
  quoteType: quoteTypeSchema.optional(),
  meeVersions: meeVersionWithChainIdSchema.optional(),
  // We're currently using this value to have a backwards compatibility for EIP 712 powered simple SCA mode.
  // Defaults to false for old SDK, new SDK will always send true for this flag
  isEIP712TrustedSponsorshipSupported: booleanSchema.default(false),
});

export const meeQuoteSchema = executeQuoteSchema.omit({
  signature: true,
  isEIP712TrustedSponsorshipSupported: true,
});

// API: `/explorer/:hash`

export const getQuoteSchema = z.object({
  hash: hashSchema,
  confirmations: bigIntLikeSchema.default(3n),
});
