import { NotFoundException } from "@/common";
import { type RequestHandler } from "express";

export const notFoundHandler: RequestHandler = (req) => {
  const { method, url } = req;

  throw new NotFoundException(`Cannot find ${method} ${url}`);
};
