import { createConfig, http } from 'wagmi'
import { base, arbitrum, optimism, mainnet } from 'wagmi/chains'
import { injected, coinbaseWallet } from 'wagmi/connectors'

function rpc(chainId: number) {
  // In production, RPC requests are proxied through /api/rpc to keep URLs server-side.
  // Falls back to default public RPCs if no proxy is available (local dev without Vercel).
  return http(`/api/rpc?chainId=${chainId}`)
}

export const wagmiConfig = createConfig({
  chains: [base, arbitrum, optimism, mainnet],
  connectors: [
    injected(),
    coinbaseWallet({ appName: 'Leverage Loop Demo' }),
  ],
  transports: {
    [base.id]: rpc(base.id),
    [arbitrum.id]: rpc(arbitrum.id),
    [optimism.id]: rpc(optimism.id),
    [mainnet.id]: rpc(mainnet.id),
  },
})
