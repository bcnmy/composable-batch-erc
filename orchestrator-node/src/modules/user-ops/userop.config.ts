import process from "node:process";
import { parseNum } from "@/common";
import { registerConfigAs } from "@/core/config";

export const USEROP_MAX_WAIT_BEFORE_EXEC_START = parseNum(
  process.env.USEROP_MAX_WAIT_BEFORE_EXEC_START,
  300,
  {
    min: 60,
  },
);

export const USEROP_TRACE_CALL_SIMULATION_POLL_INTERVAL = parseNum(
  process.env.USEROP_TRACE_CALL_SIMULATION_POLL_INTERVAL,
  5,
  {
    min: 2,
  },
);

export const USEROP_DEFAULT_EXEC_WINDOW_DURATION = parseNum(
  process.env.USEROP_DEFAULT_EXEC_WINDOW_DURATION,
  300,
  {
    min: 300,
  },
);

export const USEROP_MAX_EXEC_WINDOW_DURATION = parseNum(
  process.env.USEROP_MAX_EXEC_WINDOW_DURATION,
  86400, // 24 hours
  {
    min: 300,
  },
);

export const USEROP_MIN_EXEC_WINDOW_DURATION = parseNum(
  process.env.USEROP_MIN_EXEC_WINDOW_DURATION,
  60,
  {
    min: 60,
  },
);

export const USEROP_SAFE_WINDOW_BEFORE_EXEC_END = parseNum(
  process.env.USEROP_SAFE_WINDOW_BEFORE_EXEC_END,
  45,
  {
    min: 30,
  },
);

export const USEROP_SIMULATION_POLL_COST = parseNum(
  process.env.USEROP_SIMULATION_POLL_COST,
  0.00002,
  {
    min: 0,
    type: "float",
  },
);

export const CHAIN_POWER_FACTOR = parseNum(
  process.env.CHAIN_POWER_FACTOR,
  1.5,
  {
    min: 0,
    type: "float",
  },
);

export const USEROP_POWER_FACTOR = parseNum(
  process.env.USEROP_POWER_FACTOR,
  0,
  {
    min: 0,
    type: "float",
  },
);

export const INSTRUCTION_POWER_FACTOR = parseNum(
  process.env.INSTRUCTION_POWER_FACTOR,
  1.1,
  {
    min: 0,
    type: "float",
  },
);

export const UNIT_COST_CHAIN = parseNum(process.env.UNIT_COST_CHAIN, 0.02, {
  min: 0,
  type: "float",
});

export const UNIT_COST_USEROPS = parseNum(process.env.UNIT_COST_USEROPS, 0, {
  min: 0,
  type: "float",
});

export const BASE_COST_INSTRUCTIONS = parseNum(
  process.env.BASE_COST_INSTRUCTIONS,
  0.003,
  {
    min: 0,
    type: "float",
  },
);

export const UNIT_COST_INSTRUCTIONS = parseNum(
  process.env.UNIT_COST_INSTRUCTIONS,
  0.005,
  {
    min: 0,
    type: "float",
  },
);

export const UNIT_COST_COMPOSABLE = parseNum(
  process.env.UNIT_COST_COMPOSABLE,
  0.02,
  {
    min: 0,
    type: "float",
  },
);

export const userOpConfig = registerConfigAs("userop", () => {
  return {
    userOpMaxWaitBeforeExecStart: USEROP_MAX_WAIT_BEFORE_EXEC_START,
    userOpTraceCallSimulationPollInterval:
      USEROP_TRACE_CALL_SIMULATION_POLL_INTERVAL,
    userOpMaxExecWindowDuration: USEROP_MAX_EXEC_WINDOW_DURATION,
    userOpMinExecWindowDuration: USEROP_MIN_EXEC_WINDOW_DURATION,
    userOpDefaultExecWindowDuration: USEROP_DEFAULT_EXEC_WINDOW_DURATION,
    userOpSafeWindowBeforeExecEnd: USEROP_SAFE_WINDOW_BEFORE_EXEC_END,
    userOpSimulationPollCost: USEROP_SIMULATION_POLL_COST,
    chainPowerFactor: CHAIN_POWER_FACTOR,
    userOpsPowerFactor: USEROP_POWER_FACTOR,
    instructionPowerFactor: INSTRUCTION_POWER_FACTOR,
    unitCostChain: UNIT_COST_CHAIN,
    unitCostUserOps: UNIT_COST_USEROPS,
    unitCostInstructions: UNIT_COST_INSTRUCTIONS,
    unitCostComposable: UNIT_COST_COMPOSABLE,
    baseCostInstructions: BASE_COST_INSTRUCTIONS,
  };
});
