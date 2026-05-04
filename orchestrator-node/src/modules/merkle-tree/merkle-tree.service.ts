import { type PackedMeeUserOp, UserOpService } from "@/user-ops";
import {
  getMeeUserOpHash,
  getMeeUserOpHashEip712,
} from "@/user-ops/utils/hash-mee-userop";
import { SimpleMerkleTree } from "@openzeppelin/merkle-tree";
import { Service } from "typedi";
import { type Hex } from "viem";
import { SimpleTreeHashOptions } from "./interfaces";

@Service()
export class MerkleTreeService {
  constructor(private readonly userOpService: UserOpService) {}

  createMerkleTree(
    packedMeeUserOps: Array<PackedMeeUserOp>,
    isSimpleMode: boolean,
    isEIP712SupportedMeeVersion: boolean,
    isTrustedSponsorship: boolean,
  ) {
    const leafHashes = packedMeeUserOps.map((packedMeeUserOp, index) => {
      return this.hashSimpleTreeLeaf(packedMeeUserOp, {
        shortEncoding: packedMeeUserOp.shortEncoding,
        // if the meeVersion is EIP712 supported and this is simple mode stx
        isEip712Hash: isEIP712SupportedMeeVersion && isSimpleMode,
        isTrustedPaymentUserOp: index === 0 && isTrustedSponsorship,
      });
    });

    return SimpleMerkleTree.of(leafHashes, { sortLeaves: true });
  }

  hashSimpleTreeLeaf(
    packedMeeUserOp: PackedMeeUserOp,
    options: SimpleTreeHashOptions = {
      shortEncoding: false,
      isEip712Hash: false,
      isTrustedPaymentUserOp: false,
    },
  ): string {
    const { chainId, lowerBoundTimestamp, upperBoundTimestamp } =
      packedMeeUserOp;

    let userOpHash: Hex = "0x";

    if (options.isTrustedPaymentUserOp) {
      userOpHash = packedMeeUserOp.userOpHash;
    } else {
      userOpHash = this.userOpService.getEntryPointV7UserOpHash(
        chainId,
        this.userOpService.getPackedUserOpHash(packedMeeUserOp.userOp),
      );
    }

    if (options.shortEncoding) {
      return userOpHash;
    }

    if (options.isEip712Hash) {
      return getMeeUserOpHashEip712(
        userOpHash,
        lowerBoundTimestamp,
        upperBoundTimestamp,
      );
    }
    return getMeeUserOpHash(
      userOpHash,
      lowerBoundTimestamp,
      upperBoundTimestamp,
    );
  }
}
