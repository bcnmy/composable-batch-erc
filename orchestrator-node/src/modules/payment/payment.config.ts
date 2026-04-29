import process from "node:process";
import { registerConfigAs } from "@/core/config";

export const paymentConfig = registerConfigAs("payment", () => {
  // This is not a mandatory env's to be configured. So no validation is required
  const gluexApiKey = process.env.GLUEX_API_KEY;
  const gluexPartnerUniqueId = process.env.GLUEX_PARTNER_UNIQUE_ID;

  // This is not a mandatory env's to be configured. So no validation is required
  const lifiApiKey = process.env.LIFI_API_KEY;

  return {
    gluexApiKey,
    gluexPartnerUniqueId,
    lifiApiKey,
  };
});
