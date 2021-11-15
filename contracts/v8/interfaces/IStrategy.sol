// SPDX-License-Identifier: MIT
/**
  |¯¯¯¯¯|||¯¯¯¯|  '      /¯¯¯¯¯| |¯¯¯¯¯|°
  |    ¯¯|  |       |__   /     !     | |         | 
  |__|¯¯'  |______| /___/¯|__'|  ¯|__|¯  
*/

pragma solidity 0.8.9;

interface IStrategy {
  function deposit(bytes calldata data) external;

  function harvest(bytes calldata data) external returns (int256 _amountAdded);

  function withdraw(bytes calldata data) external returns (uint256 _actualAmount);

  function exit(uint256 balance) external returns (int256 _amountAdded);
}
