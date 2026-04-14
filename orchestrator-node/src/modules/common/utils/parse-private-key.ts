import { isHash } from "viem";
import { privateKeyToAddress } from "viem/accounts";

export function parsePrivateKey(value: string | undefined) {
  if (!value) {
    return;
  }

  if (!isHash(value)) {
    return;
  }

  try {
    if (privateKeyToAddress(value)) {
      return value;
    }
  } catch {
    //
  }
}
