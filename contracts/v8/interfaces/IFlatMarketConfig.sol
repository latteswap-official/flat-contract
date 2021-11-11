// SPDX-License-Identifier: GPL-3.0

pragma solidity 0.8.9;

interface IFlatMerketConfig {
  function feeTreasury() external view returns (address);

  function interestPerSecond(address _flatMarket) external view returns (uint256);

  function liquidationMultiplier(address _flatMarket) external view returns (uint256);

  function maxCollateralRatio(
    address _flatMarket,
    address /* _user */
  ) external view returns (uint256);
}
