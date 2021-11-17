// SPDX-License-Identifier: MIT
/**
  |¯¯¯¯¯|||¯¯¯¯|  '      /¯¯¯¯¯| |¯¯¯¯¯|°
  |    ¯¯|  |       |__   /     !     | |         | 
  |__|¯¯'  |______| /___/¯|__'|  ¯|__|¯  
*/

pragma solidity 0.8.9;
pragma experimental ABIEncoderV2;

import "@openzeppelin/contracts-upgradeable/token/ERC20/IERC20Upgradeable.sol";

import "../libraries/LatteConversion.sol";
import "./IStrategy.sol";

/// @title Latte Batch Flash Borrower interface
interface IFlatMarket {
  function withdrawSurplus() external returns (uint256, uint256);

  function userDebtShare(address _user) external view returns (uint256);

  function repay(address _for, uint256 _maxDebtValue) external returns (uint256);

  function collateralPrice() external view returns (uint256);
}
