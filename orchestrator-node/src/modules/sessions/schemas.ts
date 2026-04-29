import {
  addressSchema,
  bigIntLikeSchema,
  hexSchema,
  intLikeSchema,
} from "@/common";
import { z } from "zod";
import { AccountTypeEnum } from "./interfaces";

export const policyDataSchema = z.object({
  policy: addressSchema,
  initData: hexSchema,
});

export const erc7739ContextSchema = z.object({
  appDomainSeparator: hexSchema,
  contentName: z.array(z.string()),
});

export const erc7739DataSchema = z.object({
  allowedERC7739Content: z.array(erc7739ContextSchema),
  erc1271Policies: z.array(policyDataSchema),
});

export const actionDataSchema = z.object({
  actionTargetSelector: hexSchema,
  actionTarget: addressSchema,
  actionPolicies: z.array(policyDataSchema),
});

export const sessionSchema = z.object({
  sessionValidator: addressSchema,
  sessionValidatorInitData: hexSchema,
  salt: hexSchema.default("0x00"), // Optional with default to 0
  // TODO: make the below optional but require one of them to be defined
  userOpPolicies: z.array(policyDataSchema),
  erc7739Policies: erc7739DataSchema,
  actions: z.array(actionDataSchema),
  permitERC4337Paymaster: z.boolean(),
  chainId: bigIntLikeSchema,
});

export const chainDigestsSchema = z.object({
  chainId: bigIntLikeSchema,
  sessionDigest: hexSchema,
});

export const enableSessionSchema = z.object({
  chainDigestIndex: intLikeSchema,
  hashesAndChainIds: z.array(chainDigestsSchema),
  sessionToEnable: sessionSchema,
  permissionEnableSig: hexSchema,
});

export const enableSessionDataSchema = z.object({
  enableSession: enableSessionSchema,
  validator: addressSchema,
  accountType: AccountTypeEnum,
});

export const grantPermissionResponseSchema = z.object({
  signature: hexSchema,
  mode: hexSchema,
  permissionId: hexSchema,
  enableSessionData: enableSessionDataSchema,
});
