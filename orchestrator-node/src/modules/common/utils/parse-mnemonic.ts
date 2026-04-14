import { mnemonicToAccount } from "viem/accounts";

export function parseMnemonic(value: string | undefined) {
  if (!value) {
    return;
  }

  try {
    if (!mnemonicToAccount(value)) {
      return;
    }
  } catch {
    return;
  }

  return value;
}
