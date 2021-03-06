// SPDX-License-Identifier: MIT
/**
  |¯¯¯¯¯|||¯¯¯¯|  '      /¯¯¯¯¯| |¯¯¯¯¯|°
  |    ¯¯|  |       |__   /     !     | |         | 
  |__|¯¯'  |______| /___/¯|__'|  ¯|__|¯  
*/

pragma solidity 0.8.9;

interface IBooster {
  function stake(address _stakeToken, uint256 _amount) external;

  function unstake(address _stakeToken, uint256 _amount) external;

  function harvest(address _stakeToken) external;

  function emergencyWithdraw(address _stakeToken) external;

  function masterBarista() external view returns (address);

  function latte() external view returns (address);
}
