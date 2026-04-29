import { ChainsService } from "@/chains";
import { BadRequestException, withTrace } from "@/common";
import { Logger } from "@/core/logger";
import { RpcManagerService } from "@/rpc-manager";
import { Service } from "typedi";
import type { BlockTag } from "viem";
import {
  type GasInfo,
  type GasManagerConfig,
  type GasManagerEventHandler,
  type GasManagerEventHandlers,
  type GasManagerEvents,
} from "./interfaces";

@Service()
export class GasManagerService {
  private gasInfoFetchingInProgress: Map<string, boolean> = new Map();
  private gasInfosByChain: Map<string, GasInfo> = new Map();
  private readonly eventHandlers: GasManagerEventHandlers = {};
  private sync = false;
  private legacyGasPriceHistory: bigint[] = [];
  private readonly maxHistorySize = 20;

  constructor(
    private readonly logger: Logger,
    private readonly rpcManagerService: RpcManagerService,
    private readonly chainsService: ChainsService,
  ) {
    logger.setCaller(GasManagerService);
  }

  /**
   * Starts gas info fetch intervals for all provided chain configs.
   * @param configs List of chain/configs to fetch gas info for.
   */
  async initialize(configs: GasManagerConfig[], sync = false) {
    // This should be only enabled on master thread so it will be synced to worker threads
    this.sync = sync;

    await Promise.all(
      configs.map((config) =>
        this.fetchGasInfoOnInterval(config.chainId, config.gasFetchInterval),
      ),
    );

    this.logger.trace(
      {
        configs,
      },
      "Gas Manager initialized",
    );
  }

  /**
   * Retrieves the latest known gas price for the given chainId.
   * Throws if no info is available.
   * @param chainId Chain identifier.
   * @returns Gas price.
   */
  async getLatestGasPrice(chainId: string, forceFetch = false) {
    if (forceFetch) {
      await this.fetchGasInfo(chainId);
    }

    const gasInfo = this.gasInfosByChain.get(chainId);

    if (!gasInfo) {
      throw new BadRequestException("Failed to fetch gas price");
    }

    if (gasInfo.gasPrice === null) {
      throw new BadRequestException("Failed to fetch gas price");
    }

    return gasInfo.gasPrice;
  }

  /**
   * Retrieves the latest known fee history for the given chainId.
   * Throws if no info is available.
   * @param chainId Chain identifier.
   * @returns Fee history.
   */
  async getLatestFeeHistory(chainId: string, forceFetch = false) {
    if (forceFetch) {
      await this.fetchGasInfo(chainId);
    }

    const gasInfo = this.gasInfosByChain.get(chainId);

    if (!gasInfo) {
      throw new BadRequestException("Failed to fetch fee history");
    }

    if (gasInfo.feeHistory === null) {
      throw new BadRequestException("Failed to fetch fee history");
    }

    return gasInfo.feeHistory;
  }

  /**
   * Retrieves the latest known max priority fee for the given chainId.
   * Throws if no info is available.
   * @param chainId Chain identifier.
   * @returns Max priority fee.
   */
  async getLatestMaxPriorityFee(chainId: string, forceFetch = false) {
    if (forceFetch) {
      await this.fetchGasInfo(chainId);
    }

    const gasInfo = this.gasInfosByChain.get(chainId);

    if (!gasInfo) {
      throw new BadRequestException("Failed to fetch max priority fee");
    }

    if (gasInfo.maxPriorityFee === null) {
      throw new BadRequestException("Failed to fetch max priority fee");
    }

    return gasInfo.maxPriorityFee;
  }

  /**
   * Fetches latest gas information for a chain and updates the state.
   * Ensures only one fetch at a time per chain.
   * @param chainId Chain identifier.
   */
  private async fetchGasInfo(chainId: string) {
    try {
      const isInProgress = this.gasInfoFetchingInProgress.get(chainId);
      if (isInProgress) return;

      this.gasInfoFetchingInProgress.set(chainId, true);

      const [gasPrice, feeHistory, maxPriorityFee] = await Promise.all([
        this.getGasPrice(chainId),
        this.getFeeHistroy(chainId),
        this.getMaxPriorityFee(chainId),
      ]);

      const gasInfo: GasInfo = {
        gasPrice,
        feeHistory,
        maxPriorityFee,
      };

      this.logger.trace({ gasInfo, chainId }, "Fetched gas info for chain");

      this.setGasInfo(chainId, gasInfo);
    } catch (error) {
      this.logger.error({ error, chainId }, "Failed to fetch gas info");
    } finally {
      this.gasInfoFetchingInProgress.set(chainId, false);
    }
  }

