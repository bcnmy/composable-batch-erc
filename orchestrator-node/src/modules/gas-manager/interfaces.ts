import type { GetFeeHistoryReturnType, GetGasPriceReturnType } from "viem";

export type GasManagerConfig = {
  chainId: string;
  gasFetchInterval: number;
};

export type GasInfo = {
  gasPrice: GetGasPriceReturnType | null;
  feeHistory: GetFeeHistoryReturnType | null;
  maxPriorityFee: bigint | null;
};

export type GasManagerEvents = {
  sync: { chainId: string; gasInfo: GasInfo };
};

export type GasManagerEventHandler<T> = (payload: T) => void | Promise<void>;

export type GasManagerEventHandlers = {
  [K in keyof GasManagerEvents]?: GasManagerEventHandler<GasManagerEvents[K]>[];
};
