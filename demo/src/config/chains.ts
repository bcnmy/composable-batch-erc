import type { Address } from 'viem'
import { mainnet, base, arbitrum, optimism } from 'wagmi/chains'

export type ChainConfig = {
  chainId: number
  name: string
  aavePool: Address
  weth: Address
  usdc: Address
  aWeth: Address
  swapRouter: Address
  uniswapFee: number
  aaveLens: Address
  explorerUrl: string
}

// AaveLens will be deployed to same CREATE2 address on all chains
const AAVE_LENS: Address = '0x6be1383540ee3c7203f496b1b87dc4fb9038fedb'

export const SUPPORTED_CHAINS: Record<number, ChainConfig> = {
  [base.id]: {
    chainId: base.id,
    name: 'Base',
    aavePool: '0xA238Dd80C259a72e81d7e4664a9801593F98d1c5',
    weth: '0x4200000000000000000000000000000000000006',
    usdc: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    aWeth: '0xD4a0e0b9149BCee3C920d2E00b5dE09138fd8bb7',
    swapRouter: '0x2626664c2603336E57B271c5C0b26F421741e481',
    uniswapFee: 500,
    aaveLens: AAVE_LENS,
    explorerUrl: 'https://basescan.org',
  },
  [arbitrum.id]: {
    chainId: arbitrum.id,
    name: 'Arbitrum',
    aavePool: '0x794a61358D6845594F94dc1DB02A252b5b4814aD',
    weth: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1',
    usdc: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
    aWeth: '0xe50fA9b3c56FfB159cB0FCA61F5c9D750e8128c8',
    swapRouter: '0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45',
    uniswapFee: 500,
    aaveLens: AAVE_LENS,
    explorerUrl: 'https://arbiscan.io',
  },
  [optimism.id]: {
    chainId: optimism.id,
    name: 'Optimism',
    aavePool: '0x794a61358D6845594F94dc1DB02A252b5b4814aD',
    weth: '0x4200000000000000000000000000000000000006',
    usdc: '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85',
    aWeth: '0xe50fA9b3c56FfB159cB0FCA61F5c9D750e8128c8',
    swapRouter: '0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45',
    uniswapFee: 500,
    aaveLens: AAVE_LENS,
    explorerUrl: 'https://optimistic.etherscan.io',
  },
  // Polygon omitted — native token is POL, not ETH.
  // WETH on Polygon is a bridged token without deposit(), so the wrap step doesn't work.
  [mainnet.id]: {
    chainId: mainnet.id,
    name: 'Ethereum',
    aavePool: '0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2',
    weth: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
    usdc: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
    aWeth: '0x4d5F47FA6A74757f35C14fD3a6Ef8E3C9BC514E8',
    swapRouter: '0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45',
    uniswapFee: 500,
    aaveLens: AAVE_LENS,
    explorerUrl: 'https://etherscan.io',
  },
}

export function getChainConfig(chainId: number): ChainConfig | undefined {
  return SUPPORTED_CHAINS[chainId]
}

export const supportedChainIds = Object.keys(SUPPORTED_CHAINS).map(Number)
