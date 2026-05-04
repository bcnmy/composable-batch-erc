import { randomUUID } from "node:crypto";
import { type RequestHandler } from "express";

export const requestIdHandler: RequestHandler = (req, _res, next) => {
  req.id = randomUUID();

  next();
};
