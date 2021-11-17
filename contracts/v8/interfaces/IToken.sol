// SPDX-License-Identifier: MIT
/**
  |¯¯¯¯¯|||¯¯¯¯|  '      /¯¯¯¯¯| |¯¯¯¯¯|°
  |    ¯¯|  |       |__   /     !     | |         | 
  |__|¯¯'  |______| /___/¯|__'|  ¯|__|¯  
*/

pragma solidity 0.8.9;

interface IToken {
  function decimals() external view returns (uint256);

  function balanceOf(address) external view returns (uint256);

  function transfer(address, uint256) external returns (bool);

  function transferFrom(
    address,
    address,
    uint256
  ) external returns (bool);

  function approve(address, uint256) external returns (bool);
}
