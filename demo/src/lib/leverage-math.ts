const AAVE_WETH_LTV = 0.80
const SWAP_FEE = 0.0005 // Uniswap fee tier 500 = 0.05%
const BORROW_FRACTION = 0.80 // borrowFraction=80 in buildLeverageLoopInstructions
const LIQ_THRESHOLD = 0.825

/** Compute the on-chain safety guard HF for a given loop count.
 *  Set to 95% of the expected HF — leaves room for swap slippage
 *  while still protecting against large price moves. */
/** Compute the on-chain safety guard HF for a fresh position with given loop count.
 *  Set to 95% of the expected HF — leaves room for swap slippage. */
export function safetyGuardHF(loops: number): number {
  const expected = estimateHealthFactor(leverageAfterLoops(loops))
  return Math.max(expected * 0.95, 1.05)
}

export const MIN_LEVERAGE = 1.5
export const MAX_LEVERAGE = 4.0

/**
 * Simulate the actual Aave leverage loop to compute resulting leverage.
 *
 * Each iteration: supply WETH → borrow (BF% of available) USDC → swap USDC→WETH.
 * Available borrows = totalCollateral * LTV - totalDebt (Aave formula).
 *
 * This matches the on-chain execution exactly (minus price impact).
 */
export function leverageAfterLoops(loops: number): number {
  const s = 1 - SWAP_FEE
  let collateral = 1 // normalized
  let debt = 0

  for (let i = 0; i < loops; i++) {
    const availableBorrows = collateral * AAVE_WETH_LTV - debt
    const borrowed = availableBorrows * BORROW_FRACTION
    const wethReceived = borrowed * s // swap USDC→WETH (same USD value, just fee)
    collateral += wethReceived
    debt += borrowed
  }

  return collateral // leverage = totalCollateral / equity, equity = 1 (normalized)
}

/**
 * Simulate loops from an existing Aave position to project final collateral and debt.
 * This accounts for borrow using TOTAL available capacity (existing + new), not just new deposit.
 *
 * @param loops - number of new loops
 * @param newDepositUsd - new ETH deposit in USD
 * @param existCollUsd - existing Aave collateral in USD
 * @param existDebtUsd - existing Aave debt in USD
 * @param ethPriceUsd - current ETH price
 * @returns { projCollUsd, projDebtUsd, projHF }
 */
export function simulateLoopsFromState(
  loops: number,
  newDepositUsd: number,
  existCollUsd: number,
  existDebtUsd: number,
): { projCollUsd: number; projDebtUsd: number; projHF: number } {
  const s = 1 - SWAP_FEE
  let collUsd = existCollUsd
  let debtUsd = existDebtUsd

  // First supply the new ETH deposit
  collUsd += newDepositUsd

  for (let i = 0; i < loops; i++) {
    // Available borrows from the TOTAL position (this is what Aave sees)
    const availBorrowsUsd = collUsd * AAVE_WETH_LTV - debtUsd
    if (availBorrowsUsd <= 0) break
    const borrowedUsd = availBorrowsUsd * BORROW_FRACTION
    debtUsd += borrowedUsd
    // Swap USDC → WETH: get borrowedUsd worth of WETH (minus swap fee)
    const wethReceivedUsd = borrowedUsd * s
    collUsd += wethReceivedUsd // supply WETH back to Aave
  }

  const projHF = debtUsd > 0 ? (collUsd * LIQ_THRESHOLD) / debtUsd : Infinity
  return { projCollUsd: collUsd, projDebtUsd: debtUsd, projHF }
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
  const s = 1 - SWAP_FEE
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