  /**
   * Starts an interval timer to fetch gas info repeatedly for a given chain.
   * Immediately triggers a fetch, then continues at specified interval.
   * @param chainId Chain identifier.
   * @param intervalMs Milliseconds between fetches (default 2000).
   * @returns A function to stop the interval timer.
   */
  private async fetchGasInfoOnInterval(
    chainId: string,
    intervalMs = 2000,
  ): Promise<() => void> {
    // Immediately fetch once, then schedule subsequent fetches
    await this.fetchGasInfo(chainId);
    const intervalId = setInterval(
      () => this.fetchGasInfo(chainId),
      intervalMs,
    );

    // Return a function to clear the interval (stop fetching)
    return () => {
      clearInterval(intervalId);
    };
  }

  /**
   * Fetches the current legacy gas price for a given chain.
   * @param chainId Chain identifier.
   * @returns Gas price or null if fetching fails.
   */
  private async getGasPrice(chainId: string) {
    const { gasPriceMode } = this.chainsService.chainSettings;

    try {
      const currentGasPrice = await withTrace(
        "gasManager.legacyGasPrice",
        async () =>
          await this.rpcManagerService.executeRequest(
            chainId,
            (chainClient) => {
              return chainClient.getGasPrice();
            },
          ),
        {
          chainId,
        },
      )();

      // Maintain rolling history
      this.legacyGasPriceHistory.push(currentGasPrice);

      if (this.legacyGasPriceHistory.length > this.maxHistorySize) {
        this.legacyGasPriceHistory.shift(); // Remove oldest
      }

      // 10% buffer for standard mode
      // 50% buffer for fast mode
      // 70% buffer for rapid mode
      let buffer = 10n;
      if (gasPriceMode === "fast") buffer = 50n;
      if (gasPriceMode === "rapid") buffer = 70n;

      // Need at least a few samples
      if (this.legacyGasPriceHistory.length < 3) {
        return (currentGasPrice * (100n + buffer)) / 100n;
      }

      // Calculate median from history of gas prices
      const sorted = [...this.legacyGasPriceHistory].sort((a, b) => {
        if (a < b) return -1;
        if (a > b) return 1;
        return 0;
      });

      const mid = Math.floor(sorted.length / 2);
      const medianGasPrice =
        sorted.length % 2 === 0
          ? (sorted[mid - 1] + sorted[mid]) / 2n
          : sorted[mid];

      // Check if current price suggests a spike
      const currentToMedianRatio = (currentGasPrice * 100n) / medianGasPrice;

      let estimatedPrice = 0n;

      if (currentToMedianRatio > 200n && currentToMedianRatio < 500n) {
        // Current gas price is 2-5x higher → possible real gas spike
        // Use average of median and current (weighted toward median)
        estimatedPrice = (medianGasPrice * 2n + currentGasPrice) / 3n;
      } else if (currentToMedianRatio > 500n) {
        // Current gas price is >5x higher → likely outlier, ignore it
        estimatedPrice = medianGasPrice;
      } else if (currentToMedianRatio < 50n) {
        // Current gas price is <50% of median → Current gas price might be stale/broken, ignore it
        estimatedPrice = medianGasPrice;
      } else {
        // Current gas price is within reasonable range (50%-200%) → use the higher value
        estimatedPrice =
          currentGasPrice > medianGasPrice ? currentGasPrice : medianGasPrice;
      }

      return (estimatedPrice * (100n + buffer)) / 100n;
    } catch (error) {
      this.logger.error(
        {
          chainId,
          error,
        },
        "Failed to fetch the gas price",
      );
      return null;
    }
  }

