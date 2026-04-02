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
import { useWithdraw } from './hooks/useWithdraw'
import { useEthPrice } from './hooks/useEthPrice'
import { useFeeEstimate } from './hooks/useFeeEstimate'
import { useCloseFeeEstimate } from './hooks/useCloseFeeEstimate'
import { getChainConfig } from './config/chains'
import { leverageAfterLoops, unwindIterationsNeeded } from './lib/leverage-math'

type Tab = 'trade' | 'positions' | 'withdraw'

export function App() {
  const { isConnected, address: eoaAddress } = useAccount()
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
  const { state: withdrawState, execute: executeWithdraw, reset: resetWithdraw } = useWithdraw()

  const [tab, setTab] = useState<Tab>('trade')
  const [loops, setLoops] = useState(3)
  const [leverage, setLeverage] = useState(leverageAfterLoops(3))
  const [amountStr, setAmountStr] = useState('')
  const [withdrawStr, setWithdrawStr] = useState('')
  const [withdrawIsMax, setWithdrawIsMax] = useState(false)

  const ethPrice = useEthPrice(chain?.aaveLens, chain?.aavePool, chain?.weth, chainId)

  // Consider account empty if balance < $0.01 — not enough to loop or withdraw
  const maxEth = Number(formatEther(balances.ethBalance))
  const balanceUsd = maxEth * (ethPrice || 0)
  const hasUsableBalance = balanceUsd >= 0.05

  // Reserve ETH for gas so close-position can pay fees (all collateral is locked in Aave,
  // aWETH transfers fail with open debt, so close must pay in native ETH).
  const GAS_RESERVE = parseEther('0.0005')
  const availableEth = balances.ethBalance > GAS_RESERVE ? balances.ethBalance - GAS_RESERVE : 0n
  const maxUsableEth = Number(formatEther(availableEth))
  const inputAmount = amountStr === '' ? 0 : parseFloat(amountStr)
  const useMax = amountStr === '' || inputAmount >= maxUsableEth

  const feeEstimate = useFeeEstimate(account, meeClient, chain, loops, inputAmount, balances.usdcBalance, aaveData.totalCollateralBase, aaveData.totalDebtBase, ethPrice)

  // Compute close-position iterations from current leverage
  const currentCollUsd = Number(aaveData.totalCollateralBase) / 1e8
  const currentDebtUsd = Number(aaveData.totalDebtBase) / 1e8
  const currentNetUsd = currentCollUsd - currentDebtUsd
  const currentLeverage = currentNetUsd > 0 ? currentCollUsd / currentNetUsd : 1
  const closeIterations = unwindIterationsNeeded(currentLeverage)

  const closeFeeEstimate = useCloseFeeEstimate(account, meeClient, chain, closeIterations, aaveData.hasPosition)

  const isWorking = ['building', 'quoting', 'signing', 'executing'].includes(txState.status)
  const canExecute = isConnected && account && meeClient && chain && inputAmount > 0.0001 && !isWorking && hasUsableBalance && availableEth > 0n

  async function handleExecute() {
    if (!account || !meeClient || !chain) return
    reset()
    const amount = useMax ? availableEth : parseEther(amountStr)
    await execute(account, meeClient, chain, loops, 80, amount, balances.usdcBalance, aaveData.totalCollateralBase, aaveData.totalDebtBase, ethPrice)
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

            {/* Tabs */}
            <div className="flex gap-0 border-b border-border-dim">
              <TabBtn active={tab === 'trade'} onClick={() => setTab('trade')}>Loop ETH</TabBtn>
              <TabBtn active={tab === 'positions'} onClick={() => setTab('positions')}>
                Positions{aaveData.hasPosition ? ' (1)' : ''}
              </TabBtn>
              {hasUsableBalance && (
                <TabBtn active={tab === 'withdraw'} onClick={() => setTab('withdraw')}>
                  Withdraw ETH
                </TabBtn>
              )}
            </div>

            {tab === 'trade' && (
              <div className="bg-surface-raised border border-border-dim rounded-lg p-5 space-y-5">
                {!hasUsableBalance && balances.ethBalance > 0n && (
                  <p className="text-sm text-text-tertiary text-center py-4">
                    Balance too low to open a position. Deposit more ETH to your smart account.
                  </p>
                )}

                {/* Amount input */}
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-text-secondary">Amount</span>
                    {hasUsableBalance && maxEth > 0 && (
                      <button
                        onClick={() => setAmountStr(maxUsableEth > 0 ? maxUsableEth.toFixed(6) : maxEth.toFixed(6))}
                        className="text-sm text-accent hover:underline transition"
                        disabled={isWorking}
                      >
                        Balance: {maxEth.toFixed(4)} ETH{ethPrice > 0 && ` ($${(maxEth * ethPrice).toFixed(2)})`}
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

                {feeEstimate.tokenAmount && (
                  <div className="flex items-center justify-between text-sm text-text-tertiary">
                    <span>Estimated fee</span>
                    <span className="font-mono">
                      {feeEstimate.isLoading ? '...' : (
                        <>{feeEstimate.tokenAmount} {feeEstimate.tokenSymbol}{feeEstimate.tokenValue && <span className="text-text-tertiary ml-1">(${feeEstimate.tokenValue})</span>}</>
                      )}
                    </span>
                  </div>
                )}
                {feeEstimate.isLoading && !feeEstimate.tokenAmount && inputAmount > 0.0001 && (
                  <div className="flex items-center justify-between text-sm text-text-tertiary">
                    <span>Estimated fee</span>
                    <span className="flex items-center gap-1.5">
                      <span className="inline-block w-3 h-3 border-2 border-text-tertiary/20 border-t-text-tertiary rounded-full animate-spin" />
                      estimating...
                    </span>
                  </div>
                )}

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
                    await executeUnwind(account, meeClient, chain, closeIterations)
                    balances.refetch()
                  } : undefined}
                  isClosing={['building', 'quoting', 'signing', 'executing'].includes(unwindState.status)}
                  closeStatus={unwindState.status}
                  closeFee={closeFeeEstimate.tokenAmount}
                  closeFeeValue={closeFeeEstimate.tokenValue}
                  closeFeeLoading={closeFeeEstimate.isLoading}
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
            {tab === 'withdraw' && (() => {
              const withdrawAmount = withdrawStr === '' ? 0 : parseFloat(withdrawStr)
              const withdrawMax = withdrawIsMax || withdrawStr === '' || withdrawAmount >= maxEth * 0.999
              const isWithdrawWorking = ['building', 'quoting', 'signing', 'executing'].includes(withdrawState.status)
              const canWithdraw = isConnected && account && meeClient && chain && eoaAddress && withdrawAmount > 0 && !isWithdrawWorking

              return (
                <div className="bg-surface-raised border border-border-dim rounded-lg p-5 space-y-5">
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-text-secondary">Withdraw to wallet</span>
                      {maxEth > 0 && (
                        <button
                          onClick={() => { setWithdrawStr(maxEth.toFixed(6)); setWithdrawIsMax(true) }}
                          className="text-sm text-accent hover:underline transition"
                          disabled={isWithdrawWorking}
                        >
                          Balance: {maxEth.toFixed(4)} ETH{ethPrice > 0 && ` ($${(maxEth * ethPrice).toFixed(2)})`}
                        </button>
                      )}
                    </div>
                    <div className="flex items-center border border-border rounded-lg overflow-hidden focus-within:border-accent/50 transition">
                      <input
                        type="number"
                        step="0.001"
                        min="0"
                        max={maxEth}
                        value={withdrawStr}
                        onChange={e => { setWithdrawStr(e.target.value); setWithdrawIsMax(false) }}
                        placeholder="0.0"
                        disabled={isWithdrawWorking}
                        className="flex-1 bg-transparent px-4 py-2.5 font-mono outline-none placeholder:text-text-tertiary"
                      />
                      <span className="px-4 text-sm text-text-tertiary">ETH</span>
                    </div>
                  </div>

                  {withdrawAmount > 0 && eoaAddress && (
                    <div className="text-sm text-text-tertiary">
                      <span>Sending to </span>
                      <span className="font-mono text-text-secondary">{eoaAddress.slice(0, 6)}...{eoaAddress.slice(-4)}</span>
                    </div>
                  )}

                  <button
                    onClick={async () => {
                      if (!account || !meeClient || !chain || !eoaAddress) return
                      resetWithdraw()
                      const amount = withdrawMax ? undefined : parseEther(withdrawStr)
                      await executeWithdraw(account, meeClient, chain, eoaAddress, amount, withdrawMax)
                      balances.refetch()
                    }}
                    disabled={!canWithdraw}
                    className={`w-full py-3 rounded-lg font-medium transition ${
                      withdrawState.status === 'error'
                        ? 'bg-danger/10 text-danger border border-danger/20 hover:bg-danger/15'
                        : 'bg-accent text-white hover:bg-accent-dim disabled:opacity-40 disabled:cursor-not-allowed'
                    }`}
                  >
                    {isWithdrawWorking && (
                      <span className="inline-block w-3.5 h-3.5 border-2 border-white/20 border-t-white rounded-full animate-spin mr-2 align-middle" />
                    )}
                    {withdrawState.status === 'building' ? 'Building...'
                      : withdrawState.status === 'quoting' ? 'Getting quote...'
                      : withdrawState.status === 'signing' ? 'Sign in wallet...'
                      : withdrawState.status === 'executing' ? 'Withdrawing...'
                      : withdrawState.status === 'error' ? 'Retry'
                      : 'Withdraw ETH'}
                  </button>

                  <TxStatus
                    status={withdrawState.status}
                    txHash={withdrawState.status === 'success' ? withdrawState.txHash : undefined}
                    explorerUrl={chain.explorerUrl}
                    error={withdrawState.status === 'error' ? withdrawState.message : undefined}
                    successLabel="ETH withdrawn to wallet"
                  />
                </div>
              )
            })()}
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
