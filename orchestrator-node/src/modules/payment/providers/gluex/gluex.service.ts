import { ApiCallService } from "@/api-call";
import { ChainsService } from "@/chains";
import { BadRequestException } from "@/common";
import { type ConfigType, InjectConfig } from "@/core/config";
import { Logger } from "@/core/logger";
import { gasEstimatorConfig } from "@/gas-estimator/gas-estimator.config";
import {
  type GetPaymentRoutePayload,
  type PaymentProvider,
  type PaymentProviderType,
  type PaymentTransactionData,
} from "@/payment/interfaces";
import { paymentConfig } from "@/payment/payment.config";
import { PriceFeedsService } from "@/price-feeds";
import { RpcManagerService } from "@/rpc-manager";
import { Service } from "typedi";
import {
  type Address,
  erc20Abi,
  formatUnits,
  parseUnits,
  stringify,
} from "viem";
import {
  GLUEX_BASE_URL,
  GLUEX_EXCHANGE_RATE_BASE_URL,
  GLUEX_NATIVE_TOKEN_ADDRESS,
} from "./constants";
import {
  type TokenPairExchangeRate,
  type TokenPaymentQuote,
} from "./interfaces";

@Service()
export class GluexPaymentService implements PaymentProvider {
  type: PaymentProviderType;

  constructor(
    @InjectConfig(paymentConfig)
    private readonly paymentConfiguration: ConfigType<typeof paymentConfig>,
    @InjectConfig(gasEstimatorConfig)
    private readonly gasEstimatorConfiguration: ConfigType<
      typeof gasEstimatorConfig
    >,
    private readonly logger: Logger,
    private readonly apiCallService: ApiCallService,
    private readonly chainsService: ChainsService,
    private readonly priceFeedsService: PriceFeedsService,
    private readonly rpcManagerService: RpcManagerService,
  ) {
    logger.setCaller(GluexPaymentService);

    this.type = "gluex";
  }

  async getTokenPairExchangeRate(
    tokenAddress: Address,
    tokenDecimal: number,
    chainId: string,
  ): Promise<number> {
    try {
      const chainName = await this.chainsService.getGlueXChainName(chainId);

      if (!chainName) {
        throw new BadRequestException(
          "Failed to fetch payment token exchange rate",
        );
      }

      const headers = {
        accept: "application/json",
        "Content-Type": "application/json",
      };

      const axiosClient = this.apiCallService.getAxios(
        GLUEX_EXCHANGE_RATE_BASE_URL,
        30000,
        headers,
      );

      const data = stringify([
        {
          domestic_blockchain: chainName,
          domestic_token: tokenAddress,
          foreign_blockchain: chainName,
          foreign_token: GLUEX_NATIVE_TOKEN_ADDRESS,
        },
      ]);

      const response = await this.apiCallService.post(axiosClient, "/", data);

      if (!response.data) {
        throw new BadRequestException(
          "Failed to fetch payment token exchange rate",
        );
      }

      const [exchangeRateInfo] = response.data as TokenPairExchangeRate[];

      if (!exchangeRateInfo || Number(exchangeRateInfo.price) <= 0) {
        throw new BadRequestException(
          "Failed to fetch payment token exchange rate",
        );
      }

      const exchangeRate =
        Number(exchangeRateInfo.price) /
        10 **
          (this.gasEstimatorConfiguration.nativeCoinDecimals - tokenDecimal);

      return exchangeRate;
    } catch (error) {
      this.logger.trace(
        {
          paymentServiceType: this.type,
          tokenAddress,
          tokenDecimal,
          chainId,
          error,
          errorMessage: (error as Error)?.message || "Something went wrong",
        },
        "Failed to fetch payment token exchange rate",
      );
      throw new BadRequestException(
        "Your selected gas payment token for your supertransaction is not supported. Please use a different token to pay for the supertransaction.",
      );
    }
  }

