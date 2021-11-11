// SPDX-License-Identifier: MIT
pragma solidity 0.8.9;

interface IStrategy {
  /// @notice Send the assets to the Strategy and call skim to invest them.
  /// @param data adhoc data based on strategy
  function deposit(bytes calldata data) external;

  /// @notice Harvest any profits made converted to the asset and pass them to the caller.
  /// @param data adhoc data based on strategy
  /// @return _amountAdded The delta (+profit or -loss) that occured in contrast to `balance`.
  function harvest(bytes calldata data) external returns (int256 _amountAdded);

  /// @notice Withdraw assets. The returned amount can differ from the requested amount due to rounding.
  /// @dev The `actualAmount` should be very close to the amount.
  /// The difference should NOT be used to report a loss. That's what harvest is for.
  /// @param data adhoc data based on strategy
  /// @return _actualAmount The real amount that is withdrawn.
  function withdraw(bytes calldata data) external returns (uint256 _actualAmount);

  /// @notice Withdraw all assets in the safest way possible. This shouldn't fail.
  /// @param balance The amount of tokens the caller thinks it has invested.
  /// @return _amountAdded The delta (+profit or -loss) that occured in contrast to `balance`.
  function exit(uint256 balance) external returns (int256 _amountAdded);
}
