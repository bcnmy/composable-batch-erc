import {
  addressSchema,
  bigIntLikeSchema,
  booleanSchema,
  etherSchema,
  hexSchema,
  intLikeSchema,
} from "@/common";
import { Container } from "typedi";
import { fromHex, isHex } from "viem";
import { z } from "zod";
import { ChainsService } from "./chains.service";
import { CHAIN_CONFIG_DEFAULTS } from "./constants";

export const chainConfigIdSchema = z
  .string()
  .or(z.number())
  .transform((value) => `${value}`);

export const chainConfigPriceSchema = z
  .object({
    type: z.literal("oracle").default("oracle"),
    chainId: chainConfigIdSchema,
    oracle: addressSchema,
  })
  .or(
    z.object({
      type: z.literal("fixed").default("fixed"),
      value: bigIntLikeSchema,
      decimals: intLikeSchema,
    }),
  );

export const chainConfigContractsSchema = z.object({
  entryPointV7: addressSchema.default(
    "0x0000000071727De22E5E9d8BAf0edAc6f37da032",
  ),
  meeEntryPointV7: addressSchema.default(
    "0xE854C84cD68fC434cB3B0042c29235D452cAD977",
  ),
  pmFactory: addressSchema.default(
    "0x000000005824a1ED617994dF733151D26a4cf03d",
  ),
  disperse: addressSchema.default("0xd15fE25eD0Dba12fE05e7029C88b10C25e8880E3"),
});

export const chainConfigPaymentTokenSchema = z.object({
  name: z.string(),
  address: addressSchema,
  symbol: z.string(),
  decimals: intLikeSchema,
  price: chainConfigPriceSchema,
  permitEnabled: z.boolean().default(false),
});

export const paymentTokenSchema = chainConfigPaymentTokenSchema.omit({
  price: true,
});

const chainConfigSchemaBase = z.object({
  chainId: chainConfigIdSchema,
  name: z.string(),
  type: z.enum(["evm", "optimism", "arbitrum"]).default("evm"),
  rpcs: z.array(z.string()).min(0).max(5),
  l1ChainId: chainConfigIdSchema.optional(),
  gasPriceMode: z.enum(["standard", "fast", "rapid"]).default("standard"),
  gasCacheDuration: z.number().default(30000), // TODO: Add schema
  feeHistoryBlockTagOverride: z.string().optional(),
  eip1559: z.boolean().default(false),
  /** Optional minimum maxFeePerGas (wei) for legacy chains; RPC may reject below this (e.g. BSC). */
  minMaxFeePerGas: bigIntLikeSchema.optional(),
  paymasterFunding: etherSchema.default("0.025"),
  paymasterFundingThreshold: etherSchema.default("0"),
  paymasterInitCode: hexSchema.optional(),
  waitConfirmations: z.number().default(3),
  waitConfirmationsTimeout: z.number().default(60_000), // 60 seconds
  gasLimitOverrides: z
    .object({
      paymasterVerificationGasLimit: bigIntLikeSchema.optional(),
      senderCreateGasLimit: bigIntLikeSchema.optional(),
      baseVerificationGasLimit: bigIntLikeSchema.optional(),
      fixedHandleOpsGas: bigIntLikeSchema.optional(),
      perAuthBaseCost: bigIntLikeSchema.optional(),
    })
    .default({}),
  simulationGasLimitBuffers: z
    .object({
      callGasLimit: bigIntLikeSchema.optional(),
      verificationGasLimit: bigIntLikeSchema.optional(),
    })
    .default({}),
  simulationOverrides: z
    .object({
      gas: bigIntLikeSchema.optional(),
    })
    .default({}),
  executionOverrides: z
    .object({
      gas: bigIntLikeSchema.optional(),
    })
    .default({}),
  isTestChain: z.boolean().default(false),
  isLowBlockTimeChain: booleanSchema.default(false),
  contracts: chainConfigContractsSchema.default({}),
  price: chainConfigPriceSchema,
  paymentTokens: z.array(chainConfigPaymentTokenSchema).nonempty(),
  batcher: z
    .object({
      batchGasLimit: bigIntLikeSchema.default(
        CHAIN_CONFIG_DEFAULTS.batcher.batchGasLimit,
      ),
    })
    .default({}),
  executor: z
    .object({
      workerCount: intLikeSchema
        .default(1)
        .refine(
          (value) => value > 0,
          "EOA Workers count should be greater than zero",
        ),
      workerFunding: etherSchema.default("0.001"),
      workerFundingThreshold: etherSchema.default("0"),
      stalledJobsRetryInterval: z
        .number()
        .default(CHAIN_CONFIG_DEFAULTS.executor.stalledJobsRetryInterval),
      rateLimitMaxRequestsPerInterval: z
        .number()
        .default(
          CHAIN_CONFIG_DEFAULTS.executor.rateLimitMaxRequestsPerInterval,
        ),
      rateLimitDuration: z
        .number()
        .default(CHAIN_CONFIG_DEFAULTS.executor.rateLimitDuration),
      pollInterval: z.number().default(1000), // 1000 milliseconds,
    })
    .default({}),
  simulator: z
    .object({
      stalledJobsRetryInterval: z
        .number()
        .default(CHAIN_CONFIG_DEFAULTS.simulator.stalledJobsRetryInterval),
      rateLimitMaxRequestsPerInterval: z
        .number()
        .default(
          CHAIN_CONFIG_DEFAULTS.simulator.rateLimitMaxRequestsPerInterval,
        ),
      rateLimitDuration: z
        .number()
        .default(CHAIN_CONFIG_DEFAULTS.simulator.rateLimitDuration),
      numWorkers: z
        .number()
        .default(CHAIN_CONFIG_DEFAULTS.simulator.numWorkers),
      workerConcurrency: z
        .number()
        .default(CHAIN_CONFIG_DEFAULTS.simulator.workerConcurrency),
      traceCallRetryDelay: z
        .number()
        .default(CHAIN_CONFIG_DEFAULTS.simulator.traceCallRetryDelay),
    })
    .default({}),
});

