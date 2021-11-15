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

/// @title TreasuryHolder is a contract that holds all revenue from markets, as well as manage a bad debt (if exists)
contract TreasuryHolder is OwnableUpgradeable {
  // contracts binding
  address public treasuryEOA;
  IClerk public clerk;
  IERC20Upgradeable public flat;

  // contract states
  uint256 public badDebtMarketCount;
  uint256 public priceDeviation;

  mapping(address => bool) public badDebtMarkets;

  event LogBadDebt(address indexed market, bool isHavingBadDebt, uint256 marketCount);
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

  function onBadDebt() external isWhitelisted {
    if (!badDebtMarkets[_msgSender()]) {
      badDebtMarkets[_msgSender()] = true;
      badDebtMarketCount++;

      emit LogBadDebt(_msgSender(), true, badDebtMarketCount);
    }
  }

  /// @notice function to settle bad debts for each market if bad debt exists
  /// @param _markets array of markets
  function settleBadDebt(address[] calldata _markets) external onlyOwner {
    for (uint256 i = 0; i < _markets.length; i++) {
      require(badDebtMarkets[_markets[i]], "TreasuryHolder::settleBadDebt:: market is not in bad debt");

      badDebtMarkets[_markets[i]] = false;
      badDebtMarketCount--;

      IFlatMarket _flatMarket = IFlatMarket(_markets[i]);

      _flatMarket.repay(address(this), _flatMarket.userDebtShare(address(this)));

      emit LogBadDebt(_markets[i], false, badDebtMarketCount);
    }
  }

  /// @notice set treasuryEOA
  /// @param _treasuryEOA address of the EOA
  function setTreasuryEOA(address _treasuryEOA) external onlyOwner {
    treasuryEOA = _treasuryEOA;

    emit LogSetTreasuryEOA(treasuryEOA);
  }

  /// @notice function to withdraw a surplus + liquidation share to the EOA address
  function withdrawSurplus() external onlyOwner {
    require(badDebtMarketCount == 0, "TreasuryHolder::withdrawSurplus:: there are still bad debt markets");
    require(treasuryEOA != address(0), "TreasuryHolder::withdrawSurplus:: treasuryEOA is address(0)");

    uint256 _balanceOf = clerk.balanceOf(flat, address(this));

    clerk.transfer(flat, address(this), treasuryEOA, _balanceOf);

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
