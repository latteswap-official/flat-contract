// SPDX-License-Identifier: MIT

/**
  |¯¯¯¯¯|||¯¯¯¯|  '      /¯¯¯¯¯| |¯¯¯¯¯|°
  |    ¯¯|  |       |__   /     !     | |         | 
  |__|¯¯'  |______| /___/¯|__'|  ¯|__|¯  
 */

pragma solidity 0.8.9;

/// @title ITreasuryHolderCallback is an interface for flat market to be used
interface ITreasuryHolderCallback {
  function onBadDebt(uint256 _badDebtValue) external;
}
