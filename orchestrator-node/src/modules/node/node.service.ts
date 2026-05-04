import { ChainsService } from "@/chains";
import { BadRequestException, readJSON } from "@/common";
import { disperseAbi } from "@/contracts/resources/disperse";
import { entryPointV7 } from "@/contracts/resources/entry-point-v7";
import { nodePaymasterAbi } from "@/contracts/resources/node-paymaster";
import { nodePaymasterFactoryAbi } from "@/contracts/resources/node-paymaster-factory";
import { type ConfigType, InjectConfig } from "@/core/config";
import { Logger } from "@/core/logger";
import { gasEstimatorConfig } from "@/gas-estimator/gas-estimator.config";
import {
  type HealthCheckState,
  type ServiceHealthCheckResult,
  type ServiceWithHealthCheck,
} from "@/health-check";
import { RpcManagerService } from "@/rpc-manager";
import { userOpConfig } from "@/user-ops/userop.config";
import { fromEntries } from "remeda";
import { Service } from "typedi";
import {
  type Address,
  type GetCodeReturnType,
  type Hex,
  type SignableMessage,
  formatEther,
  getContract,
  recoverMessageAddress,
  stringify,
  zeroAddress,
} from "viem";
import { mnemonicToAccount, privateKeyToAccount } from "viem/accounts";
import { PACKAGE_FILE_PATH } from "./constants";
import {
  type NodeAccount,
  type NodeHealthCheckChainWallets,
  type NodeHealthCheckData,
  type NodeInfo,
} from "./interfaces";
import { MAX_EXTRA_WORKERS, nodeConfig } from "./node.config";

