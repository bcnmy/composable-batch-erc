import { Logger } from "@/core/logger";
import { RpcManagerService } from "@/rpc-manager";
import { Service } from "typedi";
import { type Address } from "viem";

/**
 * Nonce manager context: MUST READ if something needs to be changed here in this file
 *
 * Nonce manager will attempts to fetch latest nonce from the RPC provider and caches it in the memory for a given worker address and chain id.
 * It will also track the last used nonce for a given worker address and chain id.
 * For every transaction, the nonce manager attempts to get a transaction from cache first. If the nonce is not found or it is same as last used nonce
 * The nonce is out of sync and it will be fetched from the RPC provider.
 *
 * Advantages: This reduces the RPC call for fetching the nonce most of the time which will reduce the latency for execution phase.
 *
 * edge cases:
 * 1. If the nonce is out of sync, the nonce manager will fetch the latest nonce from the RPC provider and update the cache.
 *
 * 2. If the nonce is out of sync but the last used nonce and latest nonce are not updated properly. Used nonce will be used for next transaction and it will fail
 * with nonce too low error. With immediate retry mode, the nonce will be force fetched if the error is nonce related which will yield a proper nonce
 * and also updates the cache to have a fresh nonce for next transaction.
 *
 * 3. If there are some RPC failures or gas config or nonce config issues ? The transaction will be failed and not broadcasted. So the nonce will be never marked as used
 *
 * 4. If there is a transaction revert status from txReceipt. It means the transaction has been reverted on chain. So the nonce will be used. So we always mark the nonce as used if
 * we have the tx receipt irrespective of the status.
 *
 * 5. IMPORTANT: If somehow the nonce is marked as used but the transaction is not broadcasted ? the latest nonce will be a future nonce. As a consequence, the next broadcasting transaction will be with future nonce
 * and it will be stuck in the mempool waiting for the sequential nonce dependency. This case will never results in an error but RPC node accepts the transaction and returns a txHash.
 * When we attempt to fetch the txReceipt for this txHash, it will mostly likely fail with tx receipt timeout error. Hence the previousTx hash is stored in the job and retried again later.
 *
 * From here we have three cases,
 * A) If the same job is retried immediately with same worker, during the retry the txReceipt will be not available. As we've already forcefully synced the nonce before adding the prevTxHash
 * the nonce in nonce manager should be properly synced now. The tx retry will happen properly.
 * Post tx, the previous transaction with future nonce will become valid and tried to execute as a double spend/tx but this will fail due to AA nonce duplication issue which is good for us.
 *
 * B) If the same worker tries a different job, it will definitely have a proper nonce as we've forcefully synced the nonce before adding the prevTxHash to previous job.
 * so the proper transaction will be executed for the new job. Post tx, the previous tx with future nonce will become valid and got executed properly by the RPC nodes in background.
 * But unfortunately the tx status is not synced in MEE node yet. When this stuck tx is retried with any worker, the prevTx receipt will be fetched first before retry which will sync the tx status and ends the job.
 *
 * C) If this stuck tx/job is picked up by a different worker, the prevTxHash will result in timeout error because it is still stuck in mempool. So the new worker will retry the job with proper nonce
 * and the tx will be exected. Post tx, the previous transaction (Same calldata) with future nonce of different worker will become valid and tried to execute as a double spend/tx but this will fail due to AA nonce duplication issue which is good for us.
 *
 * NOTE: there are so much such permutations of edge cases are there for #5 and everything will be handled in the same way around with different context.
 */

// IMPORTANT NOTE:
// This nonce manager service works under a non concurrent enviornment only due to the fact that the EOA workers always execute only one transaction at a time.
// There will be no concurrency within a single EOA worker hence concurrency and conflict managements are unneccessary for this service
@Service()
export class NonceManagerService {
  // Tracks the next unused nonce for each (chainId, workerAddress) pair.
  private unusedNonceTrackerByChain: Map<string, Map<string, number>> =
    new Map();

  // Tracks the latest used nonce for each (chainId, workerAddress) pair.
  private usedNonceTrackerByChain: Map<string, Map<string, number>> = new Map();

  constructor(
    private readonly logger: Logger,
    private readonly rpcManagerService: RpcManagerService,
  ) {
    logger.setCaller(NonceManagerService);
  }

