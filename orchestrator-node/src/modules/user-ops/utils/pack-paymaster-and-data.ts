import { type Hex, concat, pad, toHex } from "viem";

export function packPaymasterData(
  paymaster: Hex,
  paymasterVerificationGasLimit: bigint,
  postOpGasLimit: bigint,
  paymasterData: Hex,
): Hex {
  return concat([
    paymaster,
    pad(toHex(paymasterVerificationGasLimit), { size: 16 }),
    pad(toHex(postOpGasLimit), { size: 16 }),
    paymasterData,
  ]);
}
