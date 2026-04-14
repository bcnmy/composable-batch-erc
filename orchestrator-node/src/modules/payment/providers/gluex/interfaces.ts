import { type Address, type Hex } from "viem";

export type TokenPaymentQuote = {
  inputToken: Address;
  outputToken: Address;
  feeToken: Address;
  inputSender: Address;
  outputReceiver: Address;
  inputAmount: string;
  outputAmount: string;
  partnerFee: string;
  routingFee: string;
  effectiveInputAmount: string;
  effectiveOutputAmount: string;
  minOutputAmount: string;
  liquidityModules: string[];
  router: Address;
  calldata: Hex;
  blockNumber: number;
  surgeValue: number;
};

export type TokenPairExchangeRate = {
  domestic_token: Address;
  foreign_token: Address;
  domestic_blockchain: string;
  foreign_blockchain: string;
  price: string;
};
