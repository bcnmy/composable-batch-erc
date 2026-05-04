import { ApiCallService } from "@/api-call";
import { ChainsService } from "@/chains";
import { BadRequestException, withTrace } from "@/common";
import { Logger } from "@/core/logger";
import {
  HealthCheckDataWithChains,
  type HealthCheckState,
  type ServiceHealthCheckResult,
} from "@/health-check";
import { StorageService } from "@/storage";
import { fromEntries } from "remeda";
import { Service } from "typedi";
import {
  type Address,
  type Hex,
  encodeAbiParameters,
  isHex,
  keccak256,
  stringify,
  zeroAddress,
} from "viem";
import { TOKEN_SLOT_DETECTION_SERVER_BASE_URL } from "./constants";
import { type TokenStorageSlotResponse } from "./interfaces";

@Service()
export class TokenSlotDetectionService {
  constructor(
    private readonly logger: Logger,
    private readonly apiCallService: ApiCallService,
    private readonly chainsService: ChainsService,
    private readonly storageService: StorageService,
  ) {
    logger.setCaller(TokenSlotDetectionService);
  }

  async performHealthCheck(): Promise<
    ServiceHealthCheckResult<HealthCheckDataWithChains>
  > {
    try {
      const chains = fromEntries(
        await Promise.all(
          this.chainsService.chainIds.map(async (chainId) => {
            try {
              const supportedPaymentTokens =
                await this.chainsService.getSupportedPaymentTokens();

              const [filteredPaymentTokenInfo] = supportedPaymentTokens.filter(
                (supportedToken) => supportedToken.chainId === chainId,
              );

              const paymentTokens =
                filteredPaymentTokenInfo?.paymentTokens?.filter(
                  (token) => token.address !== zeroAddress,
                );

              const tokenAddress = paymentTokens?.[0]?.address || zeroAddress;

              const slot = await this.getBalanceStorageSlot(
                tokenAddress,
                zeroAddress,
                chainId,
              );

              const state: HealthCheckState = isHex(slot)
                ? "healthy"
                : "unhealthy";

              return [
                chainId,
                {
                  status: state,
                } as const,
              ];
            } catch (error) {
              this.logger.info(
                {
                  chainId,
                  error: (error as Error).message || stringify(error),
                },
                "Failed to check health for token slot detection service",
              );

              return [
                chainId,
                {
                  status: "unhealthy" as HealthCheckState,
                } as const,
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
        "Failed to check health for token slot detection service",
      );
      return { chains: {} };
    }
  }

  async getBalanceStorageSlot(
    tokenAddress: Address,
    accountAddress: Address,
    chainId: string,
  ) {
    // Token slot in Hex. Eg: 0x3 => Slot 3 in storage layout
    let slot: Hex = "0x3";

    try {
      const tokenSlotKey = `token-slot-key::${tokenAddress.toLowerCase()}::${chainId}`;

      const cacheInfo = await this.storageService.getCache<{ slot: Hex }>(
        tokenSlotKey,
      );

      if (cacheInfo?.slot && isHex(cacheInfo.slot)) {
        slot = cacheInfo.slot;
      } else {
        const axiosClient = this.apiCallService.getAxios(
          TOKEN_SLOT_DETECTION_SERVER_BASE_URL,
        );

        const { data: response } = await withTrace(
          "simulation.detectTokenBalanceStorageSlot",
          async () =>
            await this.apiCallService.get<TokenStorageSlotResponse>(
              axiosClient,
              `/${chainId}/${tokenAddress}`,
            ),
          {
            chainId,
            tokenAddress,
            accountAddress,
          },
        )();

        if (!response.success) {
          this.logger.error("Failed to fetch token slot", {
            tokenAddress,
            chainId,
            errorMessage: response.error,
          });

          throw new BadRequestException(
            "Failed to simulate your supertransaction. Error: Token overrides failed",
          );
        }

        slot = response.msg.slot;
        await this.storageService.setCache(tokenSlotKey, {
          slot,
        });
      }
    } catch (error) {
      const err = error as { data: { success: false; error: string } };

      const errorMessage =
        "Failed to detect token slot. Please check your token overrides";

      if (err?.data?.error === "SlotNotFound") {
        throw new BadRequestException(errorMessage);
      }

      this.logger.error({ error }, errorMessage);
      throw new BadRequestException(errorMessage);
    }

    // For mapping(address => uint256)
    return keccak256(
      encodeAbiParameters(
        [{ type: "address" }, { type: "uint256" }],
        [accountAddress, BigInt(slot)],
      ),
    );
  }
}
