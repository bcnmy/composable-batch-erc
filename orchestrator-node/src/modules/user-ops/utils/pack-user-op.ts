import { packUint128Pair } from "@/common";
import {
  type PackedUserOp,
  type SignedPackedUserOp,
  type SignedUserOp,
  type UserOp,
} from "../interfaces";

export function packUserOp(userOp: UserOp): PackedUserOp;
export function packUserOp(userOp: SignedUserOp): SignedPackedUserOp;
export function packUserOp(
  userOp: UserOp | SignedUserOp,
): PackedUserOp | SignedPackedUserOp {
  const {
    sender,
    nonce,
    initCode,
    callData,
    paymasterAndData,
    preVerificationGas,
    verificationGasLimit,
    callGasLimit,
    maxFeePerGas,
    maxPriorityFeePerGas,
    ...rest
  } = userOp;

  return {
    sender,
    nonce,
    initCode,
    callData,
    accountGasLimits: packUint128Pair(verificationGasLimit, callGasLimit),
    gasFees: packUint128Pair(maxPriorityFeePerGas, maxFeePerGas),
    paymasterAndData,
    preVerificationGas,
    ...rest,
  };
}
