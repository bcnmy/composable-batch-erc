import { type Hex, concatHex, pad, toHex } from "viem";

export function packUint128Pair(a: bigint | number, b: bigint | number): Hex {
  return concatHex([
    pad(toHex(a), {
      size: 16,
      dir: "left",
    }),
    pad(toHex(b), {
      size: 16,
      dir: "left",
    }),
  ]);
}
