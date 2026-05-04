import { parseNum } from "./parse-num";

export function parsePort(value: string | undefined, defaults: number) {
  return parseNum(value, defaults, { min: 1, max: 65535 });
}
