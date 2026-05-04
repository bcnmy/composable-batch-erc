import { MEE_USER_OP_TYPEHASH } from "@/quotes/constants";
import { type Hash, encodeAbiParameters, keccak256 } from "viem";

export function getMeeUserOpHashEip712(
  userOpHash: Hash,
  lowerBoundTimestamp: number,
  upperBoundTimestamp: number,
) {
  return keccak256(
    encodeAbiParameters(
      [
        { type: "bytes32" },
        { type: "uint256" },
        { type: "uint256" },
        { type: "uint256" },
      ],
      [
        MEE_USER_OP_TYPEHASH,
        BigInt(userOpHash),
        BigInt(lowerBoundTimestamp),
        BigInt(upperBoundTimestamp),
      ],
    ),
  );
}

export function getMeeUserOpHash(
  userOpHash: Hash,
  lowerBoundTimestamp: number,
  upperBoundTimestamp: number,
) {
  return keccak256(
    keccak256(
      encodeAbiParameters(
        [{ type: "bytes32" }, { type: "uint256" }, { type: "uint256" }],
        [userOpHash, BigInt(lowerBoundTimestamp), BigInt(upperBoundTimestamp)],
      ),
    ),
  );
}
