import { validate } from "@/common";
import {
  executeQuoteSchema,
  getQuoteSchema,
  requestQuotePermitSchema,
  requestQuoteSchema,
} from "@/quotes";
import { Router } from "express";
import { PATHS } from "./constants";
import { execHandler } from "./exec";
import { explorerHandler } from "./explorer";
import { infoHandler } from "./info";
import { quoteHandler, quotePermitHandler } from "./quote";

export const v1Router = Router()
  .get(PATHS.info, infoHandler)
  .get(
    `${PATHS.explorer}:hash`,
    validate({
      params: getQuoteSchema.pick({ hash: true }),
    }),
    explorerHandler,
  )
  .post(
    PATHS.quote,
    validate({
      body: requestQuoteSchema,
    }),
    quoteHandler,
  )
  .post(
    PATHS.quotePermit,
    validate({
      body: requestQuotePermitSchema,
    }),
    quotePermitHandler,
  )
  .post(
    PATHS.exec,
    validate({
      body: executeQuoteSchema,
    }),
    execHandler,
  );
