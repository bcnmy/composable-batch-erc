import { useState } from 'react'
import type { MultichainSmartAccount } from '@biconomy/abstractjs'
import type { ChainConfig } from '../config/chains'
import { buildLeverageLoopInstructions } from '../lib/build-loop'

type ExecutionState =
  | { status: 'idle' }
  | { status: 'building' }
  | { status: 'quoting' }
  | { status: 'signing' }
  | { status: 'executing' }
  | { status: 'success'; hash: string; txHash?: string }
  | { status: 'error'; message: string }

export function useLeverageLoop() {
  const [state, setState] = useState<ExecutionState>({ status: 'idle' })

  async function execute(
    account: MultichainSmartAccount,
    meeClient: any,
    chain: ChainConfig,
    loops: number,
    borrowFraction: number,
    amount?: bigint,
    existingUsdcBalance?: bigint,
  ) {
    try {
      setState({ status: 'building' })

      const instructions = await buildLeverageLoopInstructions(
        account, chain, loops, borrowFraction, amount, existingUsdcBalance,
      )

      setState({ status: 'quoting' })

      const quote = await meeClient.getQuote({
        instructions,
        feeToken: {
          address: '0x0000000000000000000000000000000000000000',
          chainId: chain.chainId,
        },

        verificationGasLimit: 120000n,
      })

      setState({ status: 'signing' })

      const { hash } = await meeClient.executeQuote({ quote })
      console.log('MEEScan supertx:', `https://meescan.biconomy.io/tx/${hash}`)

      setState({ status: 'executing' })

      const receipt = await meeClient.waitForSupertransactionReceipt({ hash })
      // userOps[1] is the dev userOp (index 0 is payment)
      const txHash = receipt.receipts?.[1]?.transactionHash ?? receipt.receipts?.[0]?.transactionHash

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
