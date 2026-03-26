// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import { Storage } from "../Storage.sol";

/// @title ComposableLens
/// @notice Generic stateless lens for composable batch flows.
///         Call any contract, extract a specific return value word, apply math.
///         Covers the common pattern: "read protocol state → compute → inject as parameter."
/// @dev Deploy once per chain alongside Storage. No owner, no state.
///      All functions are view/pure — designed for STATIC_CALL fetcher in ComposableExecution batches.
contract ComposableLens {
    Storage public immutable storageContract;

    constructor(Storage _storage) {
        storageContract = _storage;
    }

    // ────────────────────────────────────────────────────────
    // Generic protocol reads
    // ────────────────────────────────────────────────────────

    /// @notice Call any contract and extract the Nth 32-byte word from the return data.
    /// @param target     Contract to staticcall
    /// @param data       Calldata for the staticcall (e.g., abi.encodeCall(pool.getUserAccountData, (user)))
    /// @param wordIndex  Zero-based index of the 32-byte word to extract
    /// @return The extracted uint256 value
    function readWord(
        address target,
        bytes calldata data,
        uint256 wordIndex
    ) external view returns (uint256) {
        (bool success, bytes memory returnData) = target.staticcall(data);
        require(success, "ComposableLens: staticcall failed");
        require(returnData.length >= (wordIndex + 1) * 32, "ComposableLens: word out of bounds");
        uint256 value;
        assembly {
            value := mload(add(returnData, add(0x20, mul(wordIndex, 0x20))))
        }
        return value;
    }

    /// @notice Call any contract, extract the Nth word, and apply mulDiv.
    ///         Combines protocol read + fraction + decimal conversion in one call.
    /// @param target      Contract to staticcall
    /// @param data        Calldata for the staticcall
    /// @param wordIndex   Zero-based index of the word to extract
    /// @param numerator   Multiply by this (use for fraction + decimal shift combined)
    /// @param denominator Divide by this
    /// @return The computed result
    /// @dev Example: Aave borrow capacity at 80% in USDC decimals:
    ///      readWordMulDiv(aavePool, getUserAccountData(user), 2, 80e6, 100e8)
    ///      → extracts availableBorrowsBase (word 2), applies 80% fraction and 8→6 decimal conversion
    function readWordMulDiv(
        address target,
        bytes calldata data,
        uint256 wordIndex,
        uint256 numerator,
        uint256 denominator
    ) external view returns (uint256) {
        (bool success, bytes memory returnData) = target.staticcall(data);
        require(success, "ComposableLens: staticcall failed");
        require(returnData.length >= (wordIndex + 1) * 32, "ComposableLens: word out of bounds");
        uint256 value;
        assembly {
            value := mload(add(returnData, add(0x20, mul(wordIndex, 0x20))))
        }
        return (value * numerator) / denominator;
    }

    // ────────────────────────────────────────────────────────
    // Storage reads with math
    // ────────────────────────────────────────────────────────

    /// @notice Read a value from the Storage contract and apply mulDiv.
    /// @param namespace   Storage namespace (keccak256(account, caller))
    /// @param slot        Storage slot (already derived with keccak256(baseSlot, index))
    /// @param numerator   Multiply by this
    /// @param denominator Divide by this
    function storageMulDiv(
        bytes32 namespace,
        bytes32 slot,
        uint256 numerator,
        uint256 denominator
    ) external view returns (uint256) {
        uint256 value = uint256(storageContract.readStorage(namespace, slot));
        return (value * numerator) / denominator;
    }

    /// @notice Read a raw value from the Storage contract.
    /// @param namespace  Storage namespace
    /// @param slot       Storage slot
    function storageRead(
        bytes32 namespace,
        bytes32 slot
    ) external view returns (uint256) {
        return uint256(storageContract.readStorage(namespace, slot));
    }

    // ────────────────────────────────────────────────────────
    // Pure math (no external reads)
    // ────────────────────────────────────────────────────────

    /// @notice Pure mulDiv — for chaining with Storage captures.
    function mulDiv(
        uint256 value,
        uint256 numerator,
        uint256 denominator
    ) external pure returns (uint256) {
        return (value * numerator) / denominator;
    }
}
