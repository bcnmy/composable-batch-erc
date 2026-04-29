import { Router } from "express";
import { healthHandler } from "./health.handler";
import { indexHandler } from "./index.handler";

export const nodeRouter = Router()
  .get("/", indexHandler)
  .get("/health", healthHandler);
