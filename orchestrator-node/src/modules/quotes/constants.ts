export enum MeeSignatureType {
  OFF_CHAIN = "0x177eee00",
  ON_CHAIN = "0x177eee01",
  ERC20_PERMIT = "0x177eee02",
  MM_DTK = "0x177eee03",
  SAFE_SA = "0x177eee04",
  OFF_CHAIN_P256 = "0x177eee10",
}

export const MEE_SIGNATURE_TYPE_OFFSET = 4;

export enum ExecutionStatus {
  SKIPPED = "SKIPPED",
  PENDING = "PENDING",
  MINING = "MINING",
  FAILED = "FAILED", // FINAL STATE (offchain failure)
  SUCCESS = "SUCCESS", // backward compatibility
  MINED_SUCCESS = "MINED_SUCCESS", // FINAL STATE (onchain success)
  MINED_FAIL = "MINED_FAIL", // FINAL STATE (onchain failure)
}

export enum NodePmMode {
  USER = "0x170de000",
  DAPP = "0x170de001",
  KEEP = "0x170de002",
}

export enum NodePmPremium {
  PERCENT = "0x9ee4ce00",
  FIXED = "0x9ee4ce01",
}

export enum NexusExecutionMode {
  SINGLE = "0x0000000000000000000000000000000000000000000000000000000000000000",
  BATCH = "0x0100000000000000000000000000000000000000000000000000000000000000",
}

// keccak256("SuperTx(MeeUserOp[] meeUserOps)MeeUserOp(bytes32 userOpHash,uint256 lowerBoundTimestamp,uint256 upperBoundTimestamp)")
export const SUPERTX_MEEUSEROP_STRUCT_TYPEHASH =
  "0x18920ab59b79e66eb8250f08215198bc72e5a4b3822706ea145ae8f0cbb22526";

// keccak256("MeeUserOp(bytes32 userOpHash,uint256 lowerBoundTimestamp,uint256 upperBoundTimestamp)");
export const MEE_USER_OP_TYPEHASH =
  "0x15a3822da13714219f4ba907e3daf8f006f6903616b4e7918e84eb2b8faf733d";
