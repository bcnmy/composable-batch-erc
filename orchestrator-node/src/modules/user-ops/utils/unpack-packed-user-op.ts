import { unpackUint128Pair } from "@/common";
import {
  type PackedUserOp,
  type SignedPackedUserOp,
  type SignedUserOp,
  type UserOp,
} from "../interfaces";

export function unpackPackedUserOp(userOp: PackedUserOp): UserOp;
export function unpackPackedUserOp(userOp: SignedPackedUserOp): SignedUserOp;
export function unpackPackedUserOp(
  packedUserOp: PackedUserOp | SignedPackedUserOp,
): UserOp | SignedUserOp {
  const {
    sender,
    nonce,
    initCode,
    callData,
    paymasterAndData,
    preVerificationGas,
    accountGasLimits,
    gasFees,
    ...rest
  } = packedUserOp;

  const [verificationGasLimit, callGasLimit] =
    unpackUint128Pair(accountGasLimits);
  const [maxPriorityFeePerGas, maxFeePerGas] = unpackUint128Pair(gasFees);

  return {
    sender,
    nonce,
    initCode,
    callData,
    callGasLimit,
    verificationGasLimit,
    maxFeePerGas,
    maxPriorityFeePerGas,
    paymasterAndData,
    preVerificationGas,
    ...rest,
  };
}
