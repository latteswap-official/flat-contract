// SPDX-License-Identifier: MIT
/**
  |¯¯¯¯¯|||¯¯¯¯|  '      /¯¯¯¯¯| |¯¯¯¯¯|°
  |    ¯¯|  |       |__   /     !     | |         | 
  |__|¯¯'  |______| /___/¯|__'|  ¯|__|¯  
*/

pragma solidity 0.8.9;
pragma experimental ABIEncoderV2;

import "@openzeppelin/contracts-upgradeable/token/ERC20/IERC20Upgradeable.sol";

import "../libraries/LatteConversion.sol";
import "./IStrategy.sol";

/// @title Clerk contract interface for managing the fund, as well as yield farming
interface IClerk {
  event LogDeposit(
    IERC20Upgradeable indexed token,
    address indexed from,
    address indexed to,
    uint256 amount,
    uint256 share
  );
  event LogWithdraw(
    IERC20Upgradeable indexed token,
    address indexed from,
    address indexed to,
    uint256 amount,
    uint256 share
  );
  event LogTransfer(IERC20Upgradeable indexed token, address indexed from, address indexed to, uint256 share);
  event LogStrategyTargetBps(IERC20Upgradeable indexed token, uint256 targetBps);
  event LogStrategyQueued(IERC20Upgradeable indexed token, IStrategy indexed strategy);
  event LogStrategySet(IERC20Upgradeable indexed token, IStrategy indexed strategy);
  event LogStrategyDeposit(IERC20Upgradeable indexed token, uint256 amount);
  event LogStrategyWithdraw(IERC20Upgradeable indexed token, uint256 amount);
  event LogStrategyProfit(IERC20Upgradeable indexed token, uint256 amount);
  event LogStrategyLoss(IERC20Upgradeable indexed token, uint256 amount);
  event LogWhiteListMarket(address indexed market, bool approved);
  event LogTokenToMarkets(address indexed market, address indexed token, bool approved);

  function balanceOf(IERC20Upgradeable, address) external view returns (uint256);

  function deposit(
    IERC20Upgradeable token_,
    address from,
    address to,
    uint256 amount,
    uint256 share
  ) external payable returns (uint256 amountOut, uint256 shareOut);

  function harvest(IERC20Upgradeable token) external;

  function harvest(IERC20Upgradeable[] memory tokens) external;

  function setStrategy(IERC20Upgradeable token, IStrategy newStrategy) external;

  function setStrategyTargetBps(IERC20Upgradeable token, uint64 targetBps) external;

  function strategy(IERC20Upgradeable) external view returns (IStrategy);

  function strategyData(IERC20Upgradeable) external view returns (uint64 targetBps, uint128 balance);

  function toAmount(
    IERC20Upgradeable token,
    uint256 share,
    bool roundUp
  ) external view returns (uint256 amount);

  function toShare(
    IERC20Upgradeable token,
    uint256 amount,
    bool roundUp
  ) external view returns (uint256 share);

  function totals(IERC20Upgradeable) external view returns (Conversion memory _totals);

  function transfer(
    IERC20Upgradeable token,
    address from,
    address to,
    uint256 share
  ) external;

  function transferMultiple(
    IERC20Upgradeable token,
    address from,
    address[] calldata tos,
    uint256[] calldata shares
  ) external;

  function whitelistMarket(address market, bool approved) external;

  function whitelistedMarkets(address) external view returns (bool);

  function withdraw(
    IERC20Upgradeable token_,
    address from,
    address to,
    uint256 amount,
    uint256 share
  ) external returns (uint256 amountOut, uint256 shareOut);
}
