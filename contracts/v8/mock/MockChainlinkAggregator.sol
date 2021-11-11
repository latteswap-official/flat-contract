// SPDX-License-Identifier: GPL-3.0

/**
  |¯¯¯¯¯|||¯¯¯¯|  '      /¯¯¯¯¯| |¯¯¯¯¯|°
  |    ¯¯|  |       |__   /     !     | |         | 
  |__|¯¯'  |______| /___/¯|__'|  ¯|__|¯  
 */

// This contract stores funds, handles their transfers, supports flash loans and strategies.

pragma solidity 0.8.9;

contract MockChainlinkAggregator {
  function latestAnswer() external view returns (int256 answer) {
    return int256(1);
  }

  function description() external view returns (string memory) {
    return string("foo");
  }

  function latestRoundData()
    external
    view
    returns (
      uint80 roundId,
      int256 answer,
      uint256 startedAt,
      uint256 updatedAt,
      uint80 answeredInRound
    )
  {
    return (uint80(0), int256(1), uint256(0), uint256(0), uint80(0));
  }
}
