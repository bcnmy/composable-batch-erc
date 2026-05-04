import { ApiCallService } from "@/api-call";
import {
  CHAIN_DEFINITIONS,
  ChainClient,
  ChainClientExtended,
  ChainClientTraceTransactionReturnType,
} from "@/chains";
import { BadRequestException, sanitizeUrl } from "@/common";
import { Logger } from "@/core/logger";
import { Mutex } from "async-mutex";
import { Service } from "typedi";
import {
  http,
  Chain,
  Hex,
  createPublicClient,
  createWalletClient,
  extractChain,
  formatTransactionRequest,
  stringify,
  zeroAddress,
} from "viem";
import { classifyError } from "./classify-error";
import {
  RPCManagerConfig,
  RPCProvider,
  RpcChainConfig,
  RpcErrorType,
  RpcManagerEventHandler,
  RpcManagerEventHandlers,
  RpcManagerEvents,
  RpcProviderState,
  RpcProviderSyncConfig,
} from "./interfaces";
import { ProviderMetrics } from "./provider-metrics";

@Service()
export class RpcManagerService {
  private configs: Map<string, RpcChainConfig> = new Map();
  private healthCheckIntervals: Map<string, NodeJS.Timeout> = new Map();
  private minimumRequestsForPromotion = 10;
  private initialized = false;
  private promotionInProgress: Map<string, boolean> = new Map();
  private healthCheckInProgress: Map<string, boolean> = new Map();
  private readonly eventHandlers: RpcManagerEventHandlers = {};
  private mutex = new Mutex();
  private isMaster = false;
  private masterConfig: RPCManagerConfig = { chains: [] };

  constructor(
    private readonly logger: Logger,
    private readonly apiCallService: ApiCallService,
  ) {
    logger.setCaller(RpcManagerService);
  }

