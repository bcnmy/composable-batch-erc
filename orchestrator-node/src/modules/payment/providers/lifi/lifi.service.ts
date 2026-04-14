import { ChainsService } from "@/chains/chains.service";
import { BadRequestException } from "@/common";
import { type ConfigType, InjectConfig } from "@/core/config";
import { Logger } from "@/core/logger";
import { nodeConfig } from "@/node/node.config";
import {
  type GetPaymentRoutePayload,
  type PaymentProvider,
  type PaymentProviderType,
  type PaymentTransactionData,
} from "@/payment/interfaces";
import { paymentConfig } from "@/payment/payment.config";
import { QuoteRequest, createConfig, getQuote, getToken } from "@lifi/sdk";
import { Service } from "typedi";
import { type Address, type Hex, fromHex, parseUnits } from "viem";
import { LIFI_NATIVE_TOKEN_ADDRESS } from "./constants";

@Service()
export class LiFiPaymentService implements PaymentProvider {
  type: PaymentProviderType;

  constructor(
    private readonly logger: Logger,
    private readonly chainsService: ChainsService,
    @InjectConfig(nodeConfig)
    private readonly nodeConfiguration: ConfigType<typeof nodeConfig>,
    @InjectConfig(paymentConfig)
    private readonly paymentConfiguration: ConfigType<typeof paymentConfig>,
  ) {
    logger.setCaller(LiFiPaymentService);

    this.type = "lifi";

    this.initialize();
  }

  initialize() {
    const chainIds = this.chainsService.chainIds;

    const rpcUrls: Record<number, string> = {};

    for (const chainId of chainIds) {
      const chainSettings = this.chainsService.getChainSettings(chainId);
      rpcUrls[Number(chainId)] = chainSettings.rpcs[0];
    }

    createConfig({
      integrator: "ERC8211_ORCHESTRATOR",
      rpcUrls,
      apiKey: this.paymentConfiguration.lifiApiKey,
      userId: this.nodeConfiguration.name,
      routeOptions: {
        // We are prioritizing a balance between cheapest and fastest routes. So node will be faster and slippage will be less for fees
        order: "RECOMMENDED",
        allowDestinationCall: false,
      },
    });
  }

  // This will return how much token amount to be sent to receive equal amount of ETH after swap
  async calculateTokenAmount(
    totalCostInDollars: number,
    tokenAddress: Address,
    chainId: string,
  ) {
    try {
      const paymentTokenInfo = await getToken(Number(chainId), tokenAddress);
      const paymentTokenAmount =
        totalCostInDollars / Number(paymentTokenInfo.priceUSD);

      // We are charging 0.03% extra fees to compensate node for slippage loss.
      const slippage = 0.03;

      const adjustedPaymentTokenAmount =
        paymentTokenAmount * (1 + slippage / 100);

      return {
        amount: parseUnits(
          String(adjustedPaymentTokenAmount),
          paymentTokenInfo.decimals,
        ),
        decimals: paymentTokenInfo.decimals,
      };
    } catch (error) {
      this.logger.trace(
        {
          paymentServiceType: this.type,
          tokenAddress,
          chainId,
          error,
          errorMessage: (error as Error)?.message || "Something went wrong",
        },
        "Failed to calculate payment token exchange rate",
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

      const quoteRequest: QuoteRequest = {
        fromChain: chainId,
        toChain: chainId,
        fromToken: tokenAddress,
        toToken: LIFI_NATIVE_TOKEN_ADDRESS,
        fromAmount: tokenAmount.amount.toString(),
        fromAddress: sender,
        toAddress: recipient,
      };

      const quote = await getQuote(quoteRequest);

      if (!quote || !quote.transactionRequest) {
        throw new BadRequestException(
          "Failed to fetch payment transaction data",
        );
      }

      const { to, data, value, gasLimit } = quote.transactionRequest;

      if (!to || !data || !gasLimit) {
        throw new BadRequestException("Invalid transaction data");
      }

      const paymentRouteTransactionData: PaymentTransactionData = {
        to: to as Address,
        data: data as Hex,
        value: value ? fromHex(value as Hex, "bigint") : 0n,
        gasLimit: fromHex(gasLimit as Hex, "bigint"),
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
