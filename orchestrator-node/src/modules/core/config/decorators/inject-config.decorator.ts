import { Inject } from "typedi";

export function InjectConfig(registeredConfig: { token: string }) {
  return Inject(registeredConfig.token) as ParameterDecorator;
}
