import { ChainConfig } from "@/chains";

// Type-safe access to gas limit overrides with fallback to config
export const getOverrideOrDefault = <K extends string>(
  key: K,
  defaultValue: number,
  gasLimitOverrides: ChainConfig["gasLimitOverrides"],
): bigint => {
  const overrides = gasLimitOverrides as
    | Record<string, bigint | number | undefined>
    | undefined;

  // Check if the property exists in the object (handles null, 0, etc.)
  if (overrides && key in overrides) {
    const overrideValue = overrides[key];
    // Only use override if it's a valid number/bigint (not null or undefined)
    if (overrideValue !== null && overrideValue !== undefined) {
      return BigInt(overrideValue);
    }
  }

  return BigInt(defaultValue);
};
