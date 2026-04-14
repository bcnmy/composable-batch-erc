import { parseNum } from "@/common";
import { registerConfigAs } from "@/core/config";

export const gasEstimatorConfig = registerConfigAs("gas-estimator", () => {
  const NATIVE_TRANSFER_GAS_LIMIT = 45000;
  const TOKEN_TRANSFER_GAS_LIMIT = 250000;
  const TOKEN_APPROVAL_GAS_LIMIT = 70000;

  const BASE_VERIFICATION_GAS_LIMIT = 150000;
  const SENDER_CREATE_GAS = 300000;

  // If the GlueX transaction fails for gas due to complicated routes. This needs to be increased.
  const GLUEX_ROUTER_GAS_LIMIT = 500000;

  const NATIVE_COIN_DECIMALS = 18;
  const ITX_COST_DECIMALS = 6;

  const PAYMASTER_VERIFICATION_GAS = 25000;
  const PAYMASTER_POST_OP_GAS = 50000;
  const FIXED_HANDLE_OPS_GAS = 30000;
  const PER_AUTH_BASE_COST = 37500;

  const AVG_MEE_SIG_SIZE = 324;
  const NON_ZERO_BYTE_COST_EIP1559 = 16;
  const NON_ZERO_BYTE_COST_LEGACY = 68;

  const MAX_CALLDATA_GAS_LIMIT = parseNum(
    process.env.MAX_CALLDATA_GAS_LIMIT,
    4000001,
    { min: 3300001 },
  );

  return {
    nativeTransferGasLimit: NATIVE_TRANSFER_GAS_LIMIT,
    tokenTransferGasLimit: TOKEN_TRANSFER_GAS_LIMIT,
    tokenApprovalGasLimit: TOKEN_APPROVAL_GAS_LIMIT,

    gluexRouterGasLimit: GLUEX_ROUTER_GAS_LIMIT,

    nativeCoinDecimals: NATIVE_COIN_DECIMALS,

    itxCostDecimals: ITX_COST_DECIMALS,
    baseVerificationGaslimit: BASE_VERIFICATION_GAS_LIMIT,
    senderCreateGasLimit: SENDER_CREATE_GAS,

    paymasterVerificationGas: PAYMASTER_VERIFICATION_GAS,
    paymasterPostOpGas: PAYMASTER_POST_OP_GAS,

    fixedHandleOpsGas: FIXED_HANDLE_OPS_GAS,
    perAuthBaseCost: PER_AUTH_BASE_COST,

    avgMeeSigSize: AVG_MEE_SIG_SIZE,

    nonZeroByteCostEIP1559: NON_ZERO_BYTE_COST_EIP1559,
    nonZeroByteCostLegacy: NON_ZERO_BYTE_COST_LEGACY,

    maxCalldataGasLimit: MAX_CALLDATA_GAS_LIMIT,
  };
});
