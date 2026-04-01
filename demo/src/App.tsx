import { useState } from 'react'
import { useAccount, useChainId, useChains } from 'wagmi'
import { formatEther, parseEther } from 'viem'
import { Header } from './components/Header'
import { AccountPanel } from './components/AccountPanel'
import { LeverageForm } from './components/LeverageForm'
import { PositionPreview } from './components/PositionPreview'
import { FlowDiagram } from './components/FlowDiagram'
import { ExecuteButton } from './components/ExecuteButton'
import { TxStatus } from './components/TxStatus'
import { Positions } from './components/Positions'
import { useNexusAccount } from './hooks/useNexusAccount'
import { useSmartAccountBalances } from './hooks/useBalances'
import { useAaveAccountData } from './hooks/useAaveData'
import { useLeverageLoop } from './hooks/useLeverageLoop'
import { useUnwind } from './hooks/useUnwind'
import { useEthPrice } from './hooks/useEthPrice'
import { getChainConfig } from './config/chains'
import { leverageAfterLoops, unwindIterationsNeeded } from './lib/leverage-math'

type Tab = 'trade' | 'positions'

export function App() {
  const { isConnected } = useAccount()
  const chainId = useChainId()
  const chain = getChainConfig(chainId)

  const chains = useChains()
  const nativeSymbol = chains.find(c => c.id === chainId)?.nativeCurrency?.symbol ?? 'ETH'

  const { account, meeClient, smartAccountAddress, isLoading: accountLoading } = useNexusAccount()

  const balances = useSmartAccountBalances(
    smartAccountAddress,
    chain?.weth ?? '0x0000000000000000000000000000000000000000',
    chain?.usdc ?? '0x0000000000000000000000000000000000000000',
    chainId,
  )

  const aaveData = useAaveAccountData(
    chain?.aavePool ?? '0x0000000000000000000000000000000000000000',
    smartAccountAddress,
    chainId,
  )

  const { state: txState, execute, reset } = useLeverageLoop()
  const { state: unwindState, execute: executeUnwind, reset: resetUnwind } = useUnwind()

  const [tab, setTab] = useState<Tab>('trade')
  const [loops, setLoops] = useState(3)
  const [leverage, setLeverage] = useState(leverageAfterLoops(3))
  const [amountStr, setAmountStr] = useState('')

  const maxEth = Number(formatEther(balances.ethBalance))
  const inputAmount = amountStr === '' ? 0 : parseFloat(amountStr)
  const useMax = amountStr === '' || inputAmount >= maxEth

  const ethPrice = useEthPrice(chain?.aaveLens, chain?.aavePool, chain?.weth, chainId)

  const isWorking = ['building', 'quoting', 'signing', 'executing'].includes(txState.status)
  const canExecute = isConnected && account && meeClient && chain && inputAmount > 0.0001 && !isWorking

  async function handleExecute() {
    if (!account || !meeClient || !chain) return
    reset()
    const amount = useMax ? undefined : parseEther(amountStr)
    await execute(account, meeClient, chain, loops, 80, amount, balances.usdcBalance)
    balances.refetch()
  }

  return (
    <div className="min-h-screen bg-surface text-text">
      <Header />

      <main className="max-w-3xl mx-auto px-6 py-8">
        {!isConnected && (
          <p className="text-center text-text-secondary py-24">Connect a wallet to get started</p>
        )}

        {isConnected && !chain && (
          <p className="text-center text-danger py-12">
            Switch to Base, Arbitrum, Optimism, Polygon, or Ethereum
          </p>
        )}

        {isConnected && chain && accountLoading && (
          <div className="text-center py-20">
            <span className="inline-block w-5 h-5 border-2 border-accent/20 border-t-accent rounded-full animate-spin" />
            <p className="text-sm text-text-tertiary mt-3">Initializing account...</p>
          </div>
        )}

        {isConnected && chain && !accountLoading && smartAccountAddress && (
          <div className="space-y-4">
            <AccountPanel
              smartAccountAddress={smartAccountAddress}
              ethBalance={balances.ethBalance}
              nativeSymbol={nativeSymbol}
            />

            {/* Tabs — only show when funded */}
            {balances.ethBalance === 0n ? null : (<>
            {/* Tabs */}
            <div className="flex gap-0 border-b border-border-dim">
              <TabBtn active={tab === 'trade'} onClick={() => setTab('trade')}>Long ETH</TabBtn>
              <TabBtn active={tab === 'positions'} onClick={() => setTab('positions')}>
                Positions{aaveData.hasPosition ? ' (1)' : ''}
              </TabBtn>
            </div>

            {tab === 'trade' && (
              <div className="border border-border-dim rounded-lg p-5 space-y-5">
                {/* Amount input */}
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-text-secondary">Amount</span>
                    {maxEth > 0 && (
                      <button
                        onClick={() => setAmountStr(maxEth.toFixed(6))}
                        className="text-sm text-accent hover:underline transition"
                        disabled={isWorking}
                      >
                        Balance: {maxEth.toFixed(4)} ETH
                      </button>
                    )}
                  </div>
                  <div className="flex items-center border border-border rounded-lg overflow-hidden focus-within:border-accent/50 transition">
                    <input
                      type="number"
                      step="0.001"
                      min="0"
                      max={maxEth}
                      value={amountStr}
                      onChange={e => setAmountStr(e.target.value)}
                      placeholder="0.0"
                      disabled={isWorking}
                      className="flex-1 bg-transparent px-4 py-2.5 font-mono outline-none placeholder:text-text-tertiary"
                    />
                    <span className="px-4 text-sm text-text-tertiary">ETH</span>
                  </div>
                </div>

                <LeverageForm
                  leverage={leverage}
                  loops={loops}
                  onLeverageChange={(lev, l) => { setLeverage(lev); setLoops(l) }}
                  disabled={isWorking}
                />

                {inputAmount > 0 && (
                  <>
                    <div className="border-t border-border-dim" />
                    <PositionPreview
                      ethAmount={inputAmount}
                      loops={loops}
                      ethPrice={ethPrice}
                      leverage={leverage}
                      existingCollateralBase={aaveData.totalCollateralBase}
                      existingDebtBase={aaveData.totalDebtBase}
                    />
                  </>
                )}

                <FlowDiagram loops={loops} />

                <ExecuteButton
                  status={txState.status}
                  disabled={!canExecute}
                  onClick={handleExecute}
                />

                <TxStatus
                  status={txState.status}
                  hash={txState.status === 'success' ? txState.hash : undefined}
                  txHash={txState.status === 'success' ? txState.txHash : undefined}
                  explorerUrl={chain.explorerUrl}
                  error={txState.status === 'error' ? txState.message : undefined}
                />
              </div>
            )}

            {tab === 'positions' && (
              <>
                <Positions
                  hasPosition={aaveData.hasPosition}
                  totalCollateralBase={aaveData.totalCollateralBase}
                  totalDebtBase={aaveData.totalDebtBase}
                  healthFactor={aaveData.healthFactor}
                  isLoading={aaveData.isLoading}
                  onClose={account && meeClient && chain ? async () => {
                    resetUnwind()
                    // Compute exact iterations from actual leverage via convergence simulation
                    const collUsd = Number(aaveData.totalCollateralBase) / 1e8
                    const debtUsd = Number(aaveData.totalDebtBase) / 1e8
                    const netUsd = collUsd - debtUsd
                    const lev = netUsd > 0 ? collUsd / netUsd : 1
                    const iterations = unwindIterationsNeeded(lev)
                    await executeUnwind(account, meeClient, chain, iterations)
                    balances.refetch()
                  } : undefined}
                  isClosing={['building', 'quoting', 'signing', 'executing'].includes(unwindState.status)}
                  closeStatus={unwindState.status}
                />
                <TxStatus
                  status={unwindState.status}
                  hash={unwindState.status === 'success' ? unwindState.hash : undefined}
                  txHash={unwindState.status === 'success' ? unwindState.txHash : undefined}
                  explorerUrl={chain.explorerUrl}
                  error={unwindState.status === 'error' ? unwindState.message : undefined}
                  successLabel="Position closed"
                />
              </>
            )}
            </>)}
          </div>
        )}
      </main>

      <footer className="max-w-3xl mx-auto px-6 pb-8">
        <p className="text-xs text-text-tertiary text-center leading-relaxed">
          Experimental demo — use at your own risk with small amounts only.
          This app interacts with real DeFi protocols on mainnet. Not audited.
        </p>
      </footer>
    </div>
  )
}

function TabBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-2.5 transition ${
        active
          ? 'text-text border-b-2 border-accent -mb-px'
          : 'text-text-tertiary hover:text-text-secondary'
      }`}
    >
      {children}
    </button>
  )
}
