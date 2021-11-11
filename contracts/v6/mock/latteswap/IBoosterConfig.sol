// SPDX-License-Identifier: GPL-3.0
//        .-.                               .-.
//       / (_)         /      /       .--.-'
//      /      .-. ---/------/---.-. (  (_)`)    (  .-.   .-.
//     /      (  |   /      /  ./.-'_ `-.  /  .   )(  |   /  )
//  .-/.    .-.`-'-'/      /   (__.'_    )(_.' `-'  `-'-'/`-'
// (_/ `-._.                       (_.--'               /

pragma solidity 0.6.12;

interface IBoosterConfig {
  function energyInfo(address nftAddress, uint256 nftTokenId)
    external
    view
    returns (
      uint256 maxEnergy,
      uint256 currentEnergy,
      uint256 boostBps
    );

  function boosterNftAllowance(
    address stakingToken,
    address nftAddress,
    uint256 nftTokenId
  ) external view returns (bool);

  function stakeTokenAllowance(address stakingToken) external view returns (bool);

  function callerAllowance(address caller) external view returns (bool);

  function consumeEnergy(
    address nftAddress,
    uint256 nftTokenId,
    uint256 energyToBeConsumed
  ) external;
}
