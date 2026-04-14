export type ConfigFactory<T> = () => T;

export interface RegisteredConfig<T = unknown> {
  token: string;
  factory: ConfigFactory<T>;
}

export type ConfigType<T extends RegisteredConfig> = ReturnType<T["factory"]>;