  /**
   * Returns the next nonce for a worker address on a given chain.
   * - If forceFetch: always fetch from RPC.
   * - Else: Uses cached unused nonce unless out of sync, then fetches from RPC.
   * @param workerAddress Address to get nonce for.
   * @param chainId Chain id.
   * @param forceFetch Force RPC fetch?
   * @returns Next nonce to use.
   */
  async getNonce(
    workerAddress: Address,
    chainId: string,
    forceFetch?: boolean,
  ): Promise<number> {
    if (forceFetch) {
      return await this.getNonceFromRpc(workerAddress, chainId);
    }

    let unusedNonce = this.getUnusedNonce(workerAddress, chainId);

    if (unusedNonce !== undefined) {
      this.logger.trace(
        {
          workerAddress,
          chainId,
          unusedNonce,
        },
        "Fetched unused nonce for the worker address from cache",
      );

      const usedNonce = this.getUsedNonce(workerAddress, chainId);

      // If the "unused" nonce matches the last used nonce, it means
      // the unused nonce might be out of sync with the internal cache, so fetch a fresh one via RPC call.
      if (unusedNonce === usedNonce) {
        this.logger.trace(
          {
            workerAddress,
            chainId,
            unusedNonce,
            usedNonce,
          },
          "Unused nonce for the worker is out of sync. Fetching the new nonce from RPC provider",
        );
        unusedNonce = await this.getNonceFromRpc(workerAddress, chainId);
      }
    } else {
      // If not found in cache, load from RPC and cache it.
      unusedNonce = await this.getNonceFromRpc(workerAddress, chainId);
    }

    return unusedNonce;
  }

  /**
   * Requests the latest nonce for the worker address from the chain RPC,
   * caches the fetched nonce as the unused nonce.
   * @param workerAddress The address of the sender
   * @param chainId Chain identifier
   * @returns The nonce returned by the chain client for the current address
   */
  async getNonceFromRpc(
    workerAddress: Address,
    chainId: string,
  ): Promise<number> {
    const nonce = await this.rpcManagerService.executeRequest(
      chainId,
      (chainClient) => {
        return chainClient.getTransactionCount({ address: workerAddress });
      },
    );

    this.logger.trace(
      {
        workerAddress,
        chainId,
        nonce,
      },
      "Fetched nonce from RPC for the worker",
    );

    this.setUnusedNonce(workerAddress, chainId, nonce);

    return nonce;
  }

  /**
   * Marks a nonce as used for the given worker and advances the unused nonce to the next value.
   * Should be called after a transaction is sent.
   * @param workerAddress The address of the sender
   * @param chainId Chain identifier
   * @param nonce The nonce that was just used
   */
  markNonceAsUsed(
    workerAddress: Address,
    chainId: string,
    nonce: number,
  ): void {
    // Note: even if you call this function multiple times with same nonce value during error handling, the behavior is same as calling it once
    // because we are passing the current nonce instead just increamenting from last latest nonce automatically

    // Mark the current nonce as used
    this.setUsedNonce(workerAddress, chainId, nonce);
    // Increment the current nonce for next fresh nonce
    this.setUnusedNonce(workerAddress, chainId, nonce + 1);
  }

  /**
   * Gets the last used nonce for a given worker address and chain ID from the tracker.
   * Creates the inner map if not present.
   * @param workerAddress The address of the sender
   * @param chainId Chain identifier
   * @returns The last used nonce for this worker+chain, or undefined
   */
  getUsedNonce(workerAddress: Address, chainId: string): number | undefined {
    let usedNonceTracker = this.usedNonceTrackerByChain.get(chainId);

    if (!usedNonceTracker) {
      usedNonceTracker = new Map<string, number>();
      this.usedNonceTrackerByChain.set(chainId, usedNonceTracker);
    }

    return usedNonceTracker.get(workerAddress.toLowerCase());
  }

  /**
   * Gets the next unused nonce for a given worker address and chain ID from the tracker.
   * Creates the inner map if not present.
   * @param workerAddress The address of the sender
   * @param chainId Chain identifier
   * @returns The next available unused nonce, or undefined
   */
  getUnusedNonce(workerAddress: Address, chainId: string): number | undefined {
    let unusedNonceTracker = this.unusedNonceTrackerByChain.get(chainId);

    if (!unusedNonceTracker) {
      unusedNonceTracker = new Map<string, number>();
      this.unusedNonceTrackerByChain.set(chainId, unusedNonceTracker);
    }

    return unusedNonceTracker.get(workerAddress.toLowerCase());
  }

  /**
   * Sets the last used nonce for a worker address on a given chain, creating the inner map if missing.
   * @param workerAddress The address of the sender
   * @param chainId Chain identifier
   * @param nonce The nonce to set as last used
   */
  setUsedNonce(workerAddress: Address, chainId: string, nonce: number): void {
    let usedNonceTracker = this.usedNonceTrackerByChain.get(chainId);

    if (!usedNonceTracker) {
      usedNonceTracker = new Map<string, number>();
      this.usedNonceTrackerByChain.set(chainId, usedNonceTracker);
    }

    usedNonceTracker.set(workerAddress.toLowerCase(), nonce);
  }

  /**
   * Sets the next unused nonce for a worker address on a given chain, creating the inner map if missing.
   * @param workerAddress The address of the sender
   * @param chainId Chain identifier
   * @param nonce The nonce to set as next unused
   */
  setUnusedNonce(workerAddress: Address, chainId: string, nonce: number): void {
    let unusedNonceTracker = this.unusedNonceTrackerByChain.get(chainId);

    if (!unusedNonceTracker) {
      unusedNonceTracker = new Map<string, number>();
      this.unusedNonceTrackerByChain.set(chainId, unusedNonceTracker);
    }

    unusedNonceTracker.set(workerAddress.toLowerCase(), nonce);
  }
}
