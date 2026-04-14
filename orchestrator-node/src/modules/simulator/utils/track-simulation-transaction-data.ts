import { DEFAULT_GLOBAL_EXPIRATION_TIME, StorageService } from "@/storage";
import { SignedPackedMeeUserOp } from "@/user-ops";
import Container from "typedi";
import { getUserOpTransactionData } from "./get-simulation-transaction-data";

export const trackSimulationTransactionData = async (
  meeUserOp: SignedPackedMeeUserOp,
) => {
  const storageService = Container.get(StorageService);

  const { meeUserOpHash } = meeUserOp;

  const txData = await getUserOpTransactionData(meeUserOp);

  // Updating userOp in background to improve latency
  await storageService.createUserOpCustomField(
    meeUserOpHash,
    "simulationTransactionData",
    txData,
    // 15 days expiration
    { ttl: DEFAULT_GLOBAL_EXPIRATION_TIME },
  );
};
