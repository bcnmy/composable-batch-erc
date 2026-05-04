import process from "node:process";
import { parseSeconds } from "@/common";
import { registerConfigAs } from "@/core/config";

export const priceFeedsConfig = registerConfigAs("price-feeds", () => ({
  oraclePriceFeedTTL: parseSeconds(process.env.ORACLE_PRICE_FEED_TTL, 60, {
    min: 1,
  }),
}));