  setup(config: RPCManagerConfig, isMaster: boolean) {
    if (this.initialized) return;

    // Initialize chain configurations
    for (const rpcChainConfig of config.chains) {
      // Sort providers by priority
      rpcChainConfig.providers.sort((a, b) => a.priority - b.priority);

      let chain: Chain | undefined;

      try {
        chain = extractChain({
          id: Number(rpcChainConfig.chainId),
          chains: CHAIN_DEFINITIONS,
        });
      } catch {
        //
      }

      if (!chain) {
        throw new Error(`Invalid chain (${rpcChainConfig.chainId}) detected`);
      }

      // Create Viem clients for each provider
      for (const provider of rpcChainConfig.providers) {
        const transport = http(provider.url, {
          // TODO: Add additional options
          // // Uncomment this if RPC request logs are needed for debugging.
          // async onFetchRequest(_, init) {
          //   console.log(JSON.parse(init.body as string))
          // },
        });

        provider.client = createPublicClient({
          chain,
          transport,
        }).extend((client) => {
          let traceCallSupported: Promise<boolean> | undefined;
          let sendTransactionSyncSupported: Promise<boolean> | undefined;

          // Mocaverse chain has some RPC interface issue for tracerConfig field, this is a temporary workwround and it will be removed soon
          const isStringifiedRpcPayloadRequired = [222888, 2288].includes(
            client.chain.id,
          );

          const debug = {
            traceCall: async (tx, blockTag = "latest", options = {}) => {
              return (client as ChainClient).request({
                method: "debug_traceCall",
                params: [
                  formatTransactionRequest(tx),
                  blockTag,
                  {
                    tracer: "callTracer",
                    ...options,
                    tracerConfig: isStringifiedRpcPayloadRequired
                      ? stringify(options.tracerConfig)
                      : options.tracerConfig,
                  },
                ],
              });
            },
          } as ChainClientExtended["debug"];

          const transaction = {
            sendTransactionSyncSupported: Promise.resolve(false),
          } as ChainClientExtended["transaction"];

          const trace = {
            transaction: async (hash: Hex) => {
              if (!client.transport.url) {
                return undefined;
              }

              const axiosClient = this.apiCallService.getAxios(
                client.transport.url,
              );

              const headers = {
                "Content-Type": "application/json",
              };

              // Mocaverse chain has some RPC interface issue for tracerConfig field, this is a temporary workwround and it will be removed soon
              const isStringifiedRpcPayloadRequired = [222888, 2288].includes(
                client.chain.id,
              );

              const data = stringify({
                jsonrpc: "2.0",
                id: 1,
                method: "debug_traceTransaction",
                params: [
                  hash,
                  {
                    tracer: "callTracer",
                    tracerConfig: isStringifiedRpcPayloadRequired
                      ? stringify({
                          withLog: false,
                        })
                      : {
                          withLog: false,
                        },
                  },
                ],
              });

              const response =
                await this.apiCallService.post<ChainClientTraceTransactionReturnType>(
                  axiosClient,
                  "",
                  data,
                  { headers },
                );

              const tracesResult = response.data;

              if (tracesResult.error) {
                this.logger.error(
                  {
                    error: tracesResult.error,
                    hash,
                  },
                  "Failed to get transaction trace",
                );
                return undefined;
              }

              return tracesResult.result;
            },
          } as ChainClientExtended["trace"];

          Object.defineProperty(transaction, "sendTransactionSyncSupported", {
            get() {
              if (!sendTransactionSyncSupported) {
                sendTransactionSyncSupported = client
                  .sendRawTransactionSync({
                    serializedTransaction: "0x",
                  })
                  .then(() => true)
                  // biome-ignore lint/suspicious/noExplicitAny: allow any for this variable
                  .catch((error: any) => {
                    const errorMessage = error?.message?.toLowerCase?.() || "";
                    const errorCode = error?.code;

                    // Method not found = not supported
                    if (
                      errorCode === -32601 ||
                      errorMessage.toLowerCase().includes("method not found") ||
                      errorMessage.toLowerCase().includes("not supported") ||
                      errorMessage.toLowerCase().includes("does not exist")
                    ) {
                      return false;
                    }

                    return true;
                  });
              }

              return sendTransactionSyncSupported;
            },
          });

          Object.defineProperty(debug, "traceCallSupported", {
            get() {
              if (!traceCallSupported) {
                traceCallSupported = debug
                  .traceCall(
                    {
                      from: zeroAddress,
                      to: zeroAddress,
                      value: 0n,
                      data: "0x",
                    },
                    "latest",
                    {
                      tracerConfig: {
                        onlyTopCall: true,
                      },
                    },
                  )
                  .then(() => true)
                  .catch(() => false);
              }

              return traceCallSupported;
            },
          });

          const connectAccount: ChainClientExtended["connectAccount"] = (
            account,
          ) =>
            createWalletClient({
              account,
              chain,
              transport,
            });

          return {
            debug,
            trace,
            transaction,
            connectAccount,
          };
        });

        provider.state = "active";
      }

      this.configs.set(rpcChainConfig.chainId, rpcChainConfig);
      this.promotionInProgress.set(rpcChainConfig.chainId, false);

      if (isMaster) {
        this.healthCheckInProgress.set(rpcChainConfig.chainId, false);

        // RPC Health chech only happens with master thread
        // Start health check for this chain
        this.startHealthCheck(rpcChainConfig.chainId);
      }
    }

    if (isMaster) {
      this.isMaster = true;
      // Store the master config here so it can be resynced again when the worker threads needs it again
      this.masterConfig = config;
    }

    this.initialized = true;
    this.logger.trace("RPC manager initialized");
  }

  syncRpcConfig() {
    if (!this.isMaster) {
      throw new Error("Rpc config sync can only be called by master thread");
    }

    // Emit the setup config to other threads
    this.emit("setup", this.masterConfig);
  }

  syncProviders(chainId: string, providerConfigs: RpcProviderSyncConfig[]) {
    // Mutex will lock the thread so no more than one sync will be happening to prevent conflicts which can create inconsistencies in providers
    // If there are more than one sync calls, it will be executed one by one without creating any conflicts
    return this.mutex.runExclusive(() => {
      const config = this.configs.get(chainId);

      if (!config) {
        throw new Error(`RPC Chain config for chain (${chainId}) not found`);
      }

      // Update provider priorities based on matching url, then re-sort
      for (const updatedProviderConfig of providerConfigs) {
        const provider = config.providers.find(
          (provider) => provider.url === updatedProviderConfig.url,
        );
        if (provider) {
          if (updatedProviderConfig.priority !== undefined)
            provider.priority = updatedProviderConfig.priority;
          if (updatedProviderConfig.state !== undefined)
            provider.state = updatedProviderConfig.state;
        }
      }

      // Sort providers by new priority
      config.providers.sort((a, b) => a.priority - b.priority);

      this.logger.trace(`RPC providers are synced for the chain ${chainId}`);
    });
  }

