import { useState } from 'react'
import type { MultichainSmartAccount } from '@biconomy/abstractjs'
import type { ChainConfig } from '../config/chains'
import { buildUnwindInstructions } from '../lib/build-unwind'

type UnwindState =
  | { status: 'idle' }
  | { status: 'building' }
  | { status: 'quoting' }
  | { status: 'signing' }
  | { status: 'executing' }
  | { status: 'success'; hash: string; txHash?: string }
  | { status: 'error'; message: string }

export function useUnwind() {
  const [state, setState] = useState<UnwindState>({ status: 'idle' })

  async function execute(
    account: MultichainSmartAccount,
    meeClient: any,
    chain: ChainConfig,
    iterations: number,
  ) {
    try {
      setState({ status: 'building' })

      const instructions = await buildUnwindInstructions(account, chain, iterations)

      setState({ status: 'quoting' })

      const quote = await meeClient.getQuote({
        instructions,
        feeToken: {
          address: '0x0000000000000000000000000000000000000000',
          chainId: chain.chainId,
        },

        verificationGasLimit: 150000n,
      })

      setState({ status: 'signing' })

      const { hash } = await meeClient.executeQuote({ quote })
      console.log('MEEScan supertx:', `https://meescan.biconomy.io/tx/${hash}`)

      setState({ status: 'executing' })

      // const receipt = await meeClient.waitForSupertransactionReceipt({ hash })
      const receipt = await meeClient.waitForSupertransactionReceipt({
        hash,
        mode: "fast-block"
      })
      
      // TODO: extract txHash from receipt once we confirm the structure
      const txHash = receipt.receipts?.[1]?.transactionHash ?? receipt.receipts?.[0]?.transactionHash ?? undefined

      setState({ status: 'success', hash, txHash })
      return hash
    } catch (e: any) {
      setState({ status: 'error', message: e.message ?? 'Unknown error' })
      throw e
    }
  }

  function reset() {
    setState({ status: 'idle' })
  }

  return { state, execute, reset }
}
