import { type Hex, hexToBigInt, sliceHex } from "viem";
import { BadRequestException } from "../exceptions";

export function unpackUint128Pair(packed: Hex): [bigint, bigint] {
  if (packed.length !== 2 + 32 * 2) {
    throw new BadRequestException("Invalid hex length: expected 32 bytes");
  }

  const a = hexToBigInt(sliceHex(packed, 0, 16));
  const b = hexToBigInt(sliceHex(packed, 16, 32));

  return [a, b];
}
