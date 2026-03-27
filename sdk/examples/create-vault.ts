/**
 * Example 10: Create Vault + Deposit + Configure — Factory Return Value Pattern
 *
 * Many protocols use factories that deploy a new contract and return its address.
 * The address doesn't exist before the call — no balance read or getter can
 * substitute. This is the second core pattern (after NFT tokenIds) that
 * requires Storage capture.
 *
 * Flow: Create vault via factory (capture address) → Approve tokens for the
 *       new vault → Deposit into the vault → Set vault parameters
 *
 * Today: 2+ transactions — create, read address from receipt, then interact.
 * With smart batching + Storage: atomic vault creation and configuration.
 *
 * Demonstrates: Storage capture for factory-created addresses,
 * using a captured address as a dynamic TARGET (the call target itself is
 * resolved at runtime from Storage).
 */
import { type Address, type Hex } from 'viem'
import { composableBatch, token, contract, storage, encodeStep } from '@erc-xxxx/sdk'

export function createAndFundVault(
  account: Address,
  moduleAddress: Address,
  depositAmount: bigint,
  performanceFee: bigint,
) {
  const usdc = token(USDC, account)

  const factory = contract(VAULT_FACTORY, factoryAbi)

  const store = storage(STORAGE_CONTRACT, { account, caller: moduleAddress })
  const CREATE_SLOT = '0x0000000000000000000000000000000000000000000000000000000000000001' as Hex

  const batch = composableBatch({ account })

  // 1. Create vault — factory returns the new vault address
  //    createVault(asset, name, symbol) returns (address newVault)
  //    The address doesn't exist until this call executes.
  batch.add(factory.call('createVault', [USDC, 'My USDC Vault', 'mvUSDC'], {
    capture: store.capture(CREATE_SLOT, 1),
  }))

  // 2. Approve USDC for the new vault
  //    The spender is the captured vault address — resolved from Storage.
  //    Uses encodeStep directly because the spender arg is a Storage read.
  batch.add({
    __encoded: encodeStep({
      to: USDC,
      abi: erc20Abi,
      functionName: 'approve',
      args: [store.read(CREATE_SLOT, 0), depositAmount],
    }),
  })

  // 3. Deposit into the new vault
  //    The call TARGET is the captured vault address — dynamic target.
  //    This is the rare case where the contract to call is unknown at signing time.
  batch.add({
    __encoded: encodeStep({
      to: store.read(CREATE_SLOT, 0),  // dynamic TARGET from Storage
      abi: vaultAbi,
      functionName: 'deposit',
      args: [depositAmount, account],
    }),
  })

  // 4. Configure the vault — set performance fee
  batch.add({
    __encoded: encodeStep({
      to: store.read(CREATE_SLOT, 0),  // same dynamic TARGET
      abi: vaultAbi,
      functionName: 'setPerformanceFee',
      args: [performanceFee],
    }),
  })

  return batch
}

declare const USDC: Address, VAULT_FACTORY: Address, STORAGE_CONTRACT: Address
declare const factoryAbi: any, vaultAbi: any, erc20Abi: any
