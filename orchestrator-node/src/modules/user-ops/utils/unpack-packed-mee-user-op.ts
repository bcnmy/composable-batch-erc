import {
  type MeeUserOp,
  type PackedMeeUserOp,
  type SignedMeeUserOp,
  type SignedPackedMeeUserOp,
} from "../interfaces";
import { unpackPackedUserOp } from "./unpack-packed-user-op";

export function unpackPackedMeeUserOp(
  packedMeeUserOp: PackedMeeUserOp,
): MeeUserOp;
export function unpackPackedMeeUserOp(
  packedMeeUserOp: SignedPackedMeeUserOp,
): SignedMeeUserOp;
export function unpackPackedMeeUserOp(
  packedMeeUserOp: PackedMeeUserOp | SignedPackedMeeUserOp,
) {
  const { userOp, ...rest } = packedMeeUserOp;

  return {
    ...rest,
    userOp: unpackPackedUserOp(userOp),
  };
}
