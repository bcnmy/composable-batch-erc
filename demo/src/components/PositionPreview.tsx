import { estimatePosition, safetyGuardHF, liquidationPrice, maxDrawdown } from '../lib/leverage-math'

type Props = {
  ethAmount: number
  loops: number
  ethPrice: number
  leverage: number
  /** Existing Aave position in 8-decimal USD base (0 if none) */
  existingCollateralBase?: bigint
  existingDebtBase?: bigint
}

export function PositionPreview({
  ethAmount, loops, ethPrice, leverage,
  existingCollateralBase = 0n, existingDebtBase = 0n,
}: Props) {
  if (ethAmount <= 0 || ethPrice <= 0) return null

  const pos = estimatePosition(ethAmount, loops, ethPrice)
  const inputUsd = ethAmount * ethPrice

  const existingCollUsd = Number(existingCollateralBase) / 1e8
  const existingDebtUsd = Number(existingDebtBase) / 1e8
  const hasExisting = existingCollUsd > 0

  // Projected totals (existing + new)
  const totalCollUsd = existingCollUsd + pos.totalCollateralEth * ethPrice
  const totalDebtUsd = existingDebtUsd + pos.totalDebtUsd
  const totalNetUsd = totalCollUsd - totalDebtUsd
  const totalLeverage = totalNetUsd > 0 ? totalCollUsd / totalNetUsd : 0

  // Use total leverage for liq price and PnL when there's an existing position
  const effectiveLeverage = hasExisting ? totalLeverage : leverage
  const liqPrice = liquidationPrice(ethPrice, effectiveLeverage)
  const dropPct = maxDrawdown(effectiveLeverage)
  const totalEquityUsd = hasExisting ? totalNetUsd : inputUsd

  return (
    <div className="space-y-4">
      {/* Position summary */}
      <div className="grid grid-cols-2 gap-y-2.5 gap-x-8">
        <span className="text-text-tertiary">Leverage</span>
        <span className="text-right font-mono">{leverage.toFixed(1)}x</span>

        <span className="text-text-tertiary">Position size</span>
        <span className="text-right font-mono">{pos.totalCollateralEth} ETH</span>

        <span className="text-text-tertiary">Borrowed</span>
        <span className="text-right font-mono">${pos.totalDebtUsd.toLocaleString()}</span>

        {hasExisting && (
          <>
            <span className="text-text-tertiary col-span-2 border-t border-border-dim pt-2 text-sm">
              Projected total (existing + new)
            </span>

            <span className="text-text-tertiary">Total collateral</span>
            <span className="text-right font-mono">${totalCollUsd.toFixed(2)}</span>

            <span className="text-text-tertiary">Total debt</span>
            <span className="text-right font-mono">${totalDebtUsd.toFixed(2)}</span>

            <span className="text-text-tertiary">Effective leverage</span>
            <span className="text-right font-mono">{totalLeverage.toFixed(1)}x</span>
          </>
        )}

        <span className="text-text-tertiary">Liquidation price</span>
        <span className="text-right font-mono text-danger">
          ${liqPrice.toLocaleString()}
          <span className="text-text-tertiary ml-1 text-sm">{dropPct.toFixed(0)}% away</span>
        </span>
      </div>

      {/* Slippage protection banner */}
      <div className="flex items-start gap-2.5 bg-success/5 border border-success/15 rounded-lg px-3.5 py-2.5">
        <span className="text-success mt-0.5">&#10003;</span>
        <div>
          <p className="text-sm text-success font-medium">Slippage protected</p>
          <p className="text-sm text-text-tertiary mt-0.5">
            On-chain health factor guard at {safetyGuardHF(loops).toFixed(2)} minimum.
            If price moves between signing and execution, the entire batch reverts atomically.
          </p>
        </div>
      </div>

      {/* PnL scenarios table */}
      <div>
        <p className="text-sm text-text-tertiary mb-2">
          If ETH price changes {hasExisting && '(total position)'}
        </p>
        <div className="grid grid-cols-5 text-center border border-border-dim rounded-lg overflow-hidden">
          {[
            { move: -20, label: '-20%' },
            { move: -10, label: '-10%' },
            { move: 10, label: '+10%' },
            { move: 25, label: '+25%' },
            { move: 50, label: '+50%' },
          ].map(({ move, label }) => {
            const pnlUsd = totalEquityUsd * effectiveLeverage * (move / 100)
            const isNeg = move < 0
            return (
              <div key={move} className={`py-2.5 ${isNeg ? 'bg-danger/5' : 'bg-success/5'}`}>
                <p className="text-text-tertiary text-sm">{label}</p>
                <p className={`font-mono font-medium mt-0.5 ${isNeg ? 'text-danger' : 'text-success'}`}>
                  {pnlUsd >= 0 ? '+' : ''}${Math.round(pnlUsd).toLocaleString()}
                </p>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
