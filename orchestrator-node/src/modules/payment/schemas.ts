import { supportedChainIdSchema } from "@/chains";
import {
  addressSchema,
  bigIntLikeSchema,
  booleanSchema,
  hexSchema,
  urlSchema,
} from "@/common";
import { grantPermissionResponseSchema } from "@/sessions";
import { eip7702AuthSchema } from "@/user-ops";
import { z } from "zod";

export const commonPaymentInfoSchema = z.object({
  sender: addressSchema,
  initCode: hexSchema.default("0x"),
  nonce: bigIntLikeSchema,
  token: addressSchema,
  chainId: supportedChainIdSchema,
  verificationGasLimit: bigIntLikeSchema.optional(),
  eoa: addressSchema.optional(),
  eip7702Auth: eip7702AuthSchema.optional(),
  shortEncoding: booleanSchema.default(false),
  callGasLimit: bigIntLikeSchema.optional(),
  gasRefundAddress: addressSchema.optional(),
  sponsored: booleanSchema.optional(),
  sponsorshipUrl: urlSchema.optional(),
  sessionDetails: grantPermissionResponseSchema.optional(),
});
