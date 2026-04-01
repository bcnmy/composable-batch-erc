/**
 * Example 9: Uniswap V3 LP Provision — Mint + Stake in One Batch
 *
 * mint() returns a tokenId that doesn't exist before the call.
 * No balance read or getter can substitute — this is THE case for Storage capture.
 *
 * Today: two separate transactions (mint, then stake with the returned tokenId).
 * With smart batching + Storage: one atomic batch.
 *
 * Demonstrates: Storage capture (EXEC_RESULT), Storage read (fromStorage),
 * return value passing between steps.
 */
import { parseEther, type Address, type Hex } from 'viem'
import { composableBatch, token, contract, approve, storage } from '@erc-xxxx/sdk'

export function mintAndStakeLp(
  account: Address,
  moduleAddress: Address,
  token0Amount: bigint,
  token1Amount: bigint,
) {
  const token0 = token(TOKEN0, account)
  const token1 = token(TOKEN1, account)

  const nftManager = contract(UNI_NFT_MANAGER, nftManagerAbi)
  const staking    = contract(LP_STAKING, stakingAbi)

  const store = storage(STORAGE_CONTRACT, { account, caller: moduleAddress })
  const MINT_SLOT = '0x0000000000000000000000000000000000000000000000000000000000000001' as Hex

  const batch = composableBatch({ account })

  // 1. Approve tokens for NFT position manager
  batch.add(approve(token0, UNI_NFT_MANAGER, token0.balance()))
  batch.add(approve(token1, UNI_NFT_MANAGER, token1.balance()))

  // 2. Mint LP position — capture return values to Storage
  //    mint() returns (uint256 tokenId, uint128 liquidity, uint256 amount0, uint256 amount1)
  //    We capture all 4 words. tokenId is at index 0.
  batch.add(nftManager.call('mint', [{
    token0: TOKEN0,
    token1: TOKEN1,
    fee: 3000,
    tickLower: -887220,
    tickUpper: 887220,
    amount0Desired: token0Amount,
    amount1Desired: token1Amount,
    amount0Min: 0n,
    amount1Min: 0n,
    recipient: account,
    deadline: BigInt(Math.floor(Date.now() / 1000) + 3600),
  }], {
    capture: store.capture(MINT_SLOT, 4),
  }))

  // 3. Approve the minted NFT for staking contract
  //    tokenId was captured at Storage[MINT_SLOT, index 0]
  batch.add(nftManager.call('approve', [
    LP_STAKING,
    store.read(MINT_SLOT, 0),  // tokenId — only available via Storage capture
  ]))

  // 4. Stake the NFT
  batch.add(staking.call('stake', [
    store.read(MINT_SLOT, 0),  // same tokenId
  ]))

  return batch
}

declare const TOKEN0: Address, TOKEN1: Address
declare const UNI_NFT_MANAGER: Address, LP_STAKING: Address, STORAGE_CONTRACT: Address
declare const nftManagerAbi: any, stakingAbi: any
