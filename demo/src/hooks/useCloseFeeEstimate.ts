import { useState, useEffect, useRef } from 'react'
import type { MultichainSmartAccount } from '@biconomy/abstractjs'
import type { ChainConfig } from '../config/chains'
import { buildUnwindInstructions } from '../lib/build-unwind'

type FeeEstimate = {
  tokenAmount: string
  tokenValue: string
  isLoading: boolean
}

/**
 * Fetches a quote for the close-position flow to estimate MEE fees.
 * Only runs when hasPosition is true.
 */
export function useCloseFeeEstimate(
  account: MultichainSmartAccount | null,
  meeClient: any,
  chain: ChainConfig | undefined,
  iterations: number,
  hasPosition: boolean,
): FeeEstimate {
  const [state, setState] = useState<FeeEstimate>({ tokenAmount: '', tokenValue: '', isLoading: false })
  const abortRef = useRef(0)

  useEffect(() => {
    if (!account || !meeClient || !chain || !hasPosition || iterations < 1) {
      setState({ tokenAmount: '', tokenValue: '', isLoading: false })
      return
    }

    setState({ tokenAmount: '', tokenValue: '', isLoading: true })
    const id = ++abortRef.current

    async function estimate() {
      try {
        const instructions = await buildUnwindInstructions(account!, chain!, iterations)

        if (id !== abortRef.current) return

        const quote = await meeClient.getQuote({
          instructions,
          feeToken: {
            address: '0x0000000000000000000000000000000000000000',
            chainId: chain!.chainId,
          },
          verificationGasLimit: 150000n,
        })

        if (id !== abortRef.current) return

        setState({
          tokenAmount: quote.paymentInfo.tokenAmount,
          tokenValue: quote.paymentInfo.tokenValue,
          isLoading: false,
        })
      } catch (e) {
        console.warn('Close fee estimate failed:', e)
        if (id === abortRef.current) {
          setState({ tokenAmount: '', tokenValue: '', isLoading: false })
        }
      }
    }

    estimate()

    return () => { abortRef.current++ }
  }, [account, meeClient, chain, iterations, hasPosition])

  return state
}
