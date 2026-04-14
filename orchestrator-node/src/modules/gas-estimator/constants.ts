import { GasEstimationInfo } from "./interfaces";

export const ARBITRUM_ORACLE_ADDRESS =
  "0x00000000000000000000000000000000000000C8";
export const OPTIMISM_ORACLE_ADDRESS =
  "0x420000000000000000000000000000000000000F";

export const NONCE_VALIDATION_AND_UPDATION_GAS_LIMIT = 30_000n; // 3k gas buffer approx

// SMART SESSIONS GAS LIMITS
// Reference from tx (base sepolia): 0x6e4048c5844afa83e47d1a5bc787c8011d460065ded2172cfb0106cae53b831d
export const FIXED_SMART_SESSIONS_USE_MODE_GAS_LIMIT = 120_000n; // 50k gas buffer approx

// This is a approximately safe high value. As the size of calldata changes, this can change
export const APPROXIMATE_SMART_SESSION_SINGLE_CALLDATA_DECODING_GAS_LIMIT =
  3_000n;

// This is a approximately safe high value. As the size of calldata changes, this can change
export const APPROXIMATE_SMART_SESSION_BATCH_CALLDATA_DECODING_GAS_LIMIT =
  6_000n;

export const FIXED_SMART_SESSION_CHECK_ACTION_GAS_LIMIT = 2_000n; // 1k gas buffer approx

export const FIXED_SMART_SESSION_COLD_CHECK_ACTION_POLICY_GAS_LIMIT = 3_500n; // 1k gas buffer approx

export const FIXED_SMART_SESSIONS_COLD_GET_POLICY_GAS_LIMIT = 3_500n; // 1k gas buffer approx

// Some policies are higher the cost when being checked for first time, because of cold storage access
export const FIXED_SMART_SESSIONS_POLICY_COLD_ACCESS_GAS_ESTIMATION_LOOKUP_TABLE: Record<
  string,
  bigint
> = {
  // SUDO policy
  "0x0000003111cd8e92337c100f22b7a9dbf8dee301": 1_600n, // 300 gas buffer approx
  // USAGE LIMIT policy
  "0x1f34ef8311345a3a4a4566af321b313052f51493": 10_000n, // 300 gas buffer approx
  // SPENDING LIMIT policy
  "0x00000088d48cf102a8cdb0137a9b173f957c6343": 12_250n, // 300 gas buffer approx
  // UNIVERSAL LIMIT policy
  "0x0000006dda6c463511c4e9b05cfc34c1247fcf1f": 20_000n, // 300 gas buffer approx
  // TIMEFRAME policy
  "0x8177451511de0577b911c254e9551d981c26dc72": 6_800n, // 300 gas buffer approx
  // SUDO policy V2
  "0x0000000000feec8d74e3143fbabbca515358d869": 1_600n, // 300 gas buffer approx
  // USAGE LIMIT policy V2
  "0x00000000001d4479fa2a947026204d0283cede4b": 9_800n, // 300 gas buffer approx
  // SPENDING LIMIT policy V2
  "0x000000000033212e272655d8a22402db819477a6": 15_200n, // 300 gas buffer approx
  // UNIVERSAL LIMIT policy V2
  "0x0000000000714cf48fcf88a0bfba70d313415032": 20_000n, // 300 gas buffer approx
  // TIMEFRAME policy V2
  "0x0000000000d30f611fa3bf652ac6879428586930": 6_800n, // 300 gas buffer approx
};

export const FIXED_SMART_SESSION_WARM_CHECK_ACTION_POLICY_GAS_LIMIT = 1_000n; // 1k gas buffer approx

export const FIXED_SMART_SESSIONS_WARM_GET_POLICY_GAS_LIMIT = 1_000n; // 1k gas buffer approx

// Some policies are cheap when it is being checked second time, because of warm storage access
export const FIXED_SMART_SESSIONS_POLICY_WARM_ACCESS_GAS_ESTIMATION_LOOKUP_TABLE: Record<
  string,
  bigint
