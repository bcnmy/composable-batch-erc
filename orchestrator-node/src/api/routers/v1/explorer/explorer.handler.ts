import { withTrace } from "@/common/utils/trace-wrapper";
import { type GetQuoteOptions, QuotesService, getQuoteSchema } from "@/quotes";
import { type RequestHandler } from "express";
import { Container } from "typedi";
import { API_VERSION } from "../constants";

export const explorerHandler: RequestHandler<
  Pick<GetQuoteOptions, "hash">,
  unknown,
  never,
  unknown
> = async (req, res) => {
  const { params, query } = req;

  // This query cannot be validated, parsed and attached to req object in validate middleware due to query being a strict readonly property in req object.
  const validatedQuery = await getQuoteSchema
    .pick({ confirmations: true })
    .parseAsync(query);

  await withTrace(
    `/${API_VERSION}/explorer`,
    async (_req, res) => {
      res.send(
        await Container.get(QuotesService).getQuote({
          ...params,
          ...validatedQuery,
        }),
      );
    },
    {
      hash: params.hash,
    },
  )(req, res);
};
