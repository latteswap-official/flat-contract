// SPDX-License-Identifier: GPL-3.0

/**
  |¯¯¯¯¯|||¯¯¯¯|  '      /¯¯¯¯¯| |¯¯¯¯¯|°
  |    ¯¯|  |       |__   /     !     | |         | 
  |__|¯¯'  |______| /___/¯|__'|  ¯|__|¯  
 */

pragma solidity 0.8.9;
pragma experimental ABIEncoderV2;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "./interfaces/IFlatMarketConfig.sol";

contract FlatMarketConfig is IFlatMerketConfig, OwnableUpgradeable {
  /// @notice Events
  event LogSetFeeTreasury(address _prevFeeTreasury, address _feeTreasury);
  event LogSetConfig(
    address _caller,
    address indexed _market,
    uint64 _maxCollateralRatio,
    uint64 _liquidationMultiplier,
    uint256 _interestPerSecond
  );

  /// @notice Config fro the FlatMarkets
  struct Config {
    uint64 maxCollateralRatio;
    uint64 liquidationMultiplier;
    uint256 interestPerSecond;
  }

  address public feeTreasury;
  mapping(address => Config) public configs;

  /// @notice The constructor is only used for the initial master contract.
  /// Subsequent clones are initialised via `init`.
  function initialize(address _feeTreasury) external initializer {
    OwnableUpgradeable.__Ownable_init();
    feeTreasury = _feeTreasury;
  }

  /// @notice Return interestPerSecond of the given market
  /// @param _flatMarket The market address
  function interestPerSecond(address _flatMarket) external view returns (uint256) {
    return configs[_flatMarket].interestPerSecond;
  }

  /// @notice Return the liquidationMultiplier of the given market
  /// @param _flatMarket The market address
  function liquidationMultiplier(address _flatMarket) external view returns (uint256) {
    return uint256(configs[_flatMarket].liquidationMultiplier);
  }

  /// @notice Return the maxCollateralRatio of the given market
  /// @param _flatMarket The market address
  function maxCollateralRatio(
    address _flatMarket,
    address /* _user */
  ) external view returns (uint256) {
    return uint256(configs[_flatMarket].maxCollateralRatio);
  }

  /// @notice Set the config for markets
  /// @param _markets The markets addresses
  /// @param _configs Configs for each market
  function setConfig(address[] calldata _markets, Config[] calldata _configs) external onlyOwner {
    uint256 _len = _markets.length;
    require(_len == _configs.length, "bad len");
    for (uint256 i = 0; i < _len; i++) {
      require(
        _configs[i].maxCollateralRatio >= 5000 && _configs[i].maxCollateralRatio <= 9500,
        "bad maxCollateralRatio"
      );
      configs[_markets[i]] = Config({
        maxCollateralRatio: _configs[i].maxCollateralRatio,
        liquidationMultiplier: _configs[i].liquidationMultiplier,
        interestPerSecond: _configs[i].interestPerSecond
      });
      emit LogSetConfig(
        msg.sender,
        _markets[i],
        _configs[i].maxCollateralRatio,
        _configs[i].liquidationMultiplier,
        _configs[i].interestPerSecond
      );
    }
  }

  /// @notice Set the feeTreasury
  /// @param _feeTreasury The feeTreasury address
  function setFeeTreasury(address _feeTreasury) external onlyOwner {
    require(_feeTreasury != address(0), "bad _feeTreasury");

    address _prevFeeTreasury = feeTreasury;
    feeTreasury = _feeTreasury;

    emit LogSetFeeTreasury(_prevFeeTreasury, _feeTreasury);
  }
}
