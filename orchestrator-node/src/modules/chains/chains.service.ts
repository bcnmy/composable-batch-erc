import { resolve } from "node:path";
import process from "node:process";
import { ApiCallService } from "@/api-call";
import { BadRequestException, readDir, readJSON, withTrace } from "@/common";
import { NODE_PAYMASTER_INIT_CODE } from "@/contracts/resources";
import { type ConfigType, InjectConfig } from "@/core/config";
import { Logger } from "@/core/logger";
import {
  type HealthCheckState,
  type ServiceHealthCheckResult,
  type ServiceWithHealthCheck,
} from "@/health-check";
import {
  ArbitraryTokenPaymentSupportedChainInfo,
  type PaymentProviderType,
} from "@/payment";
import { paymentConfig } from "@/payment/payment.config";
// Directly importing from "@/payment" creates a circular dependency issue.
import { GLUEX_BASE_URL } from "@/payment/providers/gluex/constants";
import { RpcManagerService } from "@/rpc-manager";
import { ChainType, getChains } from "@lifi/sdk";
import { entries, fromEntries, isPlainObject } from "remeda";
import { Service } from "typedi";
import {
  Address,
  type Hash,
  concatHex,
  encodeAbiParameters,
  getCreate2Address,
  keccak256,
  parseAbiParameters,
  stringify,
} from "viem";
import { chainsConfig } from "./chains.config";
import {
  type Chain,
  type ChainConfig,
  type ChainContractName,
  type ChainIdLike,
  type ChainSettings,
  type ChainsConfig,
  type ChainsHealthCheckData,
  type PaymentToken,
} from "./interfaces";
import { chainConfigSchema } from "./schemas";

interface ArbitraryPaymentTokensSupportedCacheItem {
  value: boolean;
  expiresAt: number;
}

