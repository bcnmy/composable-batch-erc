import { DebugTraceCallCallTracerResponse } from "@/entry-point";
import { type HealthCheckDataWithChains } from "@/health-check";
import {
  type Address,
  type BlockTag,
  type Chain as ChainDefinition,
  type Hex,
  type HttpTransport,
  type PublicClient,
  type StateMapping,
  type StateOverride,
  type TransactionRequest,
  type WalletClient,
} from "viem";
import { type HDAccount, type PrivateKeyAccount } from "viem/accounts";
import { z } from "zod";
import {
  chainConfigContractsSchema,
  chainConfigPaymentTokenSchema,
  chainConfigSchema,
  paymentTokenSchema,
} from "./schemas";

export interface ChainClientDebugTraceCallReturnType
  extends DebugTraceCallCallTracerResponse {}

export interface ChainClientTraceTransactionCallType {
  // Currently, we only use the following returned fields:
  from?: Address;
  to?: Address;
  input?: Hex;
  output?: Hex;
  value?: Hex;
  calls?: ChainClientTraceTransactionCallType[];
}

export interface ChainClientTraceTransactionReturnType {
  // Currently, we only use the following returned fields:
  error?: {
    code: number;
    message: string;
    data: string;
  };
  result?: ChainClientTraceTransactionCallType;
}

export interface ChainClientTraceTransactionCallType {
  // Currently, we only use the following returned fields:
  from?: Address;
  to?: Address;
  input?: Hex;
  output?: Hex;
  value?: Hex;
  calls?: ChainClientTraceTransactionCallType[];
}

export interface ChainClientTraceTransactionReturnType {
  // Currently, we only use the following returned fields:
  error?: {
    code: number;
    message: string;
    data: string;
  };
  result?: ChainClientTraceTransactionCallType;
}

export type ChainClientRpcSchema = [
  {
    Method: "debug_traceCall";
    Parameters: unknown;
    ReturnType: ChainClientDebugTraceCallReturnType;
  },
];

export interface RawStateOverrides {
  [address: Address]: {
    balance?: Hex;
    code?: StateOverride[number]["code"];
    nonce?: StateOverride[number]["nonce"];
    state?: Record<StateMapping[number]["slot"], StateMapping[number]["value"]>;
    stateDiff?: Record<
      StateMapping[number]["slot"],
      StateMapping[number]["value"]
    >;
  };
}

export interface ChainClientExtended {
  connectAccount(
    account: HDAccount | PrivateKeyAccount,
  ): WalletClient<HttpTransport>;
  trace: {
    transaction(
      hash: Hex,
    ): Promise<ChainClientTraceTransactionCallType | undefined>;
  };
  transaction: {
    sendTransactionSyncSupported: Promise<boolean>;
  };
  debug: {
    traceCallSupported: Promise<boolean>;
    traceCall(
      tx: TransactionRequest,
      blockTag?: BlockTag,
      options?: {
        tracer?: "callTracer" | "prestateTracer";
        tracerConfig?: {
          onlyTopCall?: true;
        };
        stateOverrides?: RawStateOverrides;
      },
    ): Promise<ChainClientDebugTraceCallReturnType>;
  };
}

export type ChainClient = PublicClient<
  HttpTransport,
  ChainDefinition,
  undefined,
  ChainClientRpcSchema
> &
  ChainClientExtended;

export type ChainConfig = z.input<typeof chainConfigSchema>;

export type ChainsConfig = Record<string, ChainConfig>;

export type ChainSettings = z.infer<typeof chainConfigSchema>;

export type ChainPaymentToken = z.infer<typeof chainConfigPaymentTokenSchema>;

export type PaymentToken = z.infer<typeof paymentTokenSchema>;

export type ChainContractName = keyof z.infer<
  typeof chainConfigContractsSchema
>;

export interface Chain {
  settings: ChainSettings;
  paymentTokens: Map<Hex, ChainPaymentToken>;
}

export type ChainsHealthCheckData = HealthCheckDataWithChains<{
  checks: {
    rpcCall: boolean;
    debugTraceCall: boolean;
  };
}>;

export type ChainIdLike = string | number | bigint;