  /**
   * Fetches the current fee history for a given chain.
   * @param chainId Chain identifier.
   * @param rewardPercentiles Percentiles for reward calculation. Default [50].
   * @returns Fee history result or null if fetching fails.
   */
  private async getFeeHistroy(chainId: string) {
    const { gasPriceMode } = this.chainsService.chainSettings;

    try {
      // 50th percentile for "standard" mode
      // 75th percentile for "fast" mode
      // 95th percentile for "rapid" mode
      let rewardPercentiles: number[] = [50];
      if (gasPriceMode === "fast") rewardPercentiles = [75];
      if (gasPriceMode === "rapid") rewardPercentiles = [95];

      // 10 blocks for "standard" mode
      // 5 blocks for "fast" mode
      // 2 blocks for "rapid" mode
      let blockCount = 10;
      if (gasPriceMode === "fast") blockCount = 5;
      if (gasPriceMode === "rapid") blockCount = 2;

      const chainConfig = this.chainsService.getChainSettings(chainId);
      const blockTag: BlockTag =
        (chainConfig.feeHistoryBlockTagOverride as BlockTag) ?? "pending";

      return await withTrace(
        "gasManager.getFeeHistory",
        async () =>
          await this.rpcManagerService.executeRequest(
            chainId,
            (chainClient) => {
              return chainClient.getFeeHistory({
                blockCount,
                blockTag,
                rewardPercentiles,
              });
            },
          ),
        { chainId },
      )();
    } catch (error) {
      this.logger.error(
        {
          chainId,
          error,
        },
        "Failed to fetch the fee history",
      );
      return null;
    }
  }

  /**
   * Fetches the current max priority fee for a given chain and applies a 10% buffer.
   * @param chainId Chain identifier.
   * @returns Max priority fee (with buffer) or null if fetching fails.
   */
  private async getMaxPriorityFee(chainId: string) {
    try {
      const maxPriorityFee = await withTrace(
        "gasManager.maxPriorityFeePerGas",
        async () =>
          await this.rpcManagerService.executeRequest(
            chainId,
            (chainClient) => {
              return chainClient.request({
                method: "eth_maxPriorityFeePerGas",
              });
            },
          ),
        {
          chainId,
        },
      )();

      return BigInt(maxPriorityFee as string);
    } catch (error) {
      this.logger.error(
        {
          chainId,
          error,
        },
        "Failed to fetch the max priority fee",
      );
      return null;
    }
  }

  /**
   * Updates the stored gas info for a chain. Maintains existing values if new data is null.
   * @param chainId Chain identifier.
   * @param newGasInfo GasInfo object containing latest data.
   */
  private setGasInfo(chainId: string, newGasInfo: GasInfo): void {
    const previousGasInfo = this.gasInfosByChain.get(chainId);

    if (!previousGasInfo) {
      this.gasInfosByChain.set(chainId, newGasInfo);

      // Syncing will be only enabled on master thread for thread sync
      if (this.sync) {
        this.emit("sync", { chainId, gasInfo: newGasInfo });
      }

      return;
    }

    // If somehow the gas fields of the new gas info value is null, we will stick with old value itself
    const updatedGasInfo = {
      gasPrice:
        newGasInfo.gasPrice !== null
          ? newGasInfo.gasPrice
          : previousGasInfo.gasPrice,
      feeHistory:
        newGasInfo.feeHistory !== null
          ? newGasInfo.feeHistory
          : previousGasInfo.feeHistory,
      maxPriorityFee:
        newGasInfo.maxPriorityFee !== null
          ? newGasInfo.maxPriorityFee
          : previousGasInfo.maxPriorityFee,
    };

    this.gasInfosByChain.set(chainId, updatedGasInfo);

    // Syncing will be only enabled on master thread for thread sync
    if (this.sync) {
      this.emit("sync", { chainId, gasInfo: updatedGasInfo });
    }
  }

  syncGasInfo(chainId: string, newGasInfo: GasInfo) {
    this.setGasInfo(chainId, newGasInfo);
  }

  on<K extends keyof GasManagerEvents>(
    event: K,
    handler: GasManagerEventHandler<GasManagerEvents[K]>,
  ) {
    if (!this.eventHandlers[event]) {
      this.eventHandlers[event] = [];
    }

    this.eventHandlers[event].push(handler);

    return this;
  }

  private async emit<K extends keyof GasManagerEvents>(
    event: K,
    payload: unknown,
  ) {
    const handlers = this.eventHandlers[event];

    if (!handlers) {
      return;
    }

    for (const handler of handlers) {
      await handler(payload as GasManagerEvents[K]);
    }
  }
}
