import { ContractsService } from "@/contracts";
import { NodeService } from "@/node";
import { RpcManagerService } from "@/rpc-manager";
import { SignedPackedMeeUserOp, SimulationTransactionData } from "@/user-ops";
import Container from "typedi";
import { encodeFunctionData } from "viem";

export const getUserOpTransactionData = async (
  meeUserOp: SignedPackedMeeUserOp,
): Promise<SimulationTransactionData> => {
  const contractsService = Container.get(ContractsService);
  const nodeService = Container.get(NodeService);
  const rpcManagerService = Container.get(RpcManagerService);

  const { chainId, userOp } = meeUserOp;

  const entryPointV7Abi = contractsService.getContractAbi("entryPointV7");
  const entryPointV7Address = contractsService.getContractAddress(
    "entryPointV7",
    chainId,
  );

  const data = encodeFunctionData({
    abi: entryPointV7Abi,
    functionName: "handleOps",
    args: [[userOp], nodeService.address],
  });

  return {
    from: nodeService.address,
    to: entryPointV7Address,
    data,
    value: 0n, // no handleOps deposit is required for new arch contracts
    timestamp: Date.now(),
    blockNumber: await rpcManagerService.executeRequest(
      chainId,
      (chainClient) => {
        return chainClient.getBlockNumber();
      },
    ),
  };
};