  async calculateTokenAmount(
    totalCostInDollars: number,
    tokenAddress: Address,
    chainId: string,
  ) {
    try {
      const decimals = await this.rpcManagerService.executeRequest(
        chainId,
        (chainClient) => {
          return chainClient.readContract({
            address: tokenAddress,
            abi: erc20Abi,
            functionName: "decimals",
          });
        },
      );

      const [exchangeRate, nativeCoinUsdPrice, nativeCoinDecimals] =
        await Promise.all([
          this.getTokenPairExchangeRate(tokenAddress, decimals, chainId),
          this.priceFeedsService.getNativeTokenPrice(chainId),
          this.priceFeedsService.getNativeTokenDecimals(chainId),
        ]);

      if (exchangeRate <= 0) {
        throw new BadRequestException("Invalid payment token exchange rate");
      }

      // Native currency dollar value from oracle
      const nativeCurrencyDollarValue = Number(
        formatUnits(nativeCoinUsdPrice, nativeCoinDecimals),
      );

      // USD cost is converted to native currency cost
      const totalNativeCurrencyForPayment = (
        totalCostInDollars / nativeCurrencyDollarValue
      ).toFixed(nativeCoinDecimals);

      // Required target token based on the native currency with the help of exchange rate.
      // Example: 0.5 ETH Gas cost
      // USDT to ETH Exchange rate: 0.00055
      // 1400 USDT token equals 0.5 ETH
      // Output is 1400 USDT tokens. This is achieved by exchange rate
      const tokenAmount = (
        Number(totalNativeCurrencyForPayment) / exchangeRate
      ).toFixed(decimals);

      return { amount: parseUnits(tokenAmount, decimals), decimals };
    } catch (error) {
      this.logger.trace(
        {
          paymentServiceType: this.type,
          tokenAddress,
          chainId,
          error,
          errorMessage: (error as Error)?.message || "Something went wrong",
        },
        "Failed to fetch payment token exchange rate",
      );
      throw new BadRequestException(
        "Your selected gas payment token for your supertransaction is not supported. Please use a different token to pay for the supertransaction.",
      );
    }
  }

  async getPaymentRouteTransactionData(
    sender: Address,
    recipient: Address,
    tokenAddress: Address,
    totalCostInDollars: number,
    chainId: string,
  ): Promise<GetPaymentRoutePayload> {
    try {
      const tokenAmount = await this.calculateTokenAmount(
        totalCostInDollars,
        tokenAddress,
        chainId,
      );

      const chainName = await this.chainsService.getGlueXChainName(chainId);

      if (!chainName) {
        throw new BadRequestException(
          "Failed to fetch payment transaction data",
        );
      }

      const headers = {
        accept: "application/json",
        "x-api-key": this.paymentConfiguration.gluexApiKey || "",
      };

      const axiosClient = this.apiCallService.getAxios(
        GLUEX_BASE_URL,
        30000,
        headers,
      );

      const data = stringify({
        inputToken: tokenAddress,
        outputToken: GLUEX_NATIVE_TOKEN_ADDRESS,
        inputAmount: tokenAmount.amount,
        userAddress: sender,
        outputReceiver: recipient,
        chainID: chainName,
        uniquePID: this.paymentConfiguration.gluexPartnerUniqueId as string,
        isPermit2: false,
      });

      const response = await this.apiCallService.post<{
        statusCode: number;
        result: TokenPaymentQuote;
      }>(axiosClient, "/v1/quote", data);

      const quote = response.data.result;

      if (!response.data || !quote) {
        throw new BadRequestException(
          "Failed to fetch payment transaction data",
        );
      }

      const paymentRouteTransactionData: PaymentTransactionData = {
        to: quote.router,
        data: quote.calldata,
        value: 0n,
        gasLimit: BigInt(this.gasEstimatorConfiguration.gluexRouterGasLimit),
      };

      return { paymentRouteTransactionData, tokenAmount };
    } catch (error) {
      this.logger.trace(
        {
          paymentServiceType: this.type,
          tokenAddress,
          totalCostInDollars,
          chainId,
          error,
          errorMessage: (error as Error)?.message || "Something went wrong",
        },
        "Failed to fetch payment transaction data",
      );
      throw new BadRequestException(
        "Your selected gas payment token for your supertransaction is not supported. Please use a different token to pay for the supertransaction.",
      );
    }
  }
}
