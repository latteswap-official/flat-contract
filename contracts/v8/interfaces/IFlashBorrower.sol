// SPDX-License-Identifier: MIT
pragma solidity 0.8.9;

import "@openzeppelin/contracts-upgradeable/token/ERC20/IERC20Upgradeable.sol";

interface IFlashBorrower {
  function onFlashLoan(
    address sender,
    IERC20Upgradeable token,
    uint256 amount,
    uint256 fee,
    bytes calldata data
  ) external;
}
