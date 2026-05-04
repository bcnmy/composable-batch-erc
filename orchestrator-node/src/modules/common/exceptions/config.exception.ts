import { AbstractException } from "./abstract.exception";

export class ConfigException extends AbstractException {
  constructor(
    envKey: string,
    reason: "missing" | "invalid" | "unsupported" = "missing",
  ) {
    super(`${envKey} is ${reason}`);
  }
}