export const chainConfigSchema = chainConfigSchemaBase
  .extend({
    sharedNodeConfigs: z
      .array(chainConfigSchemaBase.pick({ rpcs: true }))
      .min(0)
      .max(5)
      .default([]),
  })
  .transform((data) => {
    // Extract the node id
    const meeNodeId = Number(process.env.NODE_ID || 0) || 0;

    // Get root level rpcs
    const rootRpcs = Array.isArray(data.rpcs) ? data.rpcs : [];

    // Determine shared rpcs for this node id
    let sharedRpcs: string[] = [];
    if (
      Array.isArray(data.sharedNodeConfigs) &&
      data.sharedNodeConfigs.length >= meeNodeId + 1
    ) {
      sharedRpcs = Array.isArray(data.sharedNodeConfigs[meeNodeId].rpcs)
        ? data.sharedNodeConfigs[meeNodeId].rpcs
        : [];
    }

    // If root level rpcs are missing but sharedRpcs exist, assign sharedRpcs to rpcs at root level
    if (rootRpcs.length === 0 && sharedRpcs.length > 0) {
      return {
        ...data,
        rpcs: sharedRpcs,
      };
    }

    // else return the data as is
    return data;
  })
  .superRefine((data, ctx) => {
    const rootRpcs = Array.isArray(data.rpcs) ? data.rpcs : [];

    // No need to check sharedRpcs here anymore; if rpcs is empty and nothing assigned, it's invalid
    if (rootRpcs.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "At least one RPC must be specified in either `rpcs` or `sharedNodeConfigs.rpcs`",
        path: ["rpcs"],
      });
    }
  });

export const supportedChainIdSchema = chainConfigIdSchema.superRefine(
  async (value, ctx) => {
    const chainId = isHex(value) ? String(fromHex(value, "number")) : value;

    let isSupported = false;

    if (ctx.path.includes("eip7702Auth")) {
      // ChainID 0 is always valid for auth. 0 represents multichain auth
      if (chainId === "0") return true;
    } else {
      isSupported =
        await Container.get(ChainsService).isChainSupported(chainId);

      if (!isSupported) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Unsupported chain",
          path: ["chainId"],
        });
      }
    }

    return isSupported;
  },
);