@Service()
export class ChainsService
  implements ServiceWithHealthCheck<ChainsHealthCheckData>
{
  readonly chainIds: string[] = [];

  readonly chainsSettings: ChainSettings[] = [];

  readonly chainsPaymasters: Map<ChainIdLike, Address> = new Map();

  private readonly chains: Map<string, Chain> = new Map();

  // In-memory cache for isArbitraryPaymentTokensSupported by chainId, cached for 1 hour
  private _arbitraryPaymentTokensSupportedCache = new Map<
    string,
    ArbitraryPaymentTokensSupportedCacheItem
  >();
  private static readonly ARBITRARY_TOKEN_SUPPORT_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour in ms

  constructor(
    @InjectConfig(chainsConfig)
    private readonly config: ConfigType<typeof chainsConfig>,
    @InjectConfig(paymentConfig)
    private readonly paymentConfiguration: ConfigType<typeof paymentConfig>,
    private readonly logger: Logger,
    private readonly apiCallService: ApiCallService,
    private readonly rpcManagerService: RpcManagerService,
  ) {
    logger.setCaller(ChainsService);

    this.setChainsConfig(config.chains);
  }

  async initialize() {
    const { searchPaths } = this.config;

    if (searchPaths) {
      for (const searchPath of searchPaths) {
        await this.loadChainsConfigFromFile(`${searchPath}.json`);
        await this.loadChainsConfigFromPath(searchPath);
      }
    }

    // Clears the map during the initialization
    this._arbitraryPaymentTokensSupportedCache.clear();
  }

  async performHealthCheck(): Promise<
    ServiceHealthCheckResult<ChainsHealthCheckData>
  > {
    try {
      const supportedChains = await this.getSupportedChains();
      const chainIds = supportedChains.map((chainInfo) => chainInfo.chainId);

      if (!chainIds.length) {
        return { chains: {} };
      }

      const chains: ChainsHealthCheckData["chains"] = fromEntries(
        await Promise.all(
          chainIds.map(async (chainId) => {
            try {
              const [rpcCall, debugTraceCall] = await Promise.all([
                this.rpcManagerService
                  .executeRequest(chainId, (client) => {
                    return client.getBlockNumber();
                  })
                  .then(() => true)
                  .catch(() => false),
                this.rpcManagerService.executeRequest(chainId, (client) => {
                  return client.debug.traceCallSupported;
                }),
                // This is not used as part of health check but we're fetching this value during node intialization for a warm up
                this.rpcManagerService.executeRequest(chainId, (client) => {
                  return client.transaction.sendTransactionSyncSupported;
                }),
              ]);

              let state: HealthCheckState;

              if (rpcCall && debugTraceCall) {
                state = "healthy";
              } else {
                state = "unhealthy";
              }

              return [
                chainId,
                {
                  status: state,
                  checks: {
                    rpcCall,
                    debugTraceCall,
                  },
                },
              ] as const;
            } catch (error) {
              this.logger.info(
                {
                  chainId,
                  error: (error as Error).message || stringify(error),
                },
                "Failed to check health for chain",
              );

              return [
                chainId,
                {
                  status: "unhealthy" as HealthCheckState,
                  checks: {
                    rpcCall: false,
                    debugTraceCall: false,
                  },
                },
              ];
            }
          }),
        ),
      );

      return { chains };
    } catch (error) {
      this.logger.info(
        {
          error: (error as Error).message || stringify(error),
        },
        "Failed to check health for chain service",
      );
      return { chains: {} };
    }
  }

  // This should be only used in the simulator/executor worker threads
  get chainId() {
    return this.chainSettings.chainId;
  }

  // This should be only used in the simulator/executor worker threads
  get chainSettings() {
    return this.getChainSettings(this.chainIds.at(0));
  }

  async isChainSupported(chainId: string): Promise<boolean> {
    const supportedChains = await this.getSupportedChains();
    const chainIds = supportedChains.map((chainInfo) => chainInfo.chainId);

    return chainIds.includes(chainId);
  }

  isChainPaymentTokenSupported(
    chainId: string,
    tokenAddress: Hash,
    options: {
      permitEnabled?: true;
    } = {},
  ) {
    const paymentToken = this.getChain(chainId).paymentTokens.get(tokenAddress);

    return options.permitEnabled ? paymentToken?.permitEnabled : !!paymentToken;
  }

  getChainSettings(chainId: ChainIdLike | undefined) {
    return this.getChain(chainId).settings;
  }

  getChainsSettings() {
    return [...this.chains.values()].map(
      (chainSettings) => chainSettings.settings,
    );
  }

  getChainContractAddress(
    chainId: ChainIdLike | undefined,
    contractName: ChainContractName,
  ) {
    return this.getChainSettings(chainId).contracts[contractName];
  }

  getChainPaymasterAddress(chainId: ChainIdLike, masterAccount: Address) {
    const chainConfig = this.getChainSettings(chainId);
    const { pmFactory, entryPointV7 } = chainConfig.contracts;

    return getCreate2Address({
      bytecodeHash: keccak256(
        concatHex([
          chainConfig.paymasterInitCode || NODE_PAYMASTER_INIT_CODE,
          encodeAbiParameters(
            parseAbiParameters(["address", "address", "address[]"]),
            [entryPointV7, masterAccount, []],
          ),
        ]),
      ),
      salt: "0x",
      from: pmFactory,
    });
  }

  getChainPaymentToken(chainId: ChainIdLike | undefined, tokenAddress: Hash) {
    const paymentToken = this.getChain(chainId).paymentTokens.get(tokenAddress);

    if (!paymentToken) {
      // TODO: Add proper exception
      throw new BadRequestException(
        `Payment token (${tokenAddress}) chain ("${chainId}") not found`,
      );
    }

    return paymentToken;
  }

  setChainSettings(...chainsSettings: ChainSettings[]) {
    for (const settings of chainsSettings) {
      const { chainId, paymentTokens } = settings;

      this.chainIds.push(chainId);
      this.chainsSettings.push(settings);

      const chain: Chain = {
        settings,
        paymentTokens: new Map(),
      };

      for (const paymentToken of paymentTokens) {
        chain.paymentTokens.set(paymentToken.address, paymentToken);
      }

      this.chains.set(chainId, chain);
    }
  }

  private getChain(chainId: ChainIdLike | undefined) {
    let chain: Chain | undefined;

    if (chainId) {
      chain = this.chains.get(`${Number(chainId)}`);
    }

    if (!chain) {
      // TODO: Add proper exception
      throw new BadRequestException(`Chain ("${chainId}") not found`);
    }

    return chain;
  }

  private async loadChainsConfigFromFile(filePath: string) {
    const chainsConfig = await readJSON<ChainsConfig>(
      resolve(process.cwd(), filePath),
    );

    if (!chainsConfig) {
      return;
    }

    this.setChainsConfig(chainsConfig, filePath);
  }

  private async loadChainsConfigFromPath(rootPath: string) {
    const files = await readDir(resolve(process.cwd(), rootPath), {
      filter: {
        extension: ".json",
      },
    });

    if (!files?.length) {
      return;
    }

    const chainsConfigEntries = (
      await Promise.all(
        files.map(
          async ({ name, path }) =>
            [name, await readJSON<ChainConfig>(path)] as const,
        ),
      )
    ).filter(([, chainConfig]) => Boolean(chainConfig));

    if (!chainsConfigEntries.length) {
      return;
    }

    this.setChainsConfig(
      fromEntries(chainsConfigEntries) as ChainsConfig,
      rootPath,
    );
  }

  private setChainsConfig(
    chainsConfig: ChainsConfig | undefined,
    loadedFromPath?: string,
  ) {
    if (!chainsConfig) {
      return;
    }

    if (!isPlainObject(chainsConfig)) {
      return;
    }

    const chainIds: string[] = [];

    for (const [chainId, config] of entries(chainsConfig)) {
      const chainSettings = chainConfigSchema.parse(config);

      if (chainSettings.chainId !== chainId) {
        // disable chain
        continue;
      }

      if (this.chains.has(chainId)) {
        continue;
      }

      chainIds.push(chainId);

      this.setChainSettings(chainSettings);
    }

    if (loadedFromPath && chainIds.length) {
      this.logger.info({ chainIds }, `Config loaded from '${loadedFromPath}'`);
    }
  }

  async getSupportedChains() {
    return await withTrace("chainService.getSupportedChains", async () => {
      const result = await Promise.all(
        this.chainsSettings.map(async (chainSettings) => {
          if (chainSettings.paymentTokens.length <= 0) {
            const isArbitraryPaymentTokensSupported =
              await this.isArbitraryPaymentTokensSupported(
                chainSettings.chainId,
              );

            if (!isArbitraryPaymentTokensSupported) return null;
          }

          const result = {
            chainId: chainSettings.chainId,
            name: chainSettings.name,
          };

          return result;
        }),
      );

      return result.filter((res) => res !== null);
    })();
  }

  async getSupportedPaymentTokens() {
    return await withTrace(
      "chainService.getSupportedPaymentTokens",
      async () => {
        return await Promise.all(
          this.chainsSettings.map(async (chainSettings) => {
            const paymentTokens: PaymentToken[] = [];

            for (const tokenInfo of chainSettings.paymentTokens) {
              paymentTokens.push({
                name: tokenInfo.name,
                address: tokenInfo.address,
                symbol: tokenInfo.symbol,
                decimals: tokenInfo.decimals,
                permitEnabled: tokenInfo.permitEnabled,
              });
            }

            const isArbitraryPaymentTokensSupported =
              await this.isArbitraryPaymentTokensSupported(
                chainSettings.chainId,
              );

            return {
              chainId: chainSettings.chainId,
              paymentTokens: paymentTokens,
              isArbitraryPaymentTokensSupported,
            };
          }),
        );
      },
    )();
  }

  // Get chain information from gluex
  async getGlueXChainInfo() {
    const axiosClient = this.apiCallService.getAxios(GLUEX_BASE_URL);

    const response =
      await this.apiCallService.get<ArbitraryTokenPaymentSupportedChainInfo>(
        axiosClient,
        "/liquidity",
      );

    return response.data;
  }

  async getGlueXChainName(chainId: string): Promise<string | null> {
    const info = await this.getGlueXChainInfo();

    const chainInfo = info.chains.find(
      (chainInfo) => chainInfo.networkID === String(chainId),
    );

    if (!chainInfo) return null;

    return chainInfo.chainID;
  }

  async isGlueXChainSupported(chainId: string): Promise<boolean> {
    try {
      const info = await this.getGlueXChainInfo();

      const isSupported = info.chains.some((info) => {
        return info.networkID === String(chainId);
      });

      return isSupported;
    } catch (error) {
      this.logger.error(
        { error: (error as Error).message || error },
        "Failed to fetch gluex token support",
      );
      return false;
    }
  }

  async isLifiChainSupported(chainId: string): Promise<boolean> {
    try {
      const chains = await getChains({ chainTypes: [ChainType.EVM] });

      return chains.some((chain) => chain.id === Number(chainId));
    } catch (error) {
      this.logger.error(
        { error: (error as Error).message || error },
        "Failed to fetch lifi token support",
      );
      return false;
    }
  }

  async isPaymentProviderChainSupported(
    type: PaymentProviderType,
    chainId: string,
  ): Promise<boolean> {
    switch (type) {
      case "lifi":
        return await this.isLifiChainSupported(chainId);
      case "gluex":
        return await this.isGlueXChainSupported(chainId);
      default:
        throw new BadRequestException("Payment provider not supported");
    }
  }

  async isArbitraryPaymentTokensSupported(chainId: string): Promise<boolean> {
    try {
      // Gluex Support is optional
      const isGluexSupported =
        !!this.paymentConfiguration.gluexApiKey &&
        this.paymentConfiguration.gluexApiKey !== "" &&
        !!this.paymentConfiguration.gluexPartnerUniqueId &&
        this.paymentConfiguration.gluexPartnerUniqueId !== "";

      // Lifi support is also optional
      const isLifiSupported =
        !!this.paymentConfiguration.lifiApiKey &&
        this.paymentConfiguration.lifiApiKey !== "";

      // If none of the payment providers are supported ? arbitrary token support is not enabled
      if (!isGluexSupported && !isLifiSupported) return false;

      const cached = this._arbitraryPaymentTokensSupportedCache.get(chainId);
      const now = Date.now();

      if (cached && cached.expiresAt > now) {
        return cached.value;
      }

      const [isGlueXChainSupported, isLifiChainSupported] = await Promise.all([
        this.isGlueXChainSupported(chainId),
        this.isLifiChainSupported(chainId),
      ]);

      const supported = isGlueXChainSupported || isLifiChainSupported;

      this._arbitraryPaymentTokensSupportedCache.set(chainId, {
        value: supported,
        expiresAt: now + ChainsService.ARBITRARY_TOKEN_SUPPORT_CACHE_TTL_MS,
      });

      return supported;
    } catch (error) {
      this.logger.error(
        { error: (error as Error).message || error },
        "Failed to fetch arbitrary token support",
      );
      return false;
    }
  }
}
