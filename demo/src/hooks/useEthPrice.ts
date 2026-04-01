import { useReadContract } from 'wagmi'
import type { Address } from 'viem'
import { aaveLensAbi } from '../abis/aaveLens'

/**
 * Read the ETH price from Aave's on-chain oracle via the AaveLens.
 * Returns price in USD (e.g. 2130.50), refreshes every 15s.
 */
export function useEthPrice(
  aaveLens: Address | undefined,
  aavePool: Address | undefined,
  weth: Address | undefined,
  chainId: number,
): number {
  const enabled = !!aaveLens && !!aavePool && !!weth

  const { data } = useReadContract({
    address: aaveLens,
    abi: aaveLensAbi,
    functionName: 'getAssetPrice',
    args: [aavePool!, weth!],
    chainId,
    query: { enabled, refetchInterval: 15_000 },
  })

  // Aave oracle returns price in 8-decimal USD
  return data ? Number(data) / 1e8 : 0
}
