// SPDX-License-Identifier: MIT
pragma solidity 0.8.9;
import "@openzeppelin/contracts-upgradeable/token/ERC20/IERC20Upgradeable.sol";

interface IFlashLiquidateStrategy {
  /// @notice Withdraws 'amountFrom' of token 'from' from the flatVault account for this swapper.
  /// Swaps it for at least 'amountToMin' of token 'to'.
  /// Transfers the swapped tokens of 'to' into the flatVault using a plain ERC20 transfer.
  /// Returns the amount of tokens 'to' transferred to flatVault.
  /// (The flatVault skim function will be used by the caller to get the swapped funds).
  function execute(
    IERC20Upgradeable fromToken,
    IERC20Upgradeable toToken,
    address recipient,
    uint256 shareToMin,
    uint256 shareFrom
  ) external returns (uint256 extraShare, uint256 shareReturned);
}
