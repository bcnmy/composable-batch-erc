import type {
  Account,
  Chain,
  Client,
  Hash,
  Transport,
} from 'viem'
import type { BatchBuilder } from '../core/batch.js'

// ────────────────────────────────────────────────────────────
// Simulation result
// ────────────────────────────────────────────────────────────

export type SimulationResult = {
  success: boolean
  /** Index of the first failing step, or -1 if all pass. */
  failingStep: number
  /** Error message from the failing step. */
  error?: string
  /** Estimated gas for the full batch. */
  gasEstimate: bigint
}

// ────────────────────────────────────────────────────────────
// Client extension
// ────────────────────────────────────────────────────────────

export type ComposableActions = {
  /**
   * Encode and send a composable batch via the smart account.
   * Handles UserOp wrapping, signing, and submission.
   */
  sendComposableBatch: (params: {
    batch: BatchBuilder
  }) => Promise<Hash>

  /**
   * Simulate a composable batch via eth_call.
   * Returns which step would fail and estimated gas.
   */
  simulateComposableBatch: (params: {
    batch: BatchBuilder
  }) => Promise<SimulationResult>
}

/**
 * Viem client extension for Smart Batching.
 *
 * @example
 * ```ts
 * import { createWalletClient } from 'viem'
 * import { composableActions } from '@erc-xxxx/sdk/viem'
 *
 * const client = createWalletClient({ ... })
 *   .extend(composableActions)
 *
 * const hash = await client.sendComposableBatch({ batch })
 * ```
 */
export function composableActions<
  transport extends Transport = Transport,
  chain extends Chain | undefined = Chain | undefined,
  account extends Account | undefined = Account | undefined,
>(
  client: Client<transport, chain, account>,
): ComposableActions {
  return {
    async sendComposableBatch({ batch }) {
      const calldata = batch.toCalldata()

      // Route through the smart account's execution path:
      // - ERC-4337: wrap in UserOperation targeting executeComposable()
      // - ERC-7702: direct call to the delegation target
      // - Direct: call executeComposable() on the account
      //
      // The actual routing depends on the account type, which
      // is determined by the client configuration.
      //
      // Stubbed — real implementation integrates with
      // permissionless.js or the account SDK.
      throw new Error('TODO: implement sendComposableBatch')
    },

    async simulateComposableBatch({ batch }) {
      const calldata = batch.toCalldata()

      // eth_call to the account's executeComposable() function.
      // Parse revert data to determine which step failed.
      //
      // Stubbed — real implementation uses client.call()
      throw new Error('TODO: implement simulateComposableBatch')
    },
  }
}
