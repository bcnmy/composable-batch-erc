import { chainConfigPriceSchema } from "@/chains";
import { z } from "zod";

export type PriceFeedOptions = z.infer<typeof chainConfigPriceSchema>;

export interface PriceFeedOracleCache {
  price?: bigint;
  priceExpiry?: number;
  decimals?: number;
}
