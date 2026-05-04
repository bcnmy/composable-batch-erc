import { type RequestHandler } from "express";

export const indexHandler: RequestHandler = async (req, _res, next) => {
  req.url = "/v1/info";

  next();
};
