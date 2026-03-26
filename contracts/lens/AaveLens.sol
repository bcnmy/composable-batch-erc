// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

interface IAavePool {
    function getUserAccountData(address user)
        external
        view
        returns (
            uint256 totalCollateralBase,
            uint256 totalDebtBase,
            uint256 availableBorrowsBase,
            uint256 currentLiquidationThreshold,
            uint256 ltv,
            uint256 healthFactor
        );
}

/// @title AaveLens
/// @notice Protocol-specific lens for Aave V3. Provides computed values that
///         require multi-field logic (borrow capacity, withdraw limits, health factor).
///         For simpler single-field reads, use ComposableLens.readWord() instead.
/// @dev Deploy once per chain. No owner, no state, no upgradability.
contract AaveLens {

    /// @notice Safe borrow amount as a fraction of available capacity, in asset-native decimals.
    /// @param pool           Aave V3 pool address
    /// @param user           The borrower's smart account
    /// @param assetDecimals  Decimals of the borrow asset (e.g. 6 for USDC, 18 for DAI)
    /// @param numerator      Fraction numerator (e.g. 80 for 80%)
    /// @param denominator    Fraction denominator (e.g. 100)
    function getSafeBorrowAmount(
        address pool,
        address user,
        uint8 assetDecimals,
        uint256 numerator,
        uint256 denominator
    ) external view returns (uint256) {
        (,, uint256 availableBorrowsBase,,,) = IAavePool(pool).getUserAccountData(user);
        uint256 rawAmount = (availableBorrowsBase * (10 ** assetDecimals)) / 1e8;
        return (rawAmount * numerator) / denominator;
    }

    /// @notice Safe withdraw amount — how much collateral can be removed while keeping
    ///         the health factor above 1.0, as a fraction, in asset-native decimals.
    /// @dev Formula: excessCollateral = totalCollateral - (totalDebt * 10000 / liquidationThreshold)
    ///      Then apply fraction and decimal conversion.
    /// @param pool           Aave V3 pool address
    /// @param user           The account
    /// @param assetDecimals  Decimals of the collateral asset (e.g. 18 for WETH)
    /// @param numerator      Fraction numerator (e.g. 50 for 50% of safe amount)
    /// @param denominator    Fraction denominator (e.g. 100)
    function getSafeWithdrawAmount(
        address pool,
        address user,
        uint8 assetDecimals,
        uint256 numerator,
        uint256 denominator
    ) external view returns (uint256) {
        (
            uint256 totalCollateralBase,
            uint256 totalDebtBase,
            ,
            uint256 currentLiquidationThreshold,
            ,
        ) = IAavePool(pool).getUserAccountData(user);

        // currentLiquidationThreshold is in basis points (e.g. 8250 = 82.50%)
        // Minimum collateral needed = totalDebt * 10000 / liquidationThreshold
        if (currentLiquidationThreshold == 0) return 0;
        uint256 minCollateral = (totalDebtBase * 10000) / currentLiquidationThreshold;

        if (totalCollateralBase <= minCollateral) return 0;
        uint256 excessBase = totalCollateralBase - minCollateral;

        // Convert from 8-decimal USD base to asset-native decimals, then apply fraction
        uint256 rawAmount = (excessBase * (10 ** assetDecimals)) / 1e8;
        return (rawAmount * numerator) / denominator;
    }

    /// @notice Health factor (18 decimals). >= 1e18 is safe, < 1e18 is liquidatable.
    function getHealthFactor(address pool, address user) external view returns (uint256) {
        (,,,,, uint256 healthFactor) = IAavePool(pool).getUserAccountData(user);
        return healthFactor;
    }

    /// @notice Available borrows in asset-native decimals (no fraction).
    function getAvailableBorrows(
        address pool,
        address user,
        uint8 assetDecimals
    ) external view returns (uint256) {
        (,, uint256 availableBorrowsBase,,,) = IAavePool(pool).getUserAccountData(user);
        return (availableBorrowsBase * (10 ** assetDecimals)) / 1e8;
    }
}
