import { type Request, type RequestHandler } from "express";
import { entries } from "remeda";
import { type ZodSchema } from "zod";

export function validate(
  schemas: {
    [K in Extract<keyof Request, "params" | "body">]?: ZodSchema;
  },
): RequestHandler {
  const schemasEntries = entries(schemas);

  return async (req, _res, next) => {
    for (const [key, schema] of schemasEntries) {
      req[key] = await schema.parseAsync(req[key]);
    }

    next();
  };
}
