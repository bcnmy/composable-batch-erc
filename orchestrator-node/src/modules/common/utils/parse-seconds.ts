import { parseNum } from "./parse-num";

export function parseSeconds(
  value: string | undefined,
  defaults: number,
  options: {
    min?: number;
    max?: number;
  } = {},
) {
  return Math.floor(
    parseNum(value, defaults, {
      min: 0,
      ...options,
      type: "float",
    }) * 1000,
  );
}
