import { createConfig, http } from 'wagmi'
import { base, arbitrum, optimism, polygon, mainnet } from 'wagmi/chains'
import { injected, coinbaseWallet } from 'wagmi/connectors'

function rpc(envKey: string) {
  const url = import.meta.env[envKey]
  return url ? http(url) : http()
}

export const wagmiConfig = createConfig({
  chains: [base, arbitrum, optimism, polygon, mainnet],
  connectors: [
    injected(),
    coinbaseWallet({ appName: 'Leverage Loop Demo' }),
  ],
  transports: {
    [base.id]: rpc('VITE_RPC_BASE'),
    [arbitrum.id]: rpc('VITE_RPC_ARBITRUM'),
    [optimism.id]: rpc('VITE_RPC_OPTIMISM'),
    [polygon.id]: rpc('VITE_RPC_POLYGON'),
    [mainnet.id]: rpc('VITE_RPC_MAINNET'),
  },
})
