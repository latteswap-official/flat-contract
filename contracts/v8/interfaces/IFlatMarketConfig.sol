// SPDX-License-Identifier: MIT
/**
  |¯¯¯¯¯|||¯¯¯¯|  '      /¯¯¯¯¯| |¯¯¯¯¯|°
  |    ¯¯|  |       |__   /     !     | |         | 
  |__|¯¯'  |______| /___/¯|__'|  ¯|__|¯  
*/

pragma solidity 0.8.9;

interface IFlatMerketConfig {
  function collateralFactor(address _flatMarket, address _user) external view returns (uint256);

  function interestPerSecond(address _flatMarket) external view returns (uint256);

  function liquidationPenalty(address _flatMarket) external view returns (uint256);

  function liquidationTreasuryBps(address _flatMarket) external view returns (uint256);

  function closeFactorBps(address _flatMarket) external view returns (uint256);

  function minDebtSize(address _flatMarket) external view returns (uint256);

  function treasury() external view returns (address);
}
