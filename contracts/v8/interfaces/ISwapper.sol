// SPDX-License-Identifier: MIT
pragma solidity 0.8.9;
import "@openzeppelin/contracts-upgradeable/token/ERC20/IERC20Upgradeable.sol";

interface ISwapper {
  /// @notice Withdraws 'amountFrom' of token 'from' from the flatVault account for this swapper.
  /// Swaps it for at least 'amountToMin' of token 'to'.
  /// Transfers the swapped tokens of 'to' into the flatVault using a plain ERC20 transfer.
  /// Returns the amount of tokens 'to' transferred to flatVault.
  /// (The flatVault skim function will be used by the caller to get the swapped funds).
  function swap(
    IERC20Upgradeable fromToken,
    IERC20Upgradeable toToken,
    address recipient,
    uint256 shareToMin,
    uint256 shareFrom
  ) external returns (uint256 extraShare, uint256 shareReturned);

  /// @notice Calculates the amount of token 'from' needed to complete the swap (amountFrom),
  /// this should be less than or equal to amountFromMax.
  /// Withdraws 'amountFrom' of token 'from' from the flatVault account for this swapper.
  /// Swaps it for exactly 'exactAmountTo' of token 'to'.
  /// Transfers the swapped tokens of 'to' into the flatVault using a plain ERC20 transfer.
  /// Transfers allocated, but unused 'from' tokens within the flatVault to 'refundTo' (amountFromMax - amountFrom).
  /// Returns the amount of 'from' tokens withdrawn from flatVault (amountFrom).
  /// (The flatVault skim function will be used by the caller to get the swapped funds).
  function swapExact(
    IERC20Upgradeable fromToken,
    IERC20Upgradeable toToken,
    address recipient,
    address refundTo,
    uint256 shareFromSupplied,
    uint256 shareToExact
  ) external returns (uint256 shareUsed, uint256 shareReturned);
}