> = {
  // SUDO Policy
  "0x0000003111cd8e92337c100f22b7a9dbf8dee301": 1_600n, // 300 gas buffer approx
  // USAGE LIMIT policy
  "0x1f34ef8311345a3a4a4566af321b313052f51493": 2_600n, // 300 gas buffer approx
  // SPENDING LIMIT policy
  "0x00000088d48cf102a8cdb0137a9b173f957c6343": 5_800n, // 300 gas buffer approx
  // UNIVERSAL LIMIT policy
  "0x0000006dda6c463511c4e9b05cfc34c1247fcf1f": 10_000n, // 300 gas buffer approx
  // TIMEFRAME policy
  "0x8177451511de0577b911c254e9551d981c26dc72": 2_300n, // 300 gas buffer approx
  // SUDO policy V2
  "0x0000000000feec8d74e3143fbabbca515358d869": 1_600n, // 300 gas buffer approx
  // USAGE LIMIT policy V2
  "0x00000000001d4479fa2a947026204d0283cede4b": 2_600n, // 300 gas buffer approx
  // SPENDING LIMIT policy V2
  "0x000000000033212e272655d8a22402db819477a6": 6_700n, // 300 gas buffer approx
  // UNIVERSAL LIMIT policy V2
  "0x0000000000714cf48fcf88a0bfba70d313415032": 10_000n, // 300 gas buffer approx
  // TIMEFRAME policy V2
  "0x0000000000d30f611fa3bf652ac6879428586930": 2_300n, // 300 gas buffer approx
};

export const GAS_ESTIMATION_LOOKUP_TABLE: Record<string, GasEstimationInfo> = {
  // Reference from tx (base sepolia): 0x0d4b7ce46682686d03bdd831f10b44910a41d6aa81355746e7939a72c9ba93bf
  "simple-mode": {
    validateUserOpGasLimit: 45_000n, // 20k gas buffer approx for safety
  },
  // Reference from tenderly: https://dashboard.tenderly.co/shared/simulation/81010741-a166-420e-8f6a-e3b2f0abdef1
  "onchain-mode": {
    validateUserOpGasLimit: 140_000n, // 20k gas buffer approx for safety
  },
  // Reference from tx (base sepolia): 0xfb1b7126fb1606031267ea19df823a35a80465a6b0511e89b3d752db76d12b91
  "active-permit-mode": {
    // Permit activation gas limit is excluded from here which will be dynamically calculated and added in the simulations
    validateUserOpGasLimit: 45_000n, // 20k gas buffer approx for safety
  },
  // Reference from tx (base sepolia): 0x6fe346d6a3b87ad571da00847dcdd85dc0a69185467264b1597cc5108f3431a2
  "unactive-permit-mode": {
    validateUserOpGasLimit: 45_000n, // 20k gas buffer approx for safety
  },
  // Reference from tx (Optimism): 0xa18890ff778f109248390b76354a7438df6f65ac50a6f9ba81023a3fbe547645
  "delegation-mm-dtk-mode": {
    validateUserOpGasLimit: 165_000n, // 20k gas buffer approx for safety
  },
  // Reference from tx (Optimism): 0x71353ed239d55012566dce9e2b0bacda6eef5565d518998729dc4793ac76eb57
  "non-delegation-mm-dtk-mode": {
    validateUserOpGasLimit: 55_000n, // 20k gas buffer approx for safety
  },
  // Safe Smart Account mode - executes Safe transaction for token transfer
  // Similar to mm-dtk mode, the Safe tx execution happens during validation
  "safe-execution-safe-sa-mode": {
    validateUserOpGasLimit: 180_000n, // Higher gas limit for Safe tx execution + signature verification
  },
  // Safe Smart Account mode - no Safe tx execution (just signature verification)
  "non-safe-execution-safe-sa-mode": {
    validateUserOpGasLimit: 55_000n, // 20k gas buffer approx for safety
  },
};