  /**
   * Returns the primary RPC provider (priority 0) for the specified chain.
   *
   * @param chainId - The chain ID for which to get the primary RPC provider.
   * @returns The primary provider object for the specified chain.
   * @throws {BadRequestException} If no primary RPC provider is found.
   */
  getPrimaryRpcProvider(chainId: string) {
    const config = this.configs.get(chainId);

    if (!config) {
      throw new Error(`RPC Chain config for chain (${chainId}) not found`);
    }

    const [primaryProvider] = config.providers.filter(
      (provider) => provider.priority === 0,
    );

    if (!primaryProvider)
      throw new BadRequestException("Failed to find a primary RPC provider");

    return primaryProvider;
  }

  /**
   * Execute an RPC request with automatic fallback (non-blocking)
   */
  async executeRequest<T>(
    chainId: string,
    requestFn: (client: ChainClient) => Promise<T>,
  ): Promise<T> {
    const config = this.configs.get(chainId);

    if (!config) {
      throw new Error(`RPC Chain config for chain (${chainId}) not found`);
    }

    const errors: Array<{ provider: string; error: string }> = [];

    // Not a reference value, this is to prevent the change of the order of providers during the inflight requests
    const orderPreservedProviders = [...config.providers];

    // Try each provider in priority order
    for (const orderPreservedProvider of orderPreservedProviders) {
      // Skip degraded providers (unless it's the last option)
      if (
        orderPreservedProvider.state === "degraded" &&
        orderPreservedProviders.indexOf(orderPreservedProvider) <
          orderPreservedProviders.length - 1
      ) {
        continue;
      }

      try {
        if (!orderPreservedProvider.client) {
          throw new Error(
            `Provider client not found for chain ${config.chainId}`,
          );
        }

        return await requestFn(orderPreservedProvider.client);
      } catch (error) {
        // biome-ignore lint/suspicious/noExplicitAny: allow any for this variable
        const errorMessage = (error as any)?.message || "RPC request failed";
        const errorType = classifyError(error);

        // Log the error
        this.logger.error(
          {
            rpcUrl: orderPreservedProvider.url,
            chainId,
            errorType,
            errorMessage,
            error,
          },
          "RPC request failed to execute",
        );

        errors.push({
          provider: orderPreservedProvider.url,
          error: errorMessage,
        });

        // Other RPCs will take over the request for execution
        if (
          errorType === RpcErrorType.RETRIABLE ||
          errorType === RpcErrorType.RATE_LIMIT
        ) {
          continue;
        }

        // Actual failable error, so we throw an error
        if (
          errorType === RpcErrorType.NON_RETRIABLE ||
          errorType === RpcErrorType.CHAIN_ERROR
        ) {
          // Sanitize error to avoid leaking the rpc url
          const sanitizedError = new Error(sanitizeUrl(errorMessage));
          sanitizedError.name = errorType;
          throw sanitizedError;
        }
      }
    }

    this.logger.error(
      {
        errors,
        chainId,
      },
      `All RPC providers failed to execute rpc call for chainId ${chainId}`,
    );

    const allProviderErrors = errors
      .map((errorInfo) => `- ${sanitizeUrl(errorInfo.error)}`)
      .join("\n");

    const allProviderErrorMessage = `All RPC providers failed to execute rpc call for chainId ${chainId}.
    Provider errors:
    ${allProviderErrors}
    `;

    // All providers failed
    throw new Error(allProviderErrorMessage);
  }

  /**
   * Trigger promotion check asynchronously (non-blocking)
   */
  private checkForPromotionAsync(chainId: string): void {
    // Don't await - let this run in background
    setImmediate(() => {
      this.checkForPromotion(chainId).catch((err) => {
        this.logger.error(
          `Promotion check failed for chain ${chainId}: ${err instanceof Error ? err : new Error(String(err))}`,
        );
      });
    });
  }

