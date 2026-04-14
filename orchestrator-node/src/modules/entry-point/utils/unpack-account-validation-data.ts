import { fromHex, pad, slice, toHex } from "viem";
import { type AccountValidationData } from "../interfaces";

export function unpackAccountValidationData(
  accountValidationData: bigint,
): AccountValidationData {
  const validationData = pad(toHex(accountValidationData), {
    size: 32,
  });

  const sigFailed = fromHex(slice(validationData, 12), "number");
  const validAfter = fromHex(slice(validationData, 0, 6), "number");
  const validUntil = fromHex(slice(validationData, 6, 12), "number");

  return {
    sigFailed,
    validAfter,
    validUntil,
  };
}
