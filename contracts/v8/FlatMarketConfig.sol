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
  event LogSetTreasury(address _prevFeeTreasury, address _feeTreasury);
  event LogSetConfig(
    address _caller,
    address indexed _market,
    uint64 _collateralFactor,
    uint64 _liquidationPenalty,
    uint64 _liquidationTreasuryBps,
    uint64 _minDebtSize,
    uint256 _interestPerSecond
  );

  /// @notice Config fro the FlatMarkets
  struct Config {
    uint64 collateralFactor;
    uint64 liquidationPenalty;
    uint64 liquidationTreasuryBps;
    uint64 minDebtSize;
    uint256 interestPerSecond;
  }

  address public treasury;

  mapping(address => Config) public configs;

  /// @notice The constructor is only used for the initial master contract.
  /// Subsequent clones are initialised via `init`.
  function initialize(address _treasury) external initializer {
    OwnableUpgradeable.__Ownable_init();

    treasury = _treasury;
  }

  /// @notice Return the collateralFactor of the given market
  /// @param _flatMarket The market address
  function collateralFactor(
    address _flatMarket,
    address /* _user */
  ) external view returns (uint256) {
    return uint256(configs[_flatMarket].collateralFactor);
  }

  /// @notice Return interestPerSecond of the given market
  /// @param _flatMarket The market address
  function interestPerSecond(address _flatMarket) external view returns (uint256) {
    return configs[_flatMarket].interestPerSecond;
  }

  /// @notice Return the liquidationPenalty of the given market
  /// @param _flatMarket The market address
  function liquidationPenalty(address _flatMarket) external view returns (uint256) {
    return uint256(configs[_flatMarket].liquidationPenalty);
  }

  /// @notice Return the liquidationPenalty of the given market
  /// @param _flatMarket The market address
  function liquidationTreasuryBps(address _flatMarket) external view returns (uint256) {
    return uint256(configs[_flatMarket].liquidationTreasuryBps);
  }

  /// @notice Return the minDebtSize of the given market
  /// @param _flatMarket The market address
  function minDebtSize(address _flatMarket) external view returns (uint256) {
    return uint256(configs[_flatMarket].minDebtSize);
  }

  /// @notice Set the config for markets
  /// @param _markets The markets addresses
  /// @param _configs Configs for each market
  function setConfig(address[] calldata _markets, Config[] calldata _configs) external onlyOwner {
    uint256 _len = _markets.length;
    require(_len == _configs.length, "bad len");
    for (uint256 i = 0; i < _len; i++) {
      require(_markets[i] != address(0), "bad market");
      require(_configs[i].collateralFactor >= 5000 && _configs[i].collateralFactor <= 9500, "bad collateralFactor");
      require(
        _configs[i].liquidationPenalty >= 10000 && _configs[i].liquidationPenalty <= 19000,
        "bad liquidityPenalty"
      );
      require(
        _configs[i].liquidationTreasuryBps >= 500 && _configs[i].liquidationTreasuryBps <= 2000,
        "bad liquidationTreasuryBps"
      );

      configs[_markets[i]] = Config({
        collateralFactor: _configs[i].collateralFactor,
        liquidationPenalty: _configs[i].liquidationPenalty,
        liquidationTreasuryBps: _configs[i].liquidationTreasuryBps,
        minDebtSize: _configs[i].minDebtSize,
        interestPerSecond: _configs[i].interestPerSecond
      });
      emit LogSetConfig(
        msg.sender,
        _markets[i],
        _configs[i].collateralFactor,
        _configs[i].liquidationPenalty,
        _configs[i].liquidationTreasuryBps,
        _configs[i].minDebtSize,
        _configs[i].interestPerSecond
      );
    }
  }

  /// @notice Set the treasury address
  /// @param _newTreasury The new treasury address
  function setTreasury(address _newTreasury) external onlyOwner {
    require(_newTreasury != address(0), "bad _newTreasury");

    address _prevTreasury = treasury;
    treasury = _newTreasury;

    emit LogSetTreasury(_prevTreasury, _newTreasury);
  }
}
