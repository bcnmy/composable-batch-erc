import { useState, useRef, useEffect } from 'react'
import { useAccount, useConnect, useDisconnect, useChainId, useSwitchChain } from 'wagmi'

export function Header() {
  const { address, isConnected } = useAccount()
  const { connectors, connect } = useConnect()
  const { disconnect } = useDisconnect()
  const chainId = useChainId()
  const { switchChain, chains } = useSwitchChain()

  const [showWalletMenu, setShowWalletMenu] = useState(false)
  const [showChainMenu, setShowChainMenu] = useState(false)
  const [copied, setCopied] = useState(false)
  const chainRef = useRef<HTMLDivElement>(null)
  const walletRef = useRef<HTMLDivElement>(null)

  const shortAddr = address ? `${address.slice(0, 6)}...${address.slice(-4)}` : ''
  const currentChain = chains.find(c => c.id === chainId)

  function copyAddress() {
    if (!address) return
    navigator.clipboard.writeText(address)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (chainRef.current && !chainRef.current.contains(e.target as Node)) setShowChainMenu(false)
      if (walletRef.current && !walletRef.current.contains(e.target as Node)) setShowWalletMenu(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  return (
    <header className="flex items-center justify-between px-6 h-14 border-b border-border-dim bg-surface-raised">
      <span className="font-medium tracking-tight text-text-secondary">
        <span className="font-display text-text">Leverage Loop</span>
        <span className="text-text-tertiary ml-2 text-sm">ERC-8211 Smart Batching Demo</span>
      </span>

      <div className="flex items-center gap-2">
        {isConnected && (
          <div ref={chainRef} className="relative">
            <button
              onClick={() => { setShowChainMenu(!showChainMenu); setShowWalletMenu(false) }}
              className="flex items-center gap-2 border border-border-dim rounded-lg px-3 py-1.5 text-sm text-text-secondary hover:text-text hover:border-border bg-surface-raised transition"
            >
              {currentChain?.name ?? 'Unknown'}
              <span className={`text-xs transition-transform ${showChainMenu ? 'rotate-180' : ''}`}>&#9662;</span>
            </button>

            {showChainMenu && (
              <div className="absolute right-0 top-full mt-1 bg-surface-raised border border-border-dim rounded-lg shadow-sm z-50 min-w-[160px] py-1">
                {chains.map(c => (
                  <button
                    key={c.id}
                    onClick={() => { switchChain({ chainId: c.id }); setShowChainMenu(false) }}
                    className={`w-full text-left px-3 py-2 text-sm transition ${
                      c.id === chainId
                        ? 'text-accent bg-accent/5'
                        : 'text-text-secondary hover:text-text hover:bg-surface-alt'
                    }`}
                  >
                    {c.name}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {isConnected ? (
          <div ref={walletRef} className="relative">
            <button
              onClick={() => { setShowWalletMenu(!showWalletMenu); setShowChainMenu(false) }}
              className="flex items-center gap-2 border border-border-dim rounded-lg px-3 py-1.5 text-sm text-text-secondary hover:text-text hover:border-border bg-surface-raised transition"
            >
              <span className="w-1.5 h-1.5 rounded-full bg-success" />
              <span className="font-mono">{shortAddr}</span>
            </button>

            {showWalletMenu && (
              <div className="absolute right-0 top-full mt-1 bg-surface-raised border border-border-dim rounded-lg shadow-sm z-50 min-w-[160px] py-1">
                <button
                  onClick={() => { copyAddress(); setShowWalletMenu(false) }}
                  className="w-full text-left px-3 py-2 text-sm text-text-secondary hover:text-text hover:bg-surface-alt transition"
                >
                  {copied ? 'Copied!' : 'Copy address'}
                </button>
                <button
                  onClick={() => { disconnect(); setShowWalletMenu(false) }}
                  className="w-full text-left px-3 py-2 text-sm text-danger hover:bg-surface-alt transition"
                >
                  Disconnect
                </button>
              </div>
            )}
          </div>
        ) : (
          <button
            onClick={() => connect({ connector: connectors[0] })}
            className="bg-accent text-white rounded-lg px-4 py-1.5 text-sm font-medium hover:bg-accent-dim transition"
          >
            Connect Wallet
          </button>
        )}
      </div>
    </header>
  )
}
