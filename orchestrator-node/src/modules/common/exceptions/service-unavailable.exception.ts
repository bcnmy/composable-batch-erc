import { HttpException } from "./http.exception";

export class ServiceUnavailableException extends HttpException {
  constructor(data?: unknown) {
    super(503, data);
  }
}
