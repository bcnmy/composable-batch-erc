import { type MeeUserOp, type UserOpEntity } from "@/user-ops";
import { z } from "zod";
import {
  executeQuoteSchema,
  getQuoteSchema,
  meeQuoteSchema,
  meeVersionSchema,
  meeVersionWithChainIdSchema,
  quoteTypeSchema,
  requestQuotePermitSchema,
  requestQuoteSchema,
  triggerSchema,
} from "./schemas";

export type QuoteType = z.infer<typeof quoteTypeSchema>;

export type TriggerType = z.infer<typeof triggerSchema>;

export type MeeVersionWithChainIdsType = z.infer<
  typeof meeVersionWithChainIdSchema
>;

export type MeeVersionsType = z.infer<typeof meeVersionSchema>;

export type RequestQuoteOptions = z.infer<typeof requestQuoteSchema>;

export type RequestQuotePermitOptions = z.infer<
  typeof requestQuotePermitSchema
>;

export type MeeQuote = z.infer<typeof meeQuoteSchema>;

export type ExecuteQuoteOptions = z.infer<typeof executeQuoteSchema>;

export type GetQuoteOptions = z.infer<typeof getQuoteSchema>;

// entity & response

export interface QuoteEntity extends Omit<ExecuteQuoteOptions, "userOps"> {
  userOps: UserOpEntity[];
}

export interface QuoteResponse extends Omit<ExecuteQuoteOptions, "userOps"> {
  userOps: Array<MeeUserOp & {}>;
}
