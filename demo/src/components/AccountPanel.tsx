import { useState, useEffect, useRef } from 'react'

type Props = {
  smartAccountAddress: string
  ethBalance: bigint
  nativeSymbol: string
}

const SEEN_KEY = 'accountPanel:funded'

export function AccountPanel({ smartAccountAddress, ethBalance, nativeSymbol }: Props) {
  const [copied, setCopied] = useState(false)
  const hasBalance = ethBalance > 0n
  const [justLanded, setJustLanded] = useState(false)

  // Track: have we seen a confirmed zero balance (not just the initial default)?
  // On first render ethBalance is 0n because the query hasn't loaded yet.
  // We only start watching for deposits after we've seen a real zero balance
  // followed by a subsequent update.
  const seenZeroAfterInit = useRef(false)
  const updateCount = useRef(0)

  function copyAddress() {
    navigator.clipboard.writeText(smartAccountAddress)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  useEffect(() => {
    updateCount.current++
    // Skip the first update (default 0n before query returns)
    if (updateCount.current <= 1) return
    // After the first real query result, if it's zero, mark as waiting
    if (ethBalance === 0n) {
      seenZeroAfterInit.current = true
    }
  }, [ethBalance])

  useEffect(() => {
    if (!hasBalance) return
    const alreadySeen = localStorage.getItem(`${SEEN_KEY}:${smartAccountAddress}`)
    if (alreadySeen) return
    if (seenZeroAfterInit.current) {
      setJustLanded(true)
      const t = setTimeout(() => setJustLanded(false), 2500)
      localStorage.setItem(`${SEEN_KEY}:${smartAccountAddress}`, '1')
      return () => clearTimeout(t)
    }
    // Already had balance on first load — mark as seen, no animation
    localStorage.setItem(`${SEEN_KEY}:${smartAccountAddress}`, '1')
  }, [hasBalance, smartAccountAddress])

  if (!hasBalance) {
    return (
      <div className="bg-surface-raised border border-border-dim rounded-lg px-5 py-6 text-center space-y-4">
        <p className="text-text-secondary">
          Deposit {nativeSymbol} to your smart account to get started
        </p>
        <button
          onClick={copyAddress}
          className="font-mono text-sm text-accent hover:text-accent-dim transition break-all"
        >
          {smartAccountAddress}
        </button>
        <p className="text-sm text-text-tertiary">{copied ? 'Copied!' : 'Click to copy'}</p>
        <div className="flex items-center justify-center gap-2 pt-2 text-sm text-text-tertiary">
          <span className="inline-block w-3.5 h-3.5 border-2 border-accent/20 border-t-accent rounded-full animate-spin" />
          Waiting for deposit...
        </div>
      </div>
    )
  }

  return (
    <div className={`bg-surface-raised border rounded-lg px-4 py-3 transition-all duration-700 ${
      justLanded
        ? 'border-accent/40 bg-accent/[0.03] shadow-[0_0_15px_rgba(37,99,235,0.08)]'
        : 'border-border-dim'
    }`}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm text-text-tertiary shrink-0">Smart Account</span>
        <button
          onClick={copyAddress}
          className="flex items-center gap-1.5 font-mono text-sm text-text-secondary hover:text-text transition truncate min-w-0"
          title={smartAccountAddress}
        >
          <span className="truncate">{smartAccountAddress}</span>
          <span className="text-text-tertiary shrink-0">{copied ? 'copied' : 'copy'}</span>
        </button>
      </div>
      {justLanded && (
        <p className="text-sm text-accent mt-1.5 text-center animate-pulse">
          Deposit received!
        </p>
      )}
    </div>
  )
}