  /**
   * Check if any fallback RPC should be promoted to primary
   */
  private async checkForPromotion(chainId: string): Promise<void> {
    // Quick check without blocking - if promotion in progress, skip
    if (this.promotionInProgress.get(chainId)) {
      return;
    }

    this.promotionInProgress.set(chainId, true);

    try {
      const config = this.configs.get(chainId);

      if (!config) {
        throw new Error(`RPC Chain config for chain (${chainId}) not found`);
      }

      const primaryProvider = config.providers.find((p) => p.priority === 0);

      if (!primaryProvider) {
        throw new Error(`Failed to find primary provider for chain ${chainId}`);
      }

      // Find the best performing fallback provider
      let bestFallback: RPCProvider | null = null;
      let bestSuccessRate = 0;

      for (const provider of config.providers) {
        if (provider.priority === 0) continue; // Skip primary RPC provider

        const metrics = provider.metrics.snapshot();

        // Check promotion criteria
        if (
          metrics.totalRequests >= this.minimumRequestsForPromotion &&
          metrics.successRate >= config.promotionThreshold &&
          metrics.successRate > bestSuccessRate
        ) {
          bestFallback = provider;
          bestSuccessRate = metrics.successRate;
        }
      }

      // Promote if fallback is better than primary
      if (bestFallback) {
        const primaryMetrics = primaryProvider.metrics.snapshot();
        const bestFallbackMetrics = bestFallback.metrics.snapshot();

        // Skipped the latency RPC rotation for now. If we wanted to enable this, we need to make sure all the RPC providers are good with rate limits
        // (bestSuccessRate === primaryMetrics.successRate && primaryMetrics.averageResponseTime > bestFallbackMetrics.averageResponseTime)
        if (
          bestSuccessRate > primaryMetrics.successRate ||
          primaryMetrics.consecutiveFailures >= config.failureThreshold
        ) {
          this.promoteProvider(chainId, bestFallback, primaryProvider);
        }
      }
    } finally {
      this.promotionInProgress.set(chainId, false);
    }
  }

  /**
   * Promote a fallback provider to primary
   */
  private promoteProvider(
    chainId: string,
    newPrimary: RPCProvider,
    oldPrimary: RPCProvider,
  ): void {
    const oldMetrics = oldPrimary.metrics.snapshot();
    const newMetrics = newPrimary.metrics.snapshot();

    this.logger.trace(
      {
        oldPrimary: oldPrimary.url,
        newPrimary: newPrimary.url,
        oldPrimarySuccessRate:
          oldMetrics.totalRequests > 0
            ? `${(oldMetrics.successRate * 100).toFixed(2)}%`
            : "N/A",
        newPrimarySuccessRate: `${(newMetrics.successRate * 100).toFixed(2)}%`,
        oldPrimaryAverageResponseTime:
          oldMetrics.averageResponseTime.toFixed(2),
        newPrimaryAverageResponseTime:
          newMetrics.averageResponseTime.toFixed(2),
      },
      `Promoting RPC provider for chain ${chainId}`,
    );

    // Swap priorities
    const tempPriority = oldPrimary.priority;
    oldPrimary.priority = newPrimary.priority;
    newPrimary.priority = tempPriority;

    // Reset metrics for fair evaluation
    oldPrimary.metrics.reset();
    newPrimary.metrics.reset();

    // Re-sort providers
    const config = this.configs.get(chainId);

    if (config) {
      config.providers.sort((a, b) => a.priority - b.priority);
      const rpcProviderSyncConfigs: RpcProviderSyncConfig[] =
        config.providers.map((provider) => ({
          url: provider.url,
          priority: provider.priority,
          state: provider.state,
        }));
      this.emit("sync", { chainId, rpcProviderSyncConfigs });
    }
  }

  /**
   * Start periodic health checks for a chain
   */
  private startHealthCheck(chainId: string): void {
    const config = this.configs.get(chainId);

    if (!config) {
      throw new Error(`RPC Chain config for chain (${chainId}) not found`);
    }

    const interval = setInterval(async () => {
      await this.performHealthCheck(chainId);
    }, config.healthCheckInterval);

    this.healthCheckIntervals.set(chainId, interval);
  }

