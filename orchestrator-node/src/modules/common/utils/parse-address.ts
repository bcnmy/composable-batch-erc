import { type Hex, getAddress } from "viem";

export function parseAddress(address: string | undefined) {
  if (!address) {
    return;
  }

  let result: Hex | undefined;

  try {
    result = getAddress(address);
  } catch {
    //
  }

  return result;
}
