// SPDX-License-Identifier: MIT

/**
  |¯¯¯¯¯|||¯¯¯¯|  '      /¯¯¯¯¯| |¯¯¯¯¯|°
  |    ¯¯|  |       |__   /     !     | |         | 
  |__|¯¯'  |______| /___/¯|__'|  ¯|__|¯  
 */

pragma solidity 0.8.9;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@latteswap/latteswap-contract/contracts/swap/interfaces/ILatteSwapPair.sol";
import "../libraries/LatteMath.sol";
import "../interfaces/IChainlinkAggregator.sol";

/// @title LPChainlinkAggregator
/// @notice Oracle used for getting the price of an LP token
/// @dev Optimized version based on https://blog.alphafinance.io/fair-lp-token-pricing/
contract LPChainlinkAggregator is IChainlinkAggregator, Initializable {
  using LatteMath for uint256;

  ILatteSwapPair public pair;
  IChainlinkAggregator public token0Oracle; // token0-BNB aggregator
  IChainlinkAggregator public token1Oracle; // token1-BNB aggregator
  address public token0;
  address public token1;

  function initialize(
    ILatteSwapPair _pair,
    IChainlinkAggregator _token0Oracle,
    IChainlinkAggregator _token1Oracle
  ) public initializer {
    pair = _pair;
    token0Oracle = _token0Oracle;
    token1Oracle = _token1Oracle;
  }

  // Calculates the lastest exchange rate representing token value in USD
  function latestAnswer() external view override returns (int256) {
    uint256 _totalSupply = ILatteSwapPair(pair).totalSupply();
    (uint256 _r0, uint256 _r1, ) = ILatteSwapPair(pair).getReserves();
    uint256 _sqrtK = LatteMath.sqrt(_r0 * _r1).fdiv(_totalSupply); // in 2**112
    // latest answer in USD (decimals are 8)
    uint256 _px0 = (uint256(token0Oracle.latestAnswer()) * (2**112)); // in 2**112
    uint256 _px1 = (uint256(token1Oracle.latestAnswer()) * (2**112)); // in 2**112
    // fair token0 amt: _sqrtK * sqrt(_px1/_px0)
    // fair token1 amt: _sqrtK * sqrt(_px0/_px1)
    // fair lp price = 2 * sqrt(_px0 * _px1)
    // split into 2 sqrts multiplication to prevent uint overflow (note the 2**112)

    uint256 _totalValue = (((_sqrtK * (2) * (LatteMath.sqrt(_px0))) / (2**56)) * (LatteMath.sqrt(_px1))) / (2**56);
    return int256(((_totalValue) * 10**10) / (2**112)); // change from 2**112 to 2**18
  }
}
