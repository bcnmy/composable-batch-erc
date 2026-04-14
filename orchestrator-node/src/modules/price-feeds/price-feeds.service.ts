import { type ChainPaymentToken, ChainsService } from "@/chains";
import { ContractsService } from "@/contracts";
import { type ConfigType, InjectConfig } from "@/core/config";
import { RpcManagerService } from "@/rpc-manager";
import { Service } from "typedi";
import { type Hex } from "viem";
import { type PriceFeedOptions, type PriceFeedOracleCache } from "./interfaces";
import { priceFeedsConfig } from "./price-feeds.config";

@Service()
export class PriceFeedsService {
  private readonly oracleCache = new Map<string, PriceFeedOracleCache>();

  constructor(
    @InjectConfig(priceFeedsConfig)
    private readonly config: ConfigType<typeof priceFeedsConfig>,
    private readonly chainsService: ChainsService,
    private readonly contractsService: ContractsService,
    private readonly rpcManagerService: RpcManagerService,
  ) {}

  async getNativeTokenPrice(chainId: string) {
    const { price } = this.chainsService.getChainSettings(chainId);

    return this.getPrice(price);
  }

  async getNativeTokenDecimals(chainId: string) {
    const { price } = this.chainsService.getChainSettings(chainId);

    return this.getDecimals(price);
  }

  async getPaymentTokenPrice(paymentToken: ChainPaymentToken) {
    const { price } = paymentToken;

    return this.getPrice(price);
  }

  async getPaymentTokenDecimals(paymentToken: ChainPaymentToken) {
    const { price } = paymentToken;

    return this.getDecimals(price);
  }

  private async getPrice(options: PriceFeedOptions) {
    const { type } = options;

    switch (type) {
      case "fixed": {
        return options.value;
      }

      case "oracle": {
        const { chainId, oracle } = options;

        const cache = this.getOracleCache(chainId, oracle);

        if (
          cache.price &&
          cache.priceExpiry &&
          cache.priceExpiry < Date.now()
        ) {
          return cache.price;
        }

        const chainlinkAggregatorV3Abi = this.contractsService.getContractAbi(
          "chainlinkAggregatorV3",
        );

        const [, price] = await this.rpcManagerService.executeRequest(
          chainId,
          (chainClient) => {
            return chainClient.readContract({
              abi: chainlinkAggregatorV3Abi,
              address: oracle,
              functionName: "latestRoundData",
              args: [],
            });
          },
        );

        const { oraclePriceFeedTTL } = this.config;

        cache.price = price;
        cache.priceExpiry = Date.now() + oraclePriceFeedTTL;

        return price;
      }
    }
  }

  private async getDecimals(options: PriceFeedOptions) {
    const { type } = options;

    switch (type) {
      case "fixed": {
        return options.decimals;
      }

      case "oracle": {
        const { chainId, oracle } = options;

        const cache = this.getOracleCache(chainId, oracle);

        if (cache.decimals) {
          return cache.decimals;
        }

        const chainlinkAggregatorV3Abi = this.contractsService.getContractAbi(
          "chainlinkAggregatorV3",
        );

        const decimals = await this.rpcManagerService.executeRequest(
          chainId,
          (chainClient) => {
            return chainClient.readContract({
              abi: chainlinkAggregatorV3Abi,
              address: oracle,
              functionName: "decimals",
              args: [],
            });
          },
        );

        cache.decimals = decimals;

        return decimals;
      }
    }
  }

  private getOracleCache(chainId: string, oracle: Hex) {
    const key = `${chainId}/${oracle}`;

    let cache = this.oracleCache.get(key);

    if (!cache) {
      cache = {};

      this.oracleCache.set(key, cache);
    }

    return cache;
  }
}
