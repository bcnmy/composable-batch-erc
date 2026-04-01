import { useReadContract } from 'wagmi'
import type { Address } from 'viem'
import { aavePoolAbi } from '../abis/aavePool'

export function useAaveAccountData(
  poolAddress: Address,
  userAddress: Address | string | null | undefined,
  chainId: number,
) {
  const { data, isLoading } = useReadContract({
    address: poolAddress,
    abi: aavePoolAbi,
    functionName: 'getUserAccountData',
    args: [userAddress as Address],
    chainId,
    query: { enabled: !!userAddress, refetchInterval: 15_000 },
  })

  if (!data) {
    return {
      totalCollateralBase: 0n,
      totalDebtBase: 0n,
      availableBorrowsBase: 0n,
      healthFactor: 0n,
      ltv: 0n,
      isLoading,
      hasPosition: false,
    }
  }

  const [totalCollateralBase, totalDebtBase, availableBorrowsBase, , ltv, healthFactor] = data as readonly [bigint, bigint, bigint, bigint, bigint, bigint]

  return {
    totalCollateralBase,
    totalDebtBase,
    availableBorrowsBase,
    healthFactor,
    ltv,
    isLoading,
    hasPosition: totalCollateralBase > 0n,
  }
}
