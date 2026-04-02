import { useState, useEffect, useRef } from 'react'
import { parseEther } from 'viem'
import type { MultichainSmartAccount } from '@biconomy/abstractjs'
import type { ChainConfig } from '../config/chains'
import { buildLeverageLoopInstructions } from '../lib/build-loop'

type FeeEstimate = {
  tokenAmount: string
  tokenValue: string
  tokenSymbol: string
  isLoading: boolean
}

/**
 * Fetches a quote in the background to estimate MEE fees.
 * Debounced — only fires after input stabilizes for 800ms.
 */
export function useFeeEstimate(
  account: MultichainSmartAccount | null,
  meeClient: any,
  chain: ChainConfig | undefined,
  loops: number,
  amountEth: number,
  usdcBalance: bigint,
  existingCollateralBase?: bigint,
  existingDebtBase?: bigint,
  ethPriceUsd?: number,
): FeeEstimate {
  const [state, setState] = useState<FeeEstimate>({
    tokenAmount: '',
    tokenValue: '',
    tokenSymbol: '',
    isLoading: false,
  })
  const abortRef = useRef(0)

  useEffect(() => {
    if (!account || !meeClient || !chain || amountEth < 0.0001) {
      setState({ tokenAmount: '', tokenValue: '', tokenSymbol: '', isLoading: false })
      return
    }

    setState(s => ({ ...s, isLoading: true }))
    const id = ++abortRef.current

    const timer = setTimeout(async () => {
      try {
        const amount = parseEther(amountEth.toFixed(18))
        const instructions = await buildLeverageLoopInstructions(
          account, chain, loops, 80, amount, usdcBalance,
          existingCollateralBase, existingDebtBase, ethPriceUsd,
        )

        if (id !== abortRef.current) return

        const quote = await meeClient.getQuote({
          instructions,
          feeToken: {
            address: '0x0000000000000000000000000000000000000000',
            chainId: chain.chainId,
          },

          verificationGasLimit: 150000n,
        })

        if (id !== abortRef.current) return

        setState({
          tokenAmount: quote.paymentInfo.tokenAmount,
          tokenValue: quote.paymentInfo.tokenValue,
          tokenSymbol: 'ETH',
          isLoading: false,
        })
      } catch {
        if (id === abortRef.current) {
          setState({ tokenAmount: '', tokenValue: '', tokenSymbol: '', isLoading: false })
        }
      }
    }, 800)

    return () => {
      clearTimeout(timer)
      abortRef.current++
    }
  }, [account, meeClient, chain, loops, amountEth, usdcBalance])

  return state
}
