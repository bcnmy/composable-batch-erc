import {
  type MeeUserOp,
  type PackedMeeUserOp,
  type SignedMeeUserOp,
  type SignedPackedMeeUserOp,
} from "../interfaces";
import { packUserOp } from "./pack-user-op";

export function packMeeUserOp(meeUserOp: MeeUserOp): PackedMeeUserOp;
export function packMeeUserOp(
  meeUserOp: SignedMeeUserOp,
): SignedPackedMeeUserOp;
export function packMeeUserOp(
  meeUserOp: MeeUserOp | SignedMeeUserOp,
): PackedMeeUserOp | SignedPackedMeeUserOp {
  const { userOp, ...rest } = meeUserOp;

  return {
    userOp: packUserOp(userOp),
    ...rest,
  };
}