  /**
   * Perform health check on all providers for a chain (parallel, non-blocking)
   */
  private async performHealthCheck(chainId: string): Promise<void> {
    // Quick check without blocking - if healthCheck in progress, skip
    if (this.healthCheckInProgress.get(chainId)) {
      return;
    }

    this.healthCheckInProgress.set(chainId, true);

    try {
      const config = this.configs.get(chainId);

      if (!config) {
        throw new Error(`RPC Chain config for chain (${chainId}) not found`);
      }

      // Run all health checks in parallel for better performance
      await Promise.allSettled(
        config.providers.map(async (provider) => {
          try {
            const startTime = Date.now();

            if (!provider.client) {
              throw new Error(
                `Provider client not found for chain ${config.chainId}`,
              );
            }

            const isDebugTraceCallSuccessful = await provider.client.debug
              .traceCall(
                {
                  from: zeroAddress,
                  to: zeroAddress,
                  value: 0n,
                  data: "0x",
                },
                "latest",
                {
                  tracerConfig: {
                    onlyTopCall: true,
                  },
                },
              )
              .then(() => true)
              .catch((error) => {
                this.logger.error(
                  { rpcUrl: provider.url, error, chainId },
                  "RPC manager health check failed",
                );
                return false;
              });

            if (!isDebugTraceCallSuccessful) {
              throw new Error("RPC health check debugTraceCall failed");
            }

            const responseTime = Date.now() - startTime;

            // If provider was previously marked as degraded, recover the provider
            if (provider.metrics.consecutiveFailures > 0) {
              provider.state = "active";

              const rpcProviderSyncConfig: RpcProviderSyncConfig = {
                url: provider.url,
                state: provider.state,
              };

              this.emit("sync", {
                chainId,
                rpcProviderSyncConfigs: [rpcProviderSyncConfig],
              });

              this.logger.trace(
                `RPC Provider ${provider.url} of chain (${chainId}) recovered from degraded state`,
              );
            }

            // Record as a successful request in metrics
            provider.metrics.recordSuccess(responseTime);

            // Trigger promotion check asynchronously (doesn't block response)
            this.checkForPromotionAsync(chainId);
          } catch (error) {
            provider.metrics.recordFailure();

            this.logger.error(
              `RPC Health check for chain (${chainId}) failed for ${provider.url}: ${error instanceof Error ? error.message : error}`,
            );

            const metrics = provider.metrics.snapshot();

            if (metrics.consecutiveFailures >= config.failureThreshold) {
              provider.state = "degraded";

              const rpcProviderSyncConfig: RpcProviderSyncConfig = {
                url: provider.url,
                state: provider.state,
              };

              this.emit("sync", {
                chainId,
                rpcProviderSyncConfigs: [rpcProviderSyncConfig],
              });

              this.logger.trace(
                `RPC Provider ${provider.url} of chain (${chainId}) is degraded`,
              );
            }
          }
        }),
      );
    } finally {
      this.healthCheckInProgress.set(chainId, false);
    }
  }

  prepareRpcChainConfig(chainId: string, rpcs: string[], isTestChain: boolean) {
    const providers = rpcs.map((rpc, index) => {
      return {
        url: rpc,
        state: "active" as RpcProviderState,
        priority: index,
        metrics: new ProviderMetrics(),
      };
    });

    const rpcChainConfigs = {
      chainId,
      providers,
      failureThreshold: 3,
      promotionThreshold: 0.95,
      // Mainnet chain: every 30 seconds, there will be a health check
      // Testnet chain: every 2 minutes, there will be a health check
      healthCheckInterval: isTestChain ? 120_000 : 30_000,
    };

    return rpcChainConfigs;
  }

  on<K extends keyof RpcManagerEvents>(
    event: K,
    handler: RpcManagerEventHandler<RpcManagerEvents[K]>,
  ) {
    if (!this.eventHandlers[event]) {
      this.eventHandlers[event] = [];
    }

    this.eventHandlers[event].push(handler);

    return this;
  }

  private async emit<K extends keyof RpcManagerEvents>(
    event: K,
    payload: unknown,
  ) {
    const handlers = this.eventHandlers[event];

    if (!handlers) {
      return;
    }

    for (const handler of handlers) {
      await handler(payload as RpcManagerEvents[K]);
    }
  }

  /**
   * Cleanup resources
   */
  destroy(): void {
    for (const interval of this.healthCheckIntervals.values()) {
      clearInterval(interval);
    }
    this.healthCheckIntervals.clear();
    this.logger.trace("RPC manager destroyed");
  }
}
