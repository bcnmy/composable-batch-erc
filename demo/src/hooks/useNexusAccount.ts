import { useState, useEffect, useRef } from 'react'
import { useWalletClient, useChainId } from 'wagmi'
import { http } from 'viem'
import {
  toMultichainNexusAccount,
  createMeeClient,
  getMEEVersion,
  MEEVersion,
} from '@biconomy/abstractjs'
import type { MultichainSmartAccount } from '@biconomy/abstractjs'
import { base, arbitrum, optimism, polygon, mainnet } from 'wagmi/chains'
import type { Chain } from 'viem'

const ALL_CHAINS: Chain[] = [base, arbitrum, optimism, polygon, mainnet]

function rpc(chainId: number) {
  const envKeys: Record<number, string> = {
    [base.id]: 'VITE_RPC_BASE',
    [arbitrum.id]: 'VITE_RPC_ARBITRUM',
    [optimism.id]: 'VITE_RPC_OPTIMISM',
    [polygon.id]: 'VITE_RPC_POLYGON',
    [mainnet.id]: 'VITE_RPC_MAINNET',
  }
  const url = import.meta.env[envKeys[chainId]]
  return url ? http(url) : http()
}

type NexusState = {
  account: MultichainSmartAccount | null
  meeClient: any | null
  smartAccountAddress: string | null
  isLoading: boolean
  error: string | null
}

export function useNexusAccount() {
  const { data: walletClient } = useWalletClient()
  const chainId = useChainId()
  const [state, setState] = useState<NexusState>({
    account: null,
    meeClient: null,
    smartAccountAddress: null,
    isLoading: false,
    error: null,
  })

  const cacheRef = useRef<{
    signerAddr: string
    account: MultichainSmartAccount
    meeClient: any
  } | null>(null)

  useEffect(() => {
    if (!walletClient) {
      setState({ account: null, meeClient: null, smartAccountAddress: null, isLoading: false, error: null })
      cacheRef.current = null
      return
    }

    const signerAddr = walletClient.account.address

    if (cacheRef.current?.signerAddr === signerAddr) {
      const addr = cacheRef.current.account.addressOn(chainId) ?? null
      setState({
        account: cacheRef.current.account,
        meeClient: cacheRef.current.meeClient,
        smartAccountAddress: addr,
        isLoading: false,
        error: addr ? null : 'Chain not supported',
      })
      return
    }

    let cancelled = false

    async function init() {
      setState(s => ({ ...s, isLoading: true, error: null }))
      try {
        // Use getMEEVersion() — returns proper MEEVersionConfig with contract addresses
        const version = getMEEVersion(MEEVersion.V2_2_1)

        const account = await toMultichainNexusAccount({
          signer: walletClient!,
          chainConfigurations: ALL_CHAINS.map(chain => ({
            chain,
            transport: rpc(chain.id),
            version,
          })),
        })

        const meeClient = await createMeeClient({ account })
        const address = account.addressOn(chainId) ?? null

        if (!cancelled) {
          cacheRef.current = { signerAddr, account, meeClient }
          setState({ account, meeClient, smartAccountAddress: address, isLoading: false, error: null })
        }
      } catch (e: any) {
        if (!cancelled) {
          setState(s => ({ ...s, isLoading: false, error: e.message ?? 'Failed to initialize' }))
        }
      }
    }

    init()
    return () => { cancelled = true }
  }, [walletClient, chainId])

  return state
}
