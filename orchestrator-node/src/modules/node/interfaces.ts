import { type ConfigType } from "@/core/config";
import { type HealthCheckDataWithChains } from "@/health-check";
import { type Address, type Hex } from "viem";
import { type HDAccount, type PrivateKeyAccount } from "viem/accounts";
import { type nodeConfig } from "./node.config";

export interface NodeInfo
  extends Pick<
    ConfigType<typeof nodeConfig>,
    "name" | "feeBeneficiary" | "feePercentage"
  > {
  name?: string;
  address: Hex;
  version?: string;
  wallets: Hex[];
}

export type NodeAccount = HDAccount | PrivateKeyAccount;

export type EoaStatus = {
  active: boolean;
  balance: bigint;
};

export type NodeHealthCheckChainWallets = Record<Hex, EoaStatus>;

export type PaymasterHealthCheck = {
  address: Address;
  deployed: boolean;
  balance: bigint;
};

export type NodeHealthCheckData = HealthCheckDataWithChains<{
  paymaster: PaymasterHealthCheck;
  master: EoaStatus;
  workers: NodeHealthCheckChainWallets;
  issues: string[];
}>;
