// SPDX-License-Identifier: MIT

/**
  |¯¯¯¯¯|||¯¯¯¯|  '      /¯¯¯¯¯| |¯¯¯¯¯|°
  |    ¯¯|  |       |__   /     !     | |         | 
  |__|¯¯'  |______| /___/¯|__'|  ¯|__|¯  
 */

pragma solidity 0.8.9;

import "@openzeppelin/contracts-upgradeable/token/ERC20/IERC20Upgradeable.sol";

interface IFlashLiquidateStrategy {
  function execute(
    IERC20Upgradeable fromToken,
    IERC20Upgradeable toToken,
    address recipient,
    uint256 shareToMin,
    uint256 shareFrom
  ) external returns (uint256 extraShare, uint256 shareReturned);
}
