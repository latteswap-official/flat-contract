// SPDX-License-Identifier: MIT

/**
  |¯¯¯¯¯|||¯¯¯¯|  '      /¯¯¯¯¯| |¯¯¯¯¯|°
  |    ¯¯|  |       |__   /     !     | |         | 
  |__|¯¯'  |______| /___/¯|__'|  ¯|__|¯  
 */

pragma solidity 0.8.9;

import "@openzeppelin/contracts-upgradeable/utils/math/SafeCastUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "../interfaces/IChainlinkAggregator.sol";

interface IAggregatorV3Interface {
  function decimals() external view returns (uint8);

  function description() external view returns (string memory);

  function version() external view returns (uint256);

  // getRoundData and latestRoundData should both raise "No data present"
  // if they do not have data to report, instead of returning unset values
  // which could be misinterpreted as actual reported values.
  function getRoundData(uint80 _roundId)
    external
    view
    returns (
      uint80 roundId,
      int256 answer,
      uint256 startedAt,
      uint256 updatedAt,
      uint80 answeredInRound
    );

  function latestRoundData()
    external
    view
    returns (
      uint80 roundId,
      int256 answer,
      uint256 startedAt,
      uint256 updatedAt,
      uint80 answeredInRound
    );
}

interface ChainlinkDetailedERC20 {
  function decimals() external view returns (uint8);
}

contract TokenChainlinkAggregator is IChainlinkAggregator, OwnableUpgradeable {
  using SafeCastUpgradeable for int256;

  event LogSetRefBNB(address token, address ref);
  event LogSetRefUSD(address token, address ref);
  event LogSetMaxDelayTime(address token, uint256 maxDelayTime);
  event LogSetRefBNBUSD(address ref);

  address public token; // for getting token price in BNB
  address public wbnb; // wbnb
  address public refBNBUSD; // BNB-USD price reference
  address public refBNB; // BNB price reference
  address public refUSD; // USD price reference
  uint256 public maxDelayTime; // max delay time

  function initialize(
    address _wbnb,
    address _refBNBUSD,
    address _token
  ) external initializer {
    OwnableUpgradeable.__Ownable_init();

    token = _token;
    wbnb = _wbnb;
    refBNBUSD = _refBNBUSD;
  }

  /// @dev Set price reference for BNB pair
  /// @param _ref list of reference contract addresses
  function setRefBNB(address _ref) external onlyOwner {
    refBNB = _ref;
    emit LogSetRefBNB(token, _ref);
  }

  /// @dev Set price reference for USD pair
  /// @param _ref list of reference contract addresses
  function setRefUSD(address _ref) external onlyOwner {
    refUSD = _ref;
    emit LogSetRefUSD(token, _ref);
  }

  /// @dev Set max delay time for each token
  /// @param _maxDelay list of max delay times to set to
  function setMaxDelayTime(uint256 _maxDelay) external onlyOwner {
    maxDelayTime = _maxDelay;
    emit LogSetMaxDelayTime(token, _maxDelay);
  }

  /// @dev Set BNB-USD to the new reference
  /// @param _refBNBUSD The new BNB-USD reference address to set to
  function setRefBNBUSD(address _refBNBUSD) external onlyOwner {
    refBNBUSD = _refBNBUSD;
    emit LogSetRefBNBUSD(_refBNBUSD);
  }

  /// @dev Return token price in  representing token value in BNB
  function latestAnswer() external view override returns (int256) {
    if (token == wbnb || token == address(0)) return int256(1e18);
    uint256 _decimals = uint256(ChainlinkDetailedERC20(token).decimals());
    require(maxDelayTime != 0, "TokenChainlinkAggregator::latestAnswer::max delay time not set");

    // 1. Check token-BNB price ref
    if (refBNB != address(0)) {
      (, int256 _answer, , uint256 _updatedAt, ) = IAggregatorV3Interface(refBNB).latestRoundData();
      require(
        _updatedAt >= block.timestamp - maxDelayTime,
        "TokenChainlinkAggregator::latestAnswer::delayed update time"
      );
      return _answer;
    }

    // 2. Check token-USD price ref
    if (refUSD != address(0)) {
      (, int256 _answer, , uint256 _updatedAt, ) = IAggregatorV3Interface(refUSD).latestRoundData();
      require(
        _updatedAt >= block.timestamp - maxDelayTime,
        "TokenChainlinkAggregator::latestAnswer::delayed update time"
      );
      (, int256 _bnbAnswer, , uint256 _bnbUpdatedAt, ) = IAggregatorV3Interface(refBNBUSD).latestRoundData();
      require(
        _bnbUpdatedAt >= block.timestamp - maxDelayTime,
        "TokenChainlinkAggregator::latestAnswer::delayed bnb-usd update time"
      );

      if (_decimals > 18) {
        return int256(((_answer.toUint256() * 1e18) / (_bnbAnswer.toUint256())) / (10**(_decimals - 18)));
      }

      return int256((_answer.toUint256() * 1e18 * (10**(18 - _decimals))) / (_bnbAnswer.toUint256()));
    }

    revert("TokenChainlinkAggregator::latestAnswer::no valid price reference for token");
  }
}
