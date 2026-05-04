import { HttpException } from "./http.exception";

export class NotFoundException extends HttpException {
  constructor(customMessage?: string) {
    super(404, customMessage);
  }
}
