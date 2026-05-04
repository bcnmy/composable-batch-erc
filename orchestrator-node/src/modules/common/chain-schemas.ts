import { z } from "zod";

export const chainConfigIdSchema = z
  .string()
  .or(z.number())
  .transform((value) => `${value}`);
