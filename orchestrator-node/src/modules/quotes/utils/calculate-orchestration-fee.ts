import { ConfigType } from "@/core/config";
import { Logger } from "@/core/logger";
import { MeeUserOp } from "@/user-ops";
import { userOpConfig } from "@/user-ops/userop.config";
import Container from "typedi";
import { decodeInstructions } from "./parse-user-op-calldata";

const logger = Container.get(Logger).setCaller(
  "calculate-orchestration-fee-utils",
);

type OrchestrationFeeResult = {
  instructionsCount: number;
  chainsCount: number;
  isComposable: boolean;
  totalWindowSize: number;
  totalOrchestrationFee: number;
};

function calculateOrchestrationFee(
  meeUserOps: MeeUserOp[],
  config: ConfigType<typeof userOpConfig>,
): OrchestrationFeeResult {
  return {
    instructionsCount: 0,
    chainsCount: 0,
    isComposable: false,
    totalWindowSize: 0,
    totalOrchestrationFee: 0.0, // Orch fees is set to zero for now
  };
  /** ORIGINAL IMPLEMENTATION */
  // try {
  //   const instructionsData = meeUserOps
  //     .map(decodeInstructions)
  //     .filter((it) => it !== undefined);

  //   const instructionsCount = instructionsData.reduce(
  //     (acc, curr) => acc + curr.instructionsCount,
  //     0,
  //   );
  //   const chainsCount = new Set(meeUserOps.map((it) => it.chainId)).size;

  //   const isComposable = instructionsData.some((it) => it.isComposable);

  //   const totalWindowSize = meeUserOps.reduce(
  //     (acc, curr) =>
  //       acc + (curr.upperBoundTimestamp - curr.lowerBoundTimestamp),
  //     0,
  //   );

  //   const chainFee =
  //     chainsCount === 1
  //       ? 0
  //       : config.unitCostChain * chainsCount ** config.chainPowerFactor;

  //   const instructionFee =
  //     instructionsCount === 1
  //       ? config.baseCostInstructions
  //       : config.unitCostInstructions *
  //         (instructionsCount - 1) ** config.instructionPowerFactor;

  //   const composabilityFee = isComposable
  //     ? instructionsCount === 1
  //       ? 0
  //       : config.unitCostComposable
  //     : 0;

  //   const costOfTime =
  //     (totalWindowSize / config.userOpTraceCallSimulationPollInterval) *
  //     config.userOpSimulationPollCost;

  //   const totalOrchestrationFee =
  //     chainFee + instructionFee + composabilityFee + costOfTime;

  //   return {
  //     instructionsCount,
  //     chainsCount,
  //     isComposable,
  //     totalWindowSize,
  //     totalOrchestrationFee,
  //   };
  // } catch (error) {
  //   logger.error({ error }, "Error calculating orchestration fee");
  //   return {
  //     instructionsCount: 0,
  //     chainsCount: 0,
  //     isComposable: false,
  //     totalWindowSize: 0,
  //     totalOrchestrationFee: 0,
  //   };
  // }
}

export { calculateOrchestrationFee };