@Service()
export class NodeService
  implements ServiceWithHealthCheck<NodeHealthCheckData>
{
  readonly info: NodeInfo;

  private readonly accountAddresses: Address[] = [];
  private readonly accounts = new Map<Hex, NodeAccount>();
  private readonly masterAccount: NodeAccount;

  constructor(
    @InjectConfig(nodeConfig)
    config: ConfigType<typeof nodeConfig>,
    @InjectConfig(nodeConfig)
    private readonly nodeConfiguration: ConfigType<typeof nodeConfig>,
    @InjectConfig(gasEstimatorConfig)
    private readonly gasEstimatorConfiguration: ConfigType<
      typeof gasEstimatorConfig
    >,
    @InjectConfig(userOpConfig)
    private readonly userOpConfiguration: ConfigType<typeof userOpConfig>,
    private readonly chainsService: ChainsService,
    private readonly logger: Logger,
    private readonly rpcManagerService: RpcManagerService,
  ) {
    logger.setCaller(NodeService);

    const {
      name,
      privateKey,
      feeBeneficiary,
      feePercentage,
      accountsPrivateKeys,
      accountsMnemonic,
    } = config;

    this.masterAccount = privateKeyToAccount(privateKey);

    if (accountsPrivateKeys) {
      for (const privateKey of accountsPrivateKeys) {
        const account = privateKeyToAccount(privateKey);
        this.accountAddresses.push(account.address);
        this.accounts.set(account.address, account);
      }
    }

    if (accountsMnemonic && config.maxExtraWorkers) {
      for (
        let accountIndex = 0;
        accountIndex < config.maxExtraWorkers;
        accountIndex++
      ) {
        const account = mnemonicToAccount(accountsMnemonic, {
          accountIndex,
        });
        this.accountAddresses.push(account.address);
        this.accounts.set(account.address, account);
      }
    }

    if (this.accountAddresses.length === 0) {
      this.accountAddresses.push(this.masterAccount.address);
      this.accounts.set(this.masterAccount.address, this.masterAccount);
    }

    this.info = {
      version: undefined,
      name,
      address: this.masterAccount.address,
      feeBeneficiary,
      feePercentage,
      wallets: [...this.accounts.keys()],
    };
  }

  async initialize() {
    const supportedChains = await this.chainsService.getSupportedChains();
    const chainIds = supportedChains.map((chainInfo) => chainInfo.chainId);

    await Promise.all(
      chainIds.map(async (chainId) => {
        try {
          await this.deployAndFundPaymaster(chainId);
          await this.whitelistWorkers(chainId);
          await this.fundWorkers(chainId);
        } catch (error) {
          this.logger.error(
            {
              chainId,
              error: (error as Error).message || stringify(error),
            },
            "Failed to initialize node service for chain",
          );
        }
      }),
    );
  }

  async performHealthCheck(): Promise<
    ServiceHealthCheckResult<NodeHealthCheckData>
  > {
    try {
      const supportedChains = await this.chainsService.getSupportedChains();
      const chainIds = supportedChains.map((chainInfo) => chainInfo.chainId);

      const chains = fromEntries(
        await Promise.all(
          chainIds.map(async (chainId) => {
            const { executor, contracts, paymasterFundingThreshold } =
              this.chainsService.getChainSettings(chainId);
            const workerCount = executor.workerCount;
            const workerFundingThreshold = executor.workerFundingThreshold;
            const paymaster = this.chainsService.getChainPaymasterAddress(
              chainId,
              this.masterAccount.address,
            );

            let state: HealthCheckState = "unhealthy";
            const issues = [];
            const wallets: NodeHealthCheckChainWallets = {};
            let atLeastOneWorkerHealthy = false;
            let masterHealthy = false;
            let masterBalance = 0n;
            let paymasterDeployed = false;
            let paymasterBalance = 0n;
            let paymasterHealthy = false;
            let pmContractCode: GetCodeReturnType = undefined;

            try {
              const requiredWalletBalance = workerFundingThreshold;

              // If worker count is zero, master will be used as workers
              // else extra workers will be considered
              const accountsToCheck =
                workerCount === 0
                  ? [this.masterAccount.address]
                  : this.accountAddresses.slice(
                      0,
                      Math.min(workerCount, this.accountAddresses.length),
                    );

              const walletBalanceInfos = await Promise.all(
                accountsToCheck.map(async (address) => {
                  try {
                    const balance = await this.rpcManagerService.executeRequest(
                      chainId,
                      (chainClient) => {
                        return chainClient.getBalance({
                          address,
                        });
                      },
                    );

                    const active = balance >= requiredWalletBalance;

                    return {
                      active,
                      balance,
                      address,
                    };
                  } catch (error) {
                    this.logger.info(
                      {
                        address,
                        chainId,
                        error: (error as Error).message || stringify(error),
                      },
                      "Failed to check health for worker EOA account",
                    );

                    return {
                      active: false,
                      balance: 0n,
                      address,
                    };
                  }
                }),
              );

              // Check worker EOA balances
              for (const walletBalanceInfo of walletBalanceInfos) {
                wallets[walletBalanceInfo.address] = {
                  active: walletBalanceInfo.active,
                  balance: walletBalanceInfo.balance,
                };
                if (!walletBalanceInfo.active) {
                  issues.push(
                    `Worker EOA (${walletBalanceInfo.address}) is unhealthy - balance is below required threshold (${formatEther(requiredWalletBalance)})`,
                  );
                }
              }
              atLeastOneWorkerHealthy = Object.values(wallets).some(
                ({ active }) => {
                  return active;
                },
              );

              [masterBalance, pmContractCode, paymasterBalance] =
                await Promise.all([
                  this.rpcManagerService.executeRequest(
                    chainId,
                    (chainClient) => {
                      return chainClient.getBalance({
                        address: this.getMasterAccount().address,
                      });
                    },
                  ),
                  this.rpcManagerService.executeRequest(
                    chainId,
                    (chainClient) => {
                      return chainClient.getCode({
                        address: paymaster,
                      });
                    },
                  ),
                  this.rpcManagerService.executeRequest(
                    chainId,
                    (chainClient) => {
                      return chainClient.readContract({
                        abi: entryPointV7,
                        address: contracts.entryPointV7,
                        functionName: "balanceOf",
                        args: [paymaster],
                      });
                    },
                  ),
                ]);

              // Check master EOA balance
              masterHealthy = masterBalance >= requiredWalletBalance;
              if (!masterHealthy) {
                issues.push(
                  `Master EOA (${this.getMasterAccount().address}) is unhealthy - balance is below required threshold (${formatEther(requiredWalletBalance)})`,
                );
              }

              // Check paymaster deployed
              paymasterDeployed = pmContractCode
                ? pmContractCode !== "0x"
                : false;
              if (!paymasterDeployed) {
                issues.push(
                  `Paymaster contract (${paymaster}) is not deployed`,
                );
              }

              // Check paymaster balance
              paymasterHealthy = paymasterBalance > paymasterFundingThreshold;
              if (!paymasterHealthy) {
                issues.push(
                  `Node's paymaster contract (${paymaster}) is unhealthy - balance is below required threshold (${formatEther(paymasterFundingThreshold)}). Deposit more funds to the EntryPoint contract (${contracts.entryPointV7}) to fund the paymaster.`,
                );
              }

              if (
                atLeastOneWorkerHealthy &&
                masterHealthy &&
                paymasterDeployed &&
                paymasterHealthy
              ) {
                state = "healthy";
              }
            } catch (error) {
              this.logger.error(
                {
                  chainId,
                  error: (error as Error).message || stringify(error),
                },
                "Failed to check health for node service",
              );
              state = "unhealthy";
              issues.push(
                `Failed to check health for node service: ${stringify(error)}`,
              );
            }

            return [
              chainId,
              {
                status: state,
                master: {
                  active: masterHealthy,
                  balance: masterBalance,
                },
                workers: wallets,
                paymaster: {
                  address: paymaster,
                  deployed: paymasterDeployed,
                  balance: paymasterBalance,
                },
                issues,
              },
            ] as const;
          }),
        ),
      );

      return { chains };
    } catch (error) {
      this.logger.info(
        {
          error: (error as Error).message || stringify(error),
        },
        "Failed to check health for node service",
      );
      return { chains: {} };
    }
  }

  get address() {
    return this.info.address;
  }

  async readVersion() {
    if (!this.info.version) {
      const packageData = await readJSON<{
        version: string;
      }>(PACKAGE_FILE_PATH);

      this.info.version = packageData?.version || "unknown";
    }
  }

  getMasterAccount() {
    const account = this.masterAccount;

    if (!account) {
      throw new BadRequestException("Master account failed to initialize");
    }

    return account;
  }

  getAccount(address: Hex) {
    const account = this.accounts.get(address);

    if (!account) {
      throw new BadRequestException(`Account (${address}) doesn't exist`);
    }

    return account;
  }

  async signMessage(message: SignableMessage) {
    return this.masterAccount.signMessage({
      message,
    });
  }

  async verifyMessage(message: SignableMessage, signature: Hex) {
    const recovered = await recoverMessageAddress({
      message,
      signature,
    });

    return recovered === this.masterAccount.address;
  }

  async getNodeinfo() {
    const [chains, supportedPaymentTokensInfo] = await Promise.all([
      this.chainsService.getSupportedChains(),
      this.chainsService.getSupportedPaymentTokens(),
    ]);

    const info = {
      version: this.info.version,
      node: this.address,
      beneficiary: this.nodeConfiguration.feeBeneficiary,
      pollInterval:
        this.userOpConfiguration.userOpTraceCallSimulationPollInterval,
      gasPremiumPercentage: this.nodeConfiguration.feePercentage,
      minUseropWindow: this.userOpConfiguration.userOpMinExecWindowDuration,
      maxUseropWindow: this.userOpConfiguration.userOpMinExecWindowDuration,
      maxCallGasLimit: this.gasEstimatorConfiguration.maxCalldataGasLimit,
      supportedChains: chains,
      supportedGasTokens: supportedPaymentTokensInfo.filter((info) => {
        return info.paymentTokens.length > 0;
      }),
    };

    return info;
  }

  private async deployAndFundPaymaster(chainId: string) {
    const { paymasterFunding, contracts } =
      this.chainsService.getChainSettings(chainId);

    const pmContractAddress = this.chainsService.getChainPaymasterAddress(
      chainId,
      this.masterAccount.address,
    );
    if (!pmContractAddress || pmContractAddress === zeroAddress) {
      throw new Error(
        `Error while initializing chain (${chainId}). Paymaster contract address couldn't be precomputed!`,
      );
    }

    // check if the paymaster contract is already deployed. deploy if not.
    const pmContractCode = await this.rpcManagerService.executeRequest(
      chainId,
      (chainClient) => {
        return chainClient.getCode({
          address: pmContractAddress as `0x${string}`,
        });
      },
    );

    if (!pmContractCode || pmContractCode === "0x") {
      this.logger.info(
        {
          chainId,
          pmContractAddress,
        },
        "Paymaster contract not deployed. Deploying...",
      );

      const deployAndFundPmTxHash = await this.rpcManagerService.executeRequest(
        chainId,
        (chainClient) => {
          return chainClient.connectAccount(this.masterAccount).writeContract({
            abi: nodePaymasterFactoryAbi,
            address: contracts.pmFactory,
            functionName: "deployAndFundNodePaymaster",
            args: [contracts.entryPointV7, this.masterAccount.address, [], 0],
            value: paymasterFunding,
            account: this.masterAccount,
            chain: chainClient.chain,
          });
        },
      );

      const deployAndFundPmReceipt =
        await this.rpcManagerService.executeRequest(chainId, (chainClient) => {
          return chainClient.waitForTransactionReceipt({
            hash: deployAndFundPmTxHash,
            confirmations: 2,
          });
        });

      if (
        !deployAndFundPmReceipt ||
        deployAndFundPmReceipt.status === "reverted"
      ) {
        throw new Error(
          `Error while initializing chain (${chainId}). Paymaster contract couldn't be deployed!`,
        );
      }
      this.logger.info(
        {
          chainId,
          pmContractAddress,
          deployAndFundPmTxHash,
        },
        "Paymaster contract deployed and funded.",
      );
    } else {
      this.logger.info(
        {
          chainId,
          pmContractAddress,
        },
        "Paymaster contract already deployed.",
      );
    }
  }

  private async whitelistWorkers(chainId: string) {
    const pmContractAddress = this.chainsService.getChainPaymasterAddress(
      chainId,
      this.masterAccount.address,
    );

    this.logger.info(
      {
        chainId,
        accountAddresses: this.accountAddresses,
      },
      "Checking if whitelisted...",
    );

    const whitelistedWorkers = (await this.rpcManagerService.executeRequest(
      chainId,
      (chainClient) => {
        return chainClient.readContract({
          abi: nodePaymasterAbi,
          address: pmContractAddress,
          functionName: "areWorkerEOAsWhitelisted",
          args: [this.accountAddresses],
        });
      },
    )) as boolean[];

    this.logger.info(
      {
        chainId,
        whitelistedWorkers,
      },
      "Whitelisted workers...",
    );

    const workersToWhitelist = this.accountAddresses.filter(
      (_, index) => !whitelistedWorkers[index],
    );

    this.logger.info(
      {
        chainId,
        workersToWhitelist,
      },
      "Workers to whitelist...",
    );

    if (workersToWhitelist.length > 0) {
      this.logger.info(
        {
          chainId,
          workersToWhitelist,
        },
        "Whitelisting workers...",
      );

      const whitelistTxHash = await this.rpcManagerService.executeRequest(
        chainId,
        (chainClient) => {
          return chainClient.connectAccount(this.masterAccount).writeContract({
            abi: nodePaymasterAbi,
            address: pmContractAddress,
            functionName: "whitelistWorkerEOAs",
            args: [workersToWhitelist],
            account: this.masterAccount,
            chain: chainClient.chain,
          });
        },
      );

      const whitelistReceipt = await this.rpcManagerService.executeRequest(
        chainId,
        (chainClient) => {
          return chainClient.waitForTransactionReceipt({
            hash: whitelistTxHash,
            confirmations: 2,
          });
        },
      );

      if (!whitelistReceipt || whitelistReceipt.status === "reverted") {
        throw new Error(
          `Error while whitelisting workers on chain (${chainId}). Whitelist transaction reverted!`,
        );
      }

      this.logger.info(
        {
          chainId,
          workersToWhitelist,
          whitelistTxHash,
        },
        "Workers whitelisted.",
      );
    } else {
      this.logger.info(
        {
          chainId,
        },
        "No workers to whitelist. Skipping whitelisting.",
      );
    }
  }

  private async fundWorkers(chainId: string) {
    const { executor, contracts } =
      this.chainsService.getChainSettings(chainId);
    const workerFunding = executor.workerFunding;
    const workerCount = executor.workerCount;

    // if worker count is zero ? Master will be considered as workers and it doesn't need funding
    // else all the EOA workers will be considered for funding based on workerCount
    const workersToFund =
      workerCount === 0
        ? []
        : this.accountAddresses.slice(
            0,
            Math.min(workerCount, this.accountAddresses.length),
          );

    this.logger.info(
      {
        chainId,
        workersToFund,
        workerFunding,
        workerCount,
        maxWorkerCountFromEnv: MAX_EXTRA_WORKERS,
        maxWorkerCount: this.nodeConfiguration.maxExtraWorkers,
        accountAddresses: this.accountAddresses,
      },
      "Funding workers...",
    );

    if (workersToFund.length === 0) {
      this.logger.info(
        {
          chainId,
        },
        "Master EOA is the only account. No worker accounts found. Skipping funding.",
      );
      return;
    }

    const workerBalances = await Promise.all(
      workersToFund.map((address) =>
        this.rpcManagerService.executeRequest(chainId, (chainClient) => {
          return chainClient.getBalance({ address });
        }),
      ),
    );

    const fundingAmounts = workerBalances
      .map((balance, index) => {
        const fundingAmount =
          balance >= workerFunding ? 0n : workerFunding - balance;
        return {
          address: workersToFund[index],
          fundingAmount,
        };
      })
      .filter(({ fundingAmount }) => fundingAmount > 0n);

    const totalFundingAmount = fundingAmounts.reduce(
      (acc, { fundingAmount }) => acc + fundingAmount,
      0n,
    );

    if (totalFundingAmount === 0n) {
      this.logger.info(
        {
          chainId,
        },
        "No workers require funding. Skipping funding.",
      );
      return;
    }

    this.logger.info(
      {
        chainId,
        fundingAmounts,
        totalFundingAmount,
      },
      "Funding workers...",
    );

    const fundingTxHash = await this.rpcManagerService.executeRequest(
      chainId,
      (chainClient) => {
        return chainClient.connectAccount(this.masterAccount).writeContract({
          abi: disperseAbi,
          address: contracts.disperse,
          functionName: "disperseEther",
          args: [
            fundingAmounts.map(({ address }) => address),
            fundingAmounts.map(({ fundingAmount }) => fundingAmount),
          ],
          value: totalFundingAmount,
          account: this.masterAccount,
          chain: chainClient.chain,
        });
      },
    );

    const fundingReceipt = await this.rpcManagerService.executeRequest(
      chainId,
      (chainClient) => {
        return chainClient.waitForTransactionReceipt({
          hash: fundingTxHash,
          confirmations: 2,
        });
      },
    );

    if (!fundingReceipt || fundingReceipt.status === "reverted") {
      throw new Error(
        `Error while funding workers on chain (${chainId}). Funding transaction reverted!`,
      );
    }

    this.logger.info(
      {
        chainId,
        fundingTxHash,
      },
      "Workers funded.",
    );
  }
}
