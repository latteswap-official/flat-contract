// SPDX-License-Identifier: GPL-3.0

/**
  |¯¯¯¯¯|||¯¯¯¯|  '      /¯¯¯¯¯| |¯¯¯¯¯|°
  |    ¯¯|  |       |__   /     !     | |         | 
  |__|¯¯'  |______| /___/¯|__'|  ¯|__|¯  
 */

// This contract stores funds, handles their transfers, supports flash loans and strategies.

pragma solidity 0.8.9;

// please use smock to mock up the return values
contract MockLatteSwapPairLPChainlinkAggregator {
  function totalSupply() external view returns (uint256) {
    return 0;
  }

  function token0() external view returns (address) {
    return address(0);
  }

  function token1() external view returns (address) {
    return address(0);
  }

  function getReserves()
    external
    view
    returns (
      uint112 reserve0,
      uint112 reserve1,
      uint32 blockTimestampLast
    )
  {
    return (0, 0, 0);
  }
}
