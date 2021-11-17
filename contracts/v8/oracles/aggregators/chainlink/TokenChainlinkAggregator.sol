// SPDX-License-Identifier: MIT

/**
  |¯¯¯¯¯|||¯¯¯¯|  '      /¯¯¯¯¯| |¯¯¯¯¯|°
  |    ¯¯|  |       |__   /     !     | |         | 
  |__|¯¯'  |______| /___/¯|__'|  ¯|__|¯  
 */

pragma solidity 0.8.9;

import "@openzeppelin/contracts-upgradeable/utils/math/SafeCastUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";

import "../../../interfaces/IChainlinkAggregator.sol";
import "../../../interfaces/IAggregatorV3Interface.sol";
import "../../../interfaces/IChainlinkDetailedERC20.sol";

contract TokenChainlinkAggregator is IChainlinkAggregator, OwnableUpgradeable {
  using SafeCastUpgradeable for int256;

  event LogSetRefBNB(address ref);
  event LogSetRefUSD(address ref);
  event LogSetMaxDelayTime(uint256 maxDelayTime);
  event LogSetRefBNBUSD(address ref);

  address public wbnb; // wbnb
  address public refBNBUSD; // BNB-USD price reference
  address public refBNB; // BNB price reference
  address public refUSD; // USD price reference
  uint256 public maxDelayTime; // max delay time

  function initialize(address _wbnb, address _refBNBUSD) external initializer {
    OwnableUpgradeable.__Ownable_init();

    wbnb = _wbnb;
    refBNBUSD = _refBNBUSD;
  }

  /// @dev Set price reference for BNB pair
  /// @param _ref list of reference contract addresses
  function setRefBNB(address _ref) external onlyOwner {
    refBNB = _ref;
    emit LogSetRefBNB(_ref);
  }

  /// @dev Set price reference for USD pair
  /// @param _ref list of reference contract addresses
  function setRefUSD(address _ref) external onlyOwner {
    refUSD = _ref;
    emit LogSetRefUSD(_ref);
  }

  /// @dev Set max delay time for each token
  /// @param _maxDelay list of max delay times to set to
  function setMaxDelayTime(uint256 _maxDelay) external onlyOwner {
    maxDelayTime = _maxDelay;
    emit LogSetMaxDelayTime(_maxDelay);
  }

  /// @dev Set BNB-USD to the new reference
  /// @param _refBNBUSD The new BNB-USD reference address to set to
  function setRefBNBUSD(address _refBNBUSD) external onlyOwner {
    refBNBUSD = _refBNBUSD;
    emit LogSetRefBNBUSD(_refBNBUSD);
  }

  /// @dev Return token price in  representing token value in USD with 18 decimals
  function latestAnswer() external view override returns (int256) {
    require(maxDelayTime != 0, "TokenChainlinkAggregator::latestAnswer::max delay time not set");

    // 2. Check token-USD price ref
    if (refUSD != address(0)) {
      uint256 _refUSDDecimal = IAggregatorV3Interface(refUSD).decimals();
      (, int256 _answer, , uint256 _updatedAt, ) = IAggregatorV3Interface(refUSD).latestRoundData();
      require(
        _updatedAt >= block.timestamp - maxDelayTime,
        "TokenChainlinkAggregator::latestAnswer::delayed update time"
      );
      return int256(_answer.toUint256() * (10**(18 - _refUSDDecimal)));
    }

    // 1. Check token-BNB price ref
    if (refBNB != address(0)) {
      uint256 _refBNBDecimal = IAggregatorV3Interface(refBNB).decimals();
      uint256 _refBNBUSDDecimal = IAggregatorV3Interface(refBNBUSD).decimals();

      (, int256 _answer, , uint256 _updatedAt, ) = IAggregatorV3Interface(refBNB).latestRoundData();
      require(
        _updatedAt >= block.timestamp - maxDelayTime,
        "TokenChainlinkAggregator::latestAnswer::delayed update time"
      );

      (, int256 _bnbAnswer, , uint256 _bnbUpdatedAt, ) = IAggregatorV3Interface(refBNBUSD).latestRoundData();
      require(
        _bnbUpdatedAt >= block.timestamp - maxDelayTime,
        "TokenChainlinkAggregator::latestAnswer::delayed bnb-usd update time"
      );

      return
        int256(
          (_answer.toUint256() * _bnbAnswer.toUint256() * 10**(18 - _refBNBUSDDecimal) * 10**(18 - _refBNBDecimal)) /
            1e18
        );
    }

    revert("TokenChainlinkAggregator::latestAnswer::no valid price reference for token");
  }
}
