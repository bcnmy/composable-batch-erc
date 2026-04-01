const AAVE_WETH_LTV = 0.80
const SWAP_FEE = 0.0005 // Uniswap fee tier 500 = 0.05%
const EFFECTIVE_MULTIPLIER = AAVE_WETH_LTV * (1 - SWAP_FEE)
const LIQ_THRESHOLD = 0.825

/** Compute the on-chain safety guard HF for a given loop count.
 *  Set to 95% of the expected HF — leaves room for swap slippage
 *  while still protecting against large price moves. */
export function safetyGuardHF(loops: number): number {
  const expected = estimateHealthFactor(leverageAfterLoops(loops))
  return Math.max(expected * 0.95, 1.05)
}

export const MIN_LEVERAGE = 1.5
export const MAX_LEVERAGE = 4.0

export function leverageAfterLoops(loops: number): number {
  let leverage = 1
  let multiplier = 1
  for (let i = 0; i < loops; i++) {
    multiplier *= EFFECTIVE_MULTIPLIER
    leverage += multiplier
  }
  return leverage
}

export function loopsForLeverage(target: number): number {
  for (let n = 1; n <= 10; n++) {
    if (leverageAfterLoops(n) >= target * 0.95) return n
  }
  return 10
}

export function estimateHealthFactor(leverage: number): number {
  if (leverage <= 1) return Infinity
  return (LIQ_THRESHOLD * leverage) / (leverage - 1)
}

export function liquidationPrice(entryPrice: number, leverage: number): number {
  if (leverage <= 1) return 0
  return (entryPrice * (leverage - 1)) / (leverage * LIQ_THRESHOLD)
}

export function maxDrawdown(leverage: number): number {
  if (leverage <= 1) return 100
  const liqRatio = (leverage - 1) / (leverage * LIQ_THRESHOLD)
  return (1 - liqRatio) * 100
}

/**
 * Compute exact number of unwind iterations needed to fully clear debt.
 * Simulates the iterative withdraw→swap→repay cycle accounting for
 * the withdraw fraction, swap fees, and liquidation threshold.
 */
export function unwindIterationsNeeded(leverage: number): number {
  if (leverage <= 1) return 0
  const f = 0.80   // withdraw fraction per iteration
  const s = 0.9995 // swap efficiency (1 - 0.05% Uniswap fee)
  let r = (leverage - 1) / leverage // debt-to-collateral ratio

  for (let n = 1; n <= 20; n++) {
    const excessFrac = 1 - r / LIQ_THRESHOLD
    if (excessFrac <= 0) continue
    const repayFrac = f * excessFrac * s
    if (r - repayFrac <= 0) return n // debt fully cleared this iteration
    const newC = 1 - f * excessFrac
    r = (r - repayFrac) / newC
  }
  return 20
}

export function estimatePosition(ethAmount: number, loops: number, ethPrice: number) {
  const leverage = leverageAfterLoops(loops)
  const totalCollateral = ethAmount * leverage
  const totalDebt = (totalCollateral - ethAmount) * ethPrice
  const healthFactor = estimateHealthFactor(leverage)
  const liqPrice = liquidationPrice(ethPrice, leverage)
  const drawdown = maxDrawdown(leverage)

  return {
    leverage: Math.round(leverage * 100) / 100,
    totalCollateralEth: Math.round(totalCollateral * 10000) / 10000,
    totalDebtUsd: Math.round(totalDebt * 100) / 100,
    estimatedHealthFactor: Math.round(healthFactor * 100) / 100,
    liquidationPrice: Math.round(liqPrice * 100) / 100,
    maxDrawdownPct: Math.round(drawdown * 10) / 10,
    loops,
  }
}
