import { useBalance, useReadContracts } from 'wagmi'
import type { Address } from 'viem'
import { erc20Abi } from '../abis/erc20'

export function useSmartAccountBalances(
  smartAccountAddress: Address | string | null | undefined,
  wethAddress: Address,
  usdcAddress: Address,
  chainId: number,
) {
  const enabled = !!smartAccountAddress

  const ethBalance = useBalance({
    address: smartAccountAddress as Address,
    chainId,
    query: { enabled, refetchInterval: 4_000 },
  })

  const tokenBalances = useReadContracts({
    contracts: [
      {
        address: wethAddress,
        abi: erc20Abi,
        functionName: 'balanceOf',
        args: [smartAccountAddress as Address],
        chainId,
      },
      {
        address: usdcAddress,
        abi: erc20Abi,
        functionName: 'balanceOf',
        args: [smartAccountAddress as Address],
        chainId,
      },
    ],
    query: { enabled, refetchInterval: 4_000 },
  })

  return {
    ethBalance: ethBalance.data?.value ?? 0n,
    wethBalance: (tokenBalances.data?.[0]?.result as bigint) ?? 0n,
    usdcBalance: (tokenBalances.data?.[1]?.result as bigint) ?? 0n,
    isLoading: ethBalance.isLoading || tokenBalances.isLoading,
    refetch: () => { ethBalance.refetch(); tokenBalances.refetch() },
  }
}
