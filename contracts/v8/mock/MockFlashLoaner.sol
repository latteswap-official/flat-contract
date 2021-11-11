// SPDX-License-Identifier: MIT
pragma solidity 0.8.9;
import "../interfaces/IFlashBorrower.sol";
import "../interfaces/IBatchFlashBorrower.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";

contract MockFlashLoaner is IFlashBorrower, IBatchFlashBorrower {
  using SafeERC20Upgradeable for IERC20Upgradeable;

  function onBatchFlashLoan(
    address sender,
    IERC20Upgradeable[] calldata tokens,
    uint256[] calldata amounts,
    uint256[] calldata fees,
    bytes calldata
  ) external override {
    address clerk = address(msg.sender);
    uint256 payback = amounts[0] + fees[0];
    IERC20Upgradeable token = tokens[0];
    uint256 money = token.balanceOf(address(this));
    token.safeTransfer(address(clerk), payback);
    uint256 winnings = money - (payback);
    token.safeTransfer(sender, winnings);
  }

  function onFlashLoan(
    address sender,
    IERC20Upgradeable token,
    uint256 amount,
    uint256 fee,
    bytes calldata
  ) external override {
    address clerk = address(msg.sender);
    uint256 payback = amount + (fee);
    uint256 money = token.balanceOf(address(this));
    token.safeTransfer(address(clerk), payback);
    uint256 winnings = money - (payback);
    token.safeTransfer(sender, winnings);
  }
}
