// SPDX-License-Identifier: MIT
pragma solidity 0.8.9;

import "@openzeppelin/contracts-upgradeable/token/ERC20/IERC20Upgradeable.sol";

interface IBatchFlashBorrower {
  function onBatchFlashLoan(
    address sender,
    IERC20Upgradeable[] calldata tokens,
    uint256[] calldata amounts,
    uint256[] calldata fees,
    bytes calldata data
  ) external;
}
