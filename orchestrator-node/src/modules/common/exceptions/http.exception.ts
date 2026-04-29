import { AbstractException } from "./abstract.exception";
import { HTTP_ERRORS } from "./constants";

export class HttpException extends AbstractException {
  constructor(
    readonly statusCode: keyof typeof HTTP_ERRORS,
    private readonly data?: unknown,
  ) {
    super(HTTP_ERRORS[statusCode]);
  }

  get response() {
    if (this.data) {
      switch (typeof this.data) {
        case "object":
          return this.data;

        case "string":
          return {
            statusCode: this.statusCode,
            message: this.data,
          };
      }
    }

    return {
      statusCode: this.statusCode,
      message: this.message,
    };
  }
}
