import { Hex } from "viem";

export function buildRedisKey(type: "cache", key: string): string;
export function buildRedisKey(
  type: "quote",
  hash: Hex,
  postfix: "data" | "user-ops",
): string;
export function buildRedisKey(
  type: "user-op",
  hash: Hex,
  postfix: "data" | "custom-fields",
): string;
export function buildRedisKey(...args: string[]) {
  return `storage:${args.join(":")}`;
}
