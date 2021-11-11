// SPDX-License-Identifier: MIT
pragma solidity 0.8.9;
import "../interfaces/IFlashBorrower.sol";
import "../interfaces/IBatchFlashBorrower.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";

contract MockEvilFlashLoaner is IFlashBorrower, IBatchFlashBorrower {
  using SafeERC20Upgradeable for IERC20Upgradeable;

  function onBatchFlashLoan(
    address sender,
    IERC20Upgradeable[] calldata tokens,
    uint256[] calldata, /*amounts*/
    uint256[] calldata, /*fees*/
    bytes calldata
  ) external override {
    IERC20Upgradeable token = tokens[0];
    uint256 money = token.balanceOf(address(this));
    token.safeTransfer(sender, money);
  }

  function onFlashLoan(
    address sender,
    IERC20Upgradeable token,
    uint256, /*amount*/
    uint256, /*fee*/
    bytes calldata
  ) external override {
    uint256 money = token.balanceOf(address(this));
    token.safeTransfer(sender, money);
  }
}
