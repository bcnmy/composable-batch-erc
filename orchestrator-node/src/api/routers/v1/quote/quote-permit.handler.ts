import { randomUUID } from "node:crypto";
import { withTrace } from "@/common/utils/trace-wrapper";
import {
  type MeeQuote,
  QuotesService,
  type RequestQuotePermitOptions,
} from "@/quotes";
import { type RequestHandler } from "express";
import { Container } from "typedi";
import { API_VERSION } from "../constants";

export const quotePermitHandler: RequestHandler<
  never,
  MeeQuote,
  RequestQuotePermitOptions,
  never
> = async (req, res) => {
  const { body } = req;
  const requestId = req.id || randomUUID();

  // Collect unique chainIds from paymentInfo and userOps
  const chainIdSet = new Set<string>();

  if (body.paymentInfo?.chainId) {
    chainIdSet.add(body.paymentInfo.chainId);
  }

  if (Array.isArray(body.userOps)) {
    for (const { chainId } of body.userOps) {
      if (chainId !== undefined && chainId !== null) {
        chainIdSet.add(chainId);
      }
    }
  }

  const chainIds = Array.from(chainIdSet);

  await withTrace(
    `/${API_VERSION}/quote-permit`,
    async (_req, res) => {
      res.send(
        await Container.get(QuotesService).requestQuote(requestId, body),
      );
    },
    {
      requestId,
      chainIds: chainIds.join(","),
    },
  )(req, res);
};
