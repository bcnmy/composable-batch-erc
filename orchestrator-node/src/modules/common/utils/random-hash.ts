import { randomBytes } from "node:crypto";
import { toHex } from "viem";

export function randomHash() {
  return toHex(randomBytes(32));
}
