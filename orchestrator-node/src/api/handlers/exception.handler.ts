import { ApiError } from "@/api-call";
import {
  AbstractException,
  BadRequestException,
  HttpException,
  InternalServerErrorException,
} from "@/common";
import { Logger } from "@/core/logger";
import { type ErrorRequestHandler } from "express";
import { Container } from "typedi";
import { ZodError } from "zod";

export const exceptionHandler: ErrorRequestHandler = (
  err: unknown,
  _req,
  res,
  _next,
) => {
  let exception: HttpException;

  if (err instanceof HttpException) {
    exception = err;
  } else if (err instanceof AbstractException) {
    exception = new BadRequestException(err.message);
  } else if (err instanceof ZodError) {
    exception = BadRequestException.fromZodError(err);
  } else {
    if ((err as ApiError).isApiError) {
      exception = new BadRequestException((err as ApiError).message);
    } else {
      // Unhandled error
      Container.get(Logger).error(err);

      exception = new InternalServerErrorException();
    }
  }

  const { statusCode, response } = exception;

  res.status(statusCode).send(response);
};
