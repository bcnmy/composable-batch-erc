import { useState } from 'react'
import { unwindIterationsNeeded } from '../lib/leverage-math'

type Props = {
  hasPosition: boolean
  totalCollateralBase: bigint
  totalDebtBase: bigint
  healthFactor: bigint
  isLoading: boolean
  onClose?: () => void
  isClosing?: boolean
  closeStatus?: string
  closeFee?: string
  closeFeeValue?: string
  closeFeeLoading?: boolean
}

export function Positions({
  hasPosition, totalCollateralBase, totalDebtBase, healthFactor,
  isLoading, onClose, isClosing, closeStatus, closeFee, closeFeeValue, closeFeeLoading,
}: Props) {
  const [showSteps, setShowSteps] = useState(false)

  if (isLoading) {
    return <p className="text-sm text-text-tertiary text-center py-8">Loading positions...</p>
  }

  if (!hasPosition) {
    return <p className="text-sm text-text-tertiary text-center py-8">No active positions on this chain.</p>
  }

  const collateralUsd = Number(totalCollateralBase) / 1e8
  const debtUsd = Number(totalDebtBase) / 1e8
  const hf = Number(healthFactor) / 1e18
  const netUsd = collateralUsd - debtUsd
  const leverage = netUsd > 0 ? collateralUsd / netUsd : 0
  const iterations = unwindIterationsNeeded(leverage)

  return (
    <div className="space-y-3">
      <div className="bg-surface-raised border border-border-dim rounded-lg p-4 space-y-4">
        {/* Position header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-base font-medium">ETH Long</span>
            <span className="text-xs px-1.5 py-0.5 rounded bg-accent/10 text-accent font-mono">
              {leverage.toFixed(1)}x
            </span>
          </div>
          <span className={`text-sm font-mono ${netUsd >= 0 ? 'text-success' : 'text-danger'}`}>
            ${netUsd.toLocaleString(undefined, { maximumFractionDigits: 2 })}
          </span>
        </div>

        {/* Visual bar: collateral vs debt */}
        <div className="space-y-1">
          <div className="h-2 rounded-full bg-border-dim overflow-hidden">
            <div
              className="h-full bg-accent rounded-full"
              style={{ width: `${Math.min(100, (netUsd / collateralUsd) * 100)}%` }}
            />
          </div>
          <div className="flex justify-between text-sm text-text-tertiary">
            <span>Equity ${netUsd.toFixed(2)}</span>
            <span>Borrowed ${debtUsd.toFixed(2)}</span>
          </div>
        </div>

        {/* Key metrics */}
        <div className="grid grid-cols-2 gap-y-2 gap-x-8 text-sm">
          <span className="text-text-tertiary">Collateral (WETH)</span>
          <span className="text-right font-mono">${collateralUsd.toFixed(2)}</span>

          <span className="text-text-tertiary">Debt (USDC)</span>
          <span className="text-right font-mono">${debtUsd.toFixed(2)}</span>

          <span className="text-text-tertiary">Health factor</span>
          <span className={`text-right font-mono ${hf < 1.5 ? 'text-danger' : hf < 2 ? 'text-warning' : 'text-success'}`}>
            {hf.toFixed(2)}
          </span>
        </div>

        {/* Explainer */}
        <p className="text-sm text-text-tertiary leading-relaxed">
          Your ETH is supplied as collateral on Aave. USDC was borrowed and swapped back to ETH
          to amplify your position. You profit when ETH goes up, but get liquidated if health factor drops below 1.
        </p>
      </div>

      {/* Close position steps */}
      <div className="border border-border-dim rounded-lg overflow-hidden">
        <button
          onClick={() => setShowSteps(!showSteps)}
          className="flex items-center justify-between w-full px-4 py-3 text-sm text-text-secondary hover:text-text hover:bg-surface-alt/50 transition"
        >
          <span>Close position — {iterations * 5 + 4} steps, 1 signature</span>
          <span className={`transition-transform ${showSteps ? 'rotate-180' : ''}`}>&#9662;</span>
        </button>

        {showSteps && (
          <div className="border-t border-border-dim p-4 space-y-2 text-sm">
            {Array.from({ length: iterations }, (_, i) => (
              <div key={i} className="border-l-2 border-danger/20 pl-3 ml-1 space-y-1.5 py-1">
                <p className="text-xs text-danger/60 font-medium uppercase tracking-wider">Unwind {i + 1}</p>
                <StepRow label="Withdraw safe WETH from Aave" detail="Amount computed via AaveLens oracle" />
                <StepRow label="Swap WETH to USDC" detail="Full WETH balance via Uniswap" />
                <StepRow label="Repay USDC debt" detail="Aave caps at remaining debt" />
              </div>
            ))}

            <StepRow label="Withdraw remaining WETH" detail="Pull final collateral from Aave" />
            <StepRow label="Swap leftover USDC to WETH" detail="Convert excess from last repay" />
            <StepRow label="Unwrap WETH to ETH" detail="Native ETH returned to your account" highlight />

            <p className="text-sm text-text-tertiary pt-1">
              Approvals are included but omitted above for clarity.
              All amounts resolved at execution time from on-chain state.
            </p>
          </div>
        )}
      </div>

      {/* Close fee estimate */}
      {onClose && (closeFee || closeFeeLoading) && (
        <div className="flex items-center justify-between text-sm text-text-tertiary px-1">
          <span>Estimated close fee</span>
          <span className="font-mono">
            {closeFeeLoading
              ? <span className="flex items-center gap-1.5">
                  <span className="inline-block w-3 h-3 border-2 border-text-tertiary/20 border-t-text-tertiary rounded-full animate-spin" />
                  estimating...
                </span>
              : <>{closeFee} ETH{closeFeeValue && <span className="text-text-tertiary ml-1">(${closeFeeValue})</span>}</>
            }
          </span>
        </div>
      )}

      {/* Close button */}
      {onClose && (
        <button
          onClick={onClose}
          disabled={isClosing}
          className={`w-full py-2.5 rounded-lg text-sm font-medium transition ${
            isClosing
              ? 'bg-surface-secondary text-text-tertiary cursor-wait'
              : 'bg-danger/[0.06] text-danger hover:bg-danger/10 border border-danger/15'
          }`}
        >
          {isClosing
            ? closeStatus === 'building' ? 'Building unwind...'
            : closeStatus === 'quoting' ? 'Getting quote...'
            : closeStatus === 'signing' ? 'Sign in wallet...'
            : closeStatus === 'executing' ? 'Closing position...'
            : 'Processing...'
            : 'Close Position — Withdraw ETH'}
        </button>
      )}
    </div>
  )
}

function StepRow({ label, detail, highlight }: { label: string; detail: string; highlight?: boolean }) {
  return (
    <div className="flex items-start gap-2">
      <span className="text-text-tertiary mt-1">&#8226;</span>
      <div>
        <p className={highlight ? 'text-success' : 'text-text-secondary'}>{label}</p>
        <p className="text-text-tertiary text-xs">{detail}</p>
      </div>
    </div>
  )
}
