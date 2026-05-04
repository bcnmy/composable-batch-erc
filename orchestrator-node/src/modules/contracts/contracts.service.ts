import { type ChainContractName, ChainsService } from "@/chains";
import { Service } from "typedi";
import { ABI_MAP, DEPLOYED_BYTE_CODE_MAP } from "./resources";

@Service()
export class ContractsService {
  constructor(private readonly chainsService: ChainsService) {}

  getContractAddress<
    ContractName extends keyof typeof ABI_MAP & ChainContractName,
  >(contractName: ContractName, chainId: string) {
    return this.chainsService.getChainContractAddress(chainId, contractName);
  }

  getContractByteCode<ContractName extends keyof typeof ABI_MAP>(
    contractName: ContractName,
  ) {
    return DEPLOYED_BYTE_CODE_MAP[contractName] || "0x";
  }

  getContractAbi<ContractName extends keyof typeof ABI_MAP>(
    contractName: ContractName,
  ) {
    return ABI_MAP[contractName];
  }
}
