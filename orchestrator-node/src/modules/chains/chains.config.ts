import process from "node:process";
import { parseSeconds } from "@/common";
import { registerConfigAs } from "@/core/config";
import { type ChainsConfig } from "./interfaces";

export const chainsConfig = registerConfigAs<{
  oraclePriceFeedTTL: number;
  searchPaths?: string[];
  chains?: ChainsConfig;
}>("chains", () => ({
  oraclePriceFeedTTL: parseSeconds(process.env.ORACLE_PRICE_FEED_TTL, 60, {
    min: 1,
  }),
  searchPaths: [
    process.env.CUSTOM_CHAINS_CONFIG_PATH,
    "./config/chains",
    "./chains",
  ].filter(Boolean) as string[],
}));
