import { isArray } from "remeda";
import { type ZodError } from "zod";
import { HttpException } from "./http.exception";

export class BadRequestException extends HttpException {
  static fromZodError(err: ZodError) {
    const errors = err.errors.map(({ path, message }) => ({
      path,
      message: message,
    }));

    return new BadRequestException(...errors);
  }

  constructor(
    ...errors: (
      | {
          path: string | Array<string | number>;
          message: string;
        }
      | string
    )[]
  ) {
    super(
      400,
      errors.length
        ? {
            errors: errors.map((error) => {
              switch (typeof error) {
                case "string":
                  return {
                    message: error,
                  };
                default: {
                  const { path, message } = error;
                  return {
                    path: isArray(path)
                      ? path
                          .map((key) =>
                            typeof key === "number" ? `[${key}]` : key,
                          )
                          .join(".")
                      : path,
                    message,
                  };
                }
              }
            }),
          }
        : undefined,
    );
  }
}
