import { HttpException } from "./http.exception";

export class UnauthorizedException extends HttpException {
  constructor() {
    super(401);
  }
}
