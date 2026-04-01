import { useState } from 'react'
import type { Address } from 'viem'
import { runtimeNativeBalanceOf } from '@biconomy/abstractjs'
import type { MultichainSmartAccount } from '@biconomy/abstractjs'
import type { ChainConfig } from '../config/chains'

type WithdrawState =
  | { status: 'idle' }
  | { status: 'building' }
  | { status: 'quoting' }
  | { status: 'signing' }
  | { status: 'executing' }
  | { status: 'success'; hash: string; txHash?: string }
  | { status: 'error'; message: string }

export function useWithdraw() {
  const [state, setState] = useState<WithdrawState>({ status: 'idle' })

  async function execute(
    account: MultichainSmartAccount,
    meeClient: any,
    chain: ChainConfig,
    to: Address,
    amount?: bigint,
    useMax?: boolean,
  ) {
    try {
      setState({ status: 'building' })

      const addr = account.addressOn(chain.chainId, true)!

      // Use runtime native balance for max — reads actual balance at execution time
      // so gas fee changes between signing and execution don't cause reverts
      const value = useMax
        ? runtimeNativeBalanceOf({ targetAddress: addr })
        : (amount ?? 0n)

      const instructions = await account.buildComposable({
        type: 'nativeTokenTransfer',
        data: {
          chainId: chain.chainId,
          to,
          value,
        },
      })

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
