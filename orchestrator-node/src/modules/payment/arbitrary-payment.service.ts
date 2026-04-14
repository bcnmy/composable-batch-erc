import { ChainsService } from "@/chains";
import { BadRequestException, withTrace } from "@/common";
import { Logger } from "@/core/logger";
import { Service } from "typedi";
import { type Address } from "viem";
import {
  type GetPaymentRoutePayload,
  type PaymentProvider,
} from "./interfaces";
import { GluexPaymentService } from "./providers/gluex";
import { LiFiPaymentService } from "./providers/lifi";

@Service()
export class ArbitraryPaymentService {
  paymentProviders: PaymentProvider[];

  constructor(
    private readonly logger: Logger,
    private readonly chainsService: ChainsService,
    private readonly lifiPaymentService: LiFiPaymentService,
    private readonly gluexPaymentService: GluexPaymentService,
  ) {
    logger.setCaller(ArbitraryPaymentService);

    // Implement various payment providers and add it here to extend the payment routers support
    this.paymentProviders = [this.lifiPaymentService, this.gluexPaymentService];
  }

  // All the payment providers are requested at the same time. The first one to provide successful route
  // will be considered for swap. The failure ones are ignored.
  async getPaymentRouteTransactionData(
    sender: Address,
    recipient: Address,
    tokenAddress: Address,
    totalCostInDollars: number,
    chainId: string,
  ): Promise<GetPaymentRoutePayload> {
    try {
      const paymentProviderSupportStatus = new Map<string, boolean>();

      const paymentRouteResponse = await withTrace(
        "paymentProvider.paymentRouteForArbitraryTokenSwap",
        async () => {
          await Promise.all(
            this.paymentProviders.map(async (paymentProvider) => {
              const isPaymentProviderSupported =
                await this.chainsService.isPaymentProviderChainSupported(
                  paymentProvider.type,
                  chainId,
                );

              paymentProviderSupportStatus.set(
                paymentProvider.type,
                isPaymentProviderSupported,
              );
            }),
          );

          const paymentRequestPromises: Promise<GetPaymentRoutePayload>[] = [];

          for (const paymentProvider of this.paymentProviders) {
            if (paymentProviderSupportStatus.get(paymentProvider.type)) {
              const paymentRouteRequestPromise =
                paymentProvider.getPaymentRouteTransactionData(
                  sender,
                  recipient,
                  tokenAddress,
                  totalCostInDollars,
                  chainId,
                );

              paymentRequestPromises.push(paymentRouteRequestPromise);
            }
          }

          if (paymentRequestPromises.length <= 0) {
            throw new BadRequestException(
              "Failed to fetch payment transaction data",
            );
          }

          const paymentRouteResponse = await Promise.any(
            paymentRequestPromises.map((promise) => promise),
          );

          return paymentRouteResponse;
        },
      )();

      if (!paymentRouteResponse) {
        throw new BadRequestException(
          "Failed to fetch payment transaction data",
        );
      }

      return paymentRouteResponse;
    } catch (error) {
      this.logger.trace(
        {
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
