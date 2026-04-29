import { type ChainPaymentToken } from "@/chains/interfaces";
import { type Address, type Hex } from "viem";
import { z } from "zod";
import { commonPaymentInfoSchema } from "./schemas";

export type ArbitraryTokenPaymentChain = {
  chainID: string;
  networkID: string;
};

export type ArbitraryTokenPaymentSupportedChainInfo = {
  chains: ArbitraryTokenPaymentChain[];
};

export type FeePaymentType = "NATIVE" | "CONFIGURED_TOKEN" | "ARBITRARY_TOKEN";

export type PaymentInfo = z.infer<typeof commonPaymentInfoSchema>;

export type MeeTransactionType = "normal" | "fusion";

export interface PaymentCalldataParams {
  type: MeeTransactionType;
  tokenAddress: Address;
  amount: bigint;
  eoa?: Address;
}

export interface PreparePaymentUserOpsParams {
  feePaymentType: FeePaymentType;
  paymentInfo: PaymentInfo;
  isTrustedSponsorship: boolean;
  paymentCalldataInfo: PaymentCalldataParams;
}

export type PaymentTransactionData = {
  to: Address;
  data: Hex;
  value: bigint;
  gasLimit: bigint;
};

export type GetPaymentRoutePayload = {
  paymentRouteTransactionData: PaymentTransactionData;
  tokenAmount: { amount: bigint; decimals: number };
};

export type PaymentProviderType = "lifi" | "gluex";

export interface PaymentProvider {
  type: PaymentProviderType;
  getPaymentRouteTransactionData: (
    sender: Address,
    recipient: Address,
    tokenAddress: Address,
    totalCostInDollars: number,
    chainId: string,
  ) => Promise<GetPaymentRoutePayload>;
}
