import { HttpException } from "./http.exception";

export class InternalServerErrorException extends HttpException {
  constructor() {
    super(500);
  }
}
