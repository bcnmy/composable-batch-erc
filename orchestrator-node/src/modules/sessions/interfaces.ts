import { z } from "zod";
import { SmartSessionMode } from "./constants";
import {
  actionDataSchema,
  chainDigestsSchema,
  enableSessionDataSchema,
  enableSessionSchema,
  erc7739ContextSchema,
  erc7739DataSchema,
  grantPermissionResponseSchema,
  policyDataSchema,
  sessionSchema,
} from "./schemas";

export const AccountTypeEnum = z.enum([
  "erc7579-implementation",
  "kernel",
  "safe",
  "nexus",
]);

export type AccountType = z.infer<typeof AccountTypeEnum>;

export type ChainDigest = z.infer<typeof chainDigestsSchema>;

export type EnableSession = z.infer<typeof enableSessionSchema>;

export type PolicyData = z.infer<typeof policyDataSchema>;

export type ERC7739Data = z.infer<typeof erc7739DataSchema>;

export type ERC7739Context = z.infer<typeof erc7739ContextSchema>;

export type Session = z.infer<typeof sessionSchema>;

export type ActionData = z.infer<typeof actionDataSchema>;

export type EnableSessionData = z.infer<typeof enableSessionDataSchema>;

export type SmartSessionModeType =
  (typeof SmartSessionMode)[keyof typeof SmartSessionMode];

export type GrantPermissionResponseType = z.infer<
  typeof grantPermissionResponseSchema
>;
