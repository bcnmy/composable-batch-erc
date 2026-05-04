import { ChainsService } from "@/chains";
import { BadRequestException } from "@/common";
import { type ConfigType, InjectConfig } from "@/core/config";
import { EncoderAndDecoderService } from "@/encoder-and-decoder";
import { gasEstimatorConfig } from "@/gas-estimator/gas-estimator.config";
import { nodeConfig } from "@/node/node.config";
import { MeeUserOpRequest } from "@/user-ops/interfaces";
import { Service } from "typedi";
import {
  Address,
  type Hex,
  encodeFunctionData,
  erc20Abi,
  formatUnits,
  parseUnits,
} from "viem";
import {
  FeePaymentType,
  PaymentCalldataParams,
  PreparePaymentUserOpsParams,
} from "./interfaces";

@Service()
export class PaymentService {
  constructor(
    @InjectConfig(nodeConfig)
    private readonly nodeConfiguration: ConfigType<typeof nodeConfig>,
    @InjectConfig(gasEstimatorConfig)
    private readonly gasEstimatorConfiguration: ConfigType<
      typeof gasEstimatorConfig
    >,
    private readonly encoderAndDecoderService: EncoderAndDecoderService,
    private readonly chainService: ChainsService,
  ) {}

  preparePaymentCalldata(
    feePaymentType: FeePaymentType,
    paymentParams: PaymentCalldataParams,
  ): Hex {
    let calldata: Hex = "0x";

    const { type, tokenAddress, amount, eoa } = paymentParams;

    switch (feePaymentType) {
      case "NATIVE": {
        calldata = this.encoderAndDecoderService.encodeCallData([
          {
            to: this.nodeConfiguration.feeBeneficiary,
            value: amount,
            data: "0x",
          },
        ]);
        break;
      }
      case "CONFIGURED_TOKEN":
      case "ARBITRARY_TOKEN": {
        if (type === "fusion" && !eoa) {
          throw new BadRequestException(
            "Failed to generate a payment calldata",
          );
        }

        calldata = this.encoderAndDecoderService.encodeCallData([
          {
            to: tokenAddress,
            value: BigInt(0),
            data: encodeFunctionData({
              abi: erc20Abi,
              functionName: type === "normal" ? "transfer" : "transferFrom",
              args:
                type === "normal"
                  ? [this.nodeConfiguration.feeBeneficiary, amount]
                  : [
                      eoa as Address,
                      this.nodeConfiguration.feeBeneficiary,
                      amount,
                    ],
            }),
          },
        ]);
        break;
      }
    }

    if (!calldata || calldata === "0x") {
      throw new BadRequestException("Failed to generate a payment calldata");
    }

    return calldata;
  }

  dollarCostToTokenAmount(
    token: Address,
    chainId: string,
    dollarCost: number,
    paymentTokenUsdPrice: bigint,
    paymentTokenUsdPriceDecimals: number,
  ): { amount: bigint; decimals: number } {
    const paymentToken = this.chainService.getChainPaymentToken(chainId, token);

    if (!paymentToken) {
      throw new BadRequestException("Invalid payment token");
    }

    const paymentTokenDecimals = paymentToken.decimals;

    if (paymentTokenUsdPrice === 0n) {
      return { amount: paymentTokenUsdPrice, decimals: paymentTokenDecimals };
    }

    const paymentTokenDollarValue = Number(
      formatUnits(paymentTokenUsdPrice, paymentTokenUsdPriceDecimals),
    );

    const totalTokenAmount = (dollarCost / paymentTokenDollarValue).toFixed(
      paymentTokenDecimals,
    );

    return {
      amount: parseUnits(totalTokenAmount, paymentTokenDecimals),
      decimals: paymentTokenDecimals,
    };
  }

  preparePaymentUserOp(params: PreparePaymentUserOpsParams) {
    const {
      feePaymentType,
      paymentInfo,
      isTrustedSponsorship,
      paymentCalldataInfo,
    } = params;

    // Initial dummy calldata for simulation and gas estimation
    let calldata: Hex = "0x";

    // Skip generating calldata for trusted payment userOp
    if (!isTrustedSponsorship) {
      try {
        calldata = this.preparePaymentCalldata(
          feePaymentType,
          paymentCalldataInfo,
        );
      } catch {
        throw new BadRequestException(
          "Your selected gas payment token for your supertransaction is not supported. Please use a different token to pay for the supertransaction.",
        );
      }
    }

    let callGasLimit = isTrustedSponsorship
      ? 0n
      : paymentInfo.callGasLimit || 0n;

    // Skip generating gas limits for trusted payment userOp
    if (!isTrustedSponsorship) {
      switch (feePaymentType) {
        case "NATIVE": {
          callGasLimit =
            callGasLimit ||
            BigInt(this.gasEstimatorConfiguration.nativeTransferGasLimit);
          break;
        }

        case "CONFIGURED_TOKEN":
        case "ARBITRARY_TOKEN": {
          callGasLimit =
            callGasLimit ||
            BigInt(this.gasEstimatorConfiguration.tokenTransferGasLimit);
          break;
        }

        default:
          throw new BadRequestException("Invalid fee payment type");
      }
    }

    const paymentMeeUserOp: MeeUserOpRequest = {
      sender: paymentInfo.sender,
      nonce: isTrustedSponsorship ? 0n : paymentInfo.nonce,
      initCode: isTrustedSponsorship ? "0x" : paymentInfo.initCode,
      callData: calldata,
      callGasLimit: callGasLimit,
      verificationGasLimit: isTrustedSponsorship
        ? 0n
        : paymentInfo.verificationGasLimit,
      chainId: paymentInfo.chainId,
      eip7702Auth: paymentInfo.eip7702Auth,
      shortEncoding: paymentInfo.shortEncoding,
      sessionDetails: paymentInfo.sessionDetails,
      metadata: [], // Payment userOps will always never have any metadata.
    };

    return paymentMeeUserOp;
  }
}
