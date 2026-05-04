import process from "node:process";
import {
  ConfigException,
  parseAddress,
  parseMnemonic,
  parseNum,
  parsePrivateKey,
  parseSeconds,
} from "@/common";
import { registerConfigAs } from "@/core/config";
import { type Address, type Hex, isAddress } from "viem";
import { privateKeyToAddress } from "viem/accounts";

export const SPONSORSHIP_GAS_TANK_OWNER: Address =
  "0xA4976687F4e625ce4139dc6Cd1812A0002962500";

export const TRUSTED_GAS_TANK_ADDRESS: Address =
  process.env.TRUSTED_GAS_TANK_ADDRESS &&
  isAddress(process.env.TRUSTED_GAS_TANK_ADDRESS)
    ? process.env.TRUSTED_GAS_TANK_ADDRESS
    : "0x";

export const MAX_EXTRA_WORKERS = parseNum(process.env.MAX_EXTRA_WORKERS, 0, {
  min: 0,
  max: 50,
});

export const WORKER_SPAWN_DELAY = parseSeconds(
  process.env.WORKER_SPAWN_DELAY,
  1,
  {
    min: 1,
    max: 30,
  },
);

export const nodeConfig = registerConfigAs<{
  name?: string;
  privateKey: Hex;
  feeBeneficiary: Hex;
  feePercentage: bigint;
  maxExtraWorkers: number;
  accountsPrivateKeys?: Hex[];
  accountsMnemonic?: string;
}>("node", () => {
  let privateKey = process.env.NODE_PRIVATE_KEY as Hex | undefined;

  if (!privateKey) {
    throw new ConfigException("NODE_PRIVATE_KEY");
  }

  privateKey = parsePrivateKey(privateKey);

  if (!privateKey) {
    throw new ConfigException("NODE_PRIVATE_KEY", "invalid");
  }

  let feeBeneficiary = process.env.NODE_FEE_BENEFICIARY as Hex | undefined;

  if (feeBeneficiary) {
    feeBeneficiary = parseAddress(feeBeneficiary);

    if (!feeBeneficiary) {
      throw new ConfigException("NODE_FEE_BENEFICIARY", "invalid");
    }
  } else {
    feeBeneficiary = privateKeyToAddress(privateKey);
  }

  const feePercentage = BigInt(
    parseNum(process.env.FEE_PERCENTAGE, 10, {
      min: 1,
      max: 100,
    }),
  );

  const accountsPrivateKeys = process.env.NODE_ACCOUNTS_PRIVATE_KEYS
    ? (process.env.NODE_ACCOUNTS_PRIVATE_KEYS.split(",").map((privateKey) =>
        parsePrivateKey(privateKey),
      ) as Hex[])
    : undefined;

  if (accountsPrivateKeys?.some((privateKey) => !privateKey)) {
    throw new ConfigException("NODE_ACCOUNTS_PRIVATE_KEYS", "invalid");
  }

  let accountsMnemonic = process.env.NODE_ACCOUNTS_MNEMONIC;

  if (accountsMnemonic) {
    accountsMnemonic = parseMnemonic(accountsMnemonic);

    if (!accountsMnemonic) {
      throw new ConfigException("NODE_ACCOUNTS_MNEMONIC", "invalid");
    }
  }

  return {
    name: process.env.NODE_NAME || undefined,
    privateKey,
    feeBeneficiary,
    feePercentage,
    accountsPrivateKeys,
    accountsMnemonic,
    maxExtraWorkers: MAX_EXTRA_WORKERS,
    workerSpawnDelay: WORKER_SPAWN_DELAY,
  };
});
