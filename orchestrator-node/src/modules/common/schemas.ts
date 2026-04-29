import {
  type Hash,
  checksumAddress,
  isAddress,
  isHash,
  isHex,
  parseEther,
} from "viem";
import { z } from "zod";
import { chainConfigIdSchema } from "./chain-schemas";
import { validateUrl } from "./utils";

export const urlSchema = z
  .string()
  .refine((value: string) => validateUrl(value), "Invalid url");

export const addressSchema = z
  .string()
  .refine(
    (value: string) => isAddress(value, { strict: false }),
    "Invalid Ethereum address",
  )
  .transform((value) => checksumAddress(value) as Hash);

export const hashSchema = z
  .string()
  .refine((value: string) => isHash(value), "Invalid hash");

export const hexSchema = z
  .string()
  .refine((value: string) => isHex(value), "Invalid hex");

export const booleanSchema = z.boolean().describe("Invalid boolean");

export const etherSchema = z
  .string()
  .or(z.number())
  .transform((value) => parseEther(`${value}`));

export const intLikeSchema = z
  .string()
  .or(z.number())
  .refine(
    (value) => typeof value === "number" || isHex(value) || /^\d+$/.test(value),
    "Invalid int-like",
  )
  .transform((value) => Number(BigInt(value)))
  .refine(
    (value) =>
      value >= Number.MIN_SAFE_INTEGER && value <= Number.MAX_SAFE_INTEGER,
    "Int-like out of safe integer range",
  );

export const bigIntLikeSchema = z
  .string()
  .or(z.number())
  .or(z.bigint())
  .refine(
    (value) =>
      typeof value === "number" ||
      typeof value === "bigint" ||
      isHex(value) ||
      /^\d+$/.test(value),
    "Invalid bigint-like",
  )
  .transform((value) => BigInt(value));

// Simulation schemas
export const tokenOverrideSchema = z.object({
  tokenAddress: addressSchema,
  accountAddress: addressSchema,
  chainId: chainConfigIdSchema,
  balance: bigIntLikeSchema,
});

export const customOverrideSchema = z.object({
  contractAddress: addressSchema,
  storageSlot: hexSchema,
  chainId: chainConfigIdSchema,
  value: hexSchema,
});

export const overridesSchema = z.object({
  tokenOverrides: z.array(tokenOverrideSchema).default([]),
  customOverrides: z.array(customOverrideSchema).default([]),
});

export const simulationSchema = z.object({
  simulate: booleanSchema,
  overrides: overridesSchema.optional(),
  gasLimitBuffers: z.record(chainConfigIdSchema, bigIntLikeSchema).optional(),
});
