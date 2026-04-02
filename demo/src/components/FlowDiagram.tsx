import { useState } from 'react'
import { safetyGuardHF } from '../lib/leverage-math'

type Props = { loops: number }

const CODE_EXAMPLE = `const batch = composableBatch({ account, chainId: 8453 })

// Wrap all native ETH
batch.wrap(eth.balance())

for (let i = 0; i < loops; i++) {
  // Supply WETH as collateral
  batch.approve(weth, AAVE_POOL, weth.balance())
  batch.add(aave, 'supply', [
    WETH, weth.balance().gte(1n), account, 0
  ])

  // Borrow USDC — amount computed on-chain via lens
  batch.add(aave, 'borrow', [
    USDC,
    lens.read('getSafeBorrowAmount', [...]).gte(1n),
    2n, 0, account,
  ])

  // Swap USDC back to WETH
  batch.approve(usdc, SWAP_ROUTER, usdc.balance())
  batch.add(router, 'exactInputSingle', [{
    tokenIn: USDC, tokenOut: WETH,
    amountIn: usdc.balance(), ...
  }])
}

// Final deposit + safety guard
batch.approve(weth, AAVE_POOL, weth.balance())
batch.add(aave, 'supply', [WETH, weth.balance(), ...])
batch.check(
  lens.read('getHealthFactor', [...]).gte(minHF)
)`

export function FlowDiagram({ loops }: Props) {
  const [open, setOpen] = useState(false)
  const stepCount = 1 + loops * 5 + 3

  return (
    <div className="border border-border-dim rounded-lg overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center justify-between w-full px-4 py-3 text-sm text-text-secondary hover:text-text hover:bg-surface-alt/50 transition"
      >
        <span>How this works — {stepCount} on-chain steps, 1 signature</span>
        <span className={`transition-transform ${open ? 'rotate-180' : ''}`}>&#9662;</span>
      </button>

      {open && (
        <div className="border-t border-border-dim">
          <div className="grid grid-cols-1 lg:grid-cols-2 divide-y lg:divide-y-0 lg:divide-x divide-border-dim">
            {/* Steps */}
            <div className="p-4 space-y-2 text-sm">
              <p className="text-xs text-text-tertiary uppercase tracking-wider font-medium mb-3">Batch steps</p>
              <StepRow n={1} label="Wrap ETH to WETH" detail="Uses full deposited amount" />

              {Array.from({ length: loops }, (_, i) => {
                const base = 2 + i * 5
                return (
                  <div key={i} className="border-l-2 border-accent/20 pl-3 ml-1 space-y-1.5 py-1">
                    <p className="text-xs text-accent/60 font-medium uppercase tracking-wider">Iteration {i + 1}</p>
                    <StepRow n={base} label="Supply WETH to Aave" detail="Runtime balance — dustless" />
                    <StepRow n={base + 1} label="Borrow USDC" detail="Amount computed on-chain via AaveLens" highlight />
                    <StepRow n={base + 2} label="Swap USDC to WETH" detail="Full USDC balance via Uniswap" />
                  </div>
                )
              })}

              <StepRow n={stepCount - 1} label="Supply remaining WETH" detail="Final deposit to Aave" />
              <StepRow n={stepCount} label={`Health factor >= ${safetyGuardHF(loops).toFixed(2)}`} detail="Reverts entire batch if not met" guard />

              <p className="text-sm text-text-tertiary pt-1">
                Approvals are included but omitted above for clarity.
                Every amount is resolved at execution time from on-chain state.
              </p>
            </div>

            {/* Code example */}
            <div className="p-4">
              <p className="text-xs text-text-tertiary uppercase tracking-wider font-medium mb-3">
                ERC-8211 SDK (pseudocode)
              </p>
              <pre className="text-xs font-mono text-text-secondary bg-surface-secondary border border-border-dim rounded-lg p-3 overflow-x-auto leading-relaxed max-h-[420px] overflow-y-auto">
                {CODE_EXAMPLE}
              </pre>
              <p className="text-sm text-text-tertiary mt-2">
                No custom Solidity. No flash loans. Just a composable batch with runtime parameters.{' '}
                <a
                  href="https://github.com/bcnmy/composable-batch-erc/tree/feat/sdk-spec/sdk/examples"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-accent hover:underline"
                >
                  More ERC-8211 examples &#8599;
                </a>
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function StepRow({ n, label, detail, highlight, guard }: {
  n: number; label: string; detail: string; highlight?: boolean; guard?: boolean
}) {
  return (
    <div className="flex items-start gap-2">
      <span className={`text-xs font-mono w-4 shrink-0 mt-0.5 ${guard ? 'text-success' : 'text-text-tertiary'}`}>
        {n}
      </span>
      <div>
        <p className={`text-sm ${guard ? 'text-success' : highlight ? 'text-accent' : 'text-text-secondary'}`}>
          {label}
        </p>
        <p className="text-text-tertiary text-xs">{detail}</p>
      </div>
    </div>
  )
}
