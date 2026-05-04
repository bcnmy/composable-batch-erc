import { Container } from "typedi";
import { type ConfigFactory, type RegisteredConfig } from "../interfaces";

export function registerConfigAs<T extends object>(
  name: string,
  factory: ConfigFactory<T>,
): RegisteredConfig<T> {
  const token = `Config(${name})`;

  Container.set({
    id: token,
    factory,
  });

  return {
    token,
    factory,
  };
}
