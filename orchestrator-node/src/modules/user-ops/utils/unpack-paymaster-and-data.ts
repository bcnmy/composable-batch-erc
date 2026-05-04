import { type Hex, getAddress, hexToBigInt, slice } from "viem";

export function unpackPaymasterAndData(packedData: Hex) {
  // Paymaster address is the first 20 bytes (40 hex chars + '0x')
  const paymaster = getAddress(slice(packedData, 0, 20));

  // Paymaster verification gas limit is the next 16 bytes
  const paymasterVerificationGasLimitHex = slice(packedData, 20, 36);
  const paymasterVerificationGasLimit = hexToBigInt(
    paymasterVerificationGasLimitHex,
  );

  // Post op gas limit is the next 16 bytes
  const postOpGasLimitHex = slice(packedData, 36, 52);
  const postOpGasLimit = hexToBigInt(postOpGasLimitHex);

  // Paymaster data is the rest of the data
  const paymasterData = slice(packedData, 52);

  return {
    paymaster,
    paymasterVerificationGasLimit,
    postOpGasLimit,
    paymasterData,
  };
}
