// SPDX-License-Identifier: GPL-3.0

/**
  |¯¯¯¯¯|||¯¯¯¯|  '      /¯¯¯¯¯| |¯¯¯¯¯|°
  |    ¯¯|  |       |__   /     !     | |         | 
  |__|¯¯'  |______| /___/¯|__'|  ¯|__|¯  
 */

pragma solidity 0.8.9;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/IERC20Upgradeable.sol";

import "./interfaces/IClerk.sol";
import "./interfaces/IFlatMarket.sol";
import "./interfaces/ITreasuryHolder.sol";

/// @title TreasuryHolder is a contract that holds all revenue from markets, as well as manage a bad debt (if exists)
contract TreasuryHolder is OwnableUpgradeable, ITreasuryHolderCallback {
  // contracts binding
  address public treasuryEOA;
  IClerk public clerk;
  IERC20Upgradeable public flat;

  // contract states
  uint256 public priceDeviation;

  mapping(address => uint256) public badDebtMarkets;
  uint256 public totalBadDebtValue;

  event LogBadDebt(address indexed market, uint256 marketBadDebtValue);
  event LogSettleBadDebt(address indexed market, uint256 settleAmount);
  event LogWithdrawSurplus(address indexed to, uint256 share);
  event LogSetTreasuryEOA(address indexed treasuryEOA);

  /// @notice initialize function
  /// @param _treasuryEOA address of the EOA
  /// @param _clerk address of the Clerk
  function initialize(
    address _treasuryEOA,
    IClerk _clerk,
    IERC20Upgradeable _flat
  ) public initializer {
    OwnableUpgradeable.__Ownable_init();

    require(_treasuryEOA != address(0), "TreasuryHolder::initialize:: eoa cannot be address(0)");
    require(address(_clerk) != address(0), "TreasuryHolder::initialize:: clerk cannot be address(0");

    treasuryEOA = _treasuryEOA;
    clerk = _clerk;
    flat = _flat;
    priceDeviation = 1.5e18;
  }

  /// @notice modifier for checking if the market has been whitelisted by clerk
  modifier isWhitelisted() {
    require(clerk.whitelistedMarkets(_msgSender()), "TreasuryHolder::isWhitelisted:: market is not whitelisted");
    _;
  }

  function onBadDebt(uint256 _badDebtValue) external isWhitelisted {
    badDebtMarkets[_msgSender()] = badDebtMarkets[_msgSender()] + _badDebtValue;
    totalBadDebtValue = totalBadDebtValue + _badDebtValue;

    emit LogBadDebt(_msgSender(), badDebtMarkets[_msgSender()]);
  }

  /// @notice function to settle bad debts for each market if bad debt exists
  /// @param _markets array of markets
  function settleBadDebt(address[] calldata _markets) external onlyOwner {
    for (uint256 i = 0; i < _markets.length; i++) {
      require(badDebtMarkets[_markets[i]] > 0, "TreasuryHolder::settleBadDebt:: market is not in bad debt");

      uint256 _badDebt = badDebtMarkets[_markets[i]];
      totalBadDebtValue = totalBadDebtValue - _badDebt;
      badDebtMarkets[_markets[i]] = 0;

      uint256 _settleBadDebtShare = clerk.toShare(flat, _badDebt, false);
      clerk.transfer(flat, address(this), _markets[i], _settleBadDebtShare);

      emit LogBadDebt(_markets[i], _badDebt);
    }
  }

  /// @notice set treasuryEOA
  /// @param _treasuryEOA address of the EOA
  function setTreasuryEOA(address _treasuryEOA) external onlyOwner {
    require(_treasuryEOA != address(0), "TreasuryHolder::setTreasuryEOA:: eoa cannot be address(0)");
    treasuryEOA = _treasuryEOA;

    emit LogSetTreasuryEOA(treasuryEOA);
  }

  /// @notice function to withdraw a surplus + liquidation share to the EOA address
  function withdrawSurplus() external onlyOwner {
    require(totalBadDebtValue == 0, "TreasuryHolder::withdrawSurplus:: there are still bad debt markets");

    uint256 _balanceOf = clerk.balanceOf(flat, address(this));

    clerk.withdraw(flat, address(this), treasuryEOA, 0, _balanceOf);

    emit LogWithdrawSurplus(treasuryEOA, _balanceOf);
  }

  /// @notice function to withdraw a surplus + liquidation share the this contract
  /// @param _markets array of markets
  function collectSurplus(address[] calldata _markets) external onlyOwner {
    for (uint256 i = 0; i < _markets.length; i++) {
      IFlatMarket(_markets[i]).withdrawSurplus();
    }
  }
}
