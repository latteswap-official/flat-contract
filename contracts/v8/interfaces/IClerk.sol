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
import "./IBatchFlashBorrower.sol";
import "./IFlashBorrower.sol";
import "./IStrategy.sol";

interface IClerk {
  event LogDeposit(address indexed token, address indexed from, address indexed to, uint256 amount, uint256 share);
  event LogFlashLoan(
    address indexed borrower,
    address indexed token,
    uint256 amount,
    uint256 feeAmount,
    address indexed receiver
  );
  event LogRegisterProtocol(address indexed protocol);
  event LogSetMasterContractApproval(address indexed masterContract, address indexed user, bool approved);
  event LogStrategyDivest(address indexed token, uint256 amount);
  event LogStrategyInvest(address indexed token, uint256 amount);
  event LogStrategyLoss(address indexed token, uint256 amount);
  event LogStrategyProfit(address indexed token, uint256 amount);
  event LogStrategyQueued(address indexed token, address indexed strategy);
  event LogStrategySet(address indexed token, address indexed strategy);
  event LogStrategyTargetPercentage(address indexed token, uint256 targetPercentage);
  event LogTransfer(address indexed token, address indexed from, address indexed to, uint256 share);
  event LogWhiteListMasterContract(address indexed masterContract, bool approved);
  event LogWithdraw(address indexed token, address indexed from, address indexed to, uint256 amount, uint256 share);
  event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

  function balanceOf(IERC20Upgradeable, address) external view returns (uint256);

  function batchFlashLoan(
    IBatchFlashBorrower borrower,
    address[] calldata receivers,
    IERC20Upgradeable[] calldata tokens,
    uint256[] calldata amounts,
    bytes calldata data
  ) external;

  function claimOwnership() external;

  function deposit(
    IERC20Upgradeable token_,
    address from,
    address to,
    uint256 amount,
    uint256 share
  ) external payable returns (uint256 amountOut, uint256 shareOut);

  function flashLoan(
    IFlashBorrower borrower,
    address receiver,
    IERC20Upgradeable token,
    uint256 amount,
    bytes calldata data
  ) external;

  function harvest(
    IERC20Upgradeable token,
    bool balance,
    uint256 maxChangeAmount
  ) external;

  function masterContractApproved(address, address) external view returns (bool);

  function masterContractOf(address) external view returns (address);

  function nonces(address) external view returns (uint256);

  function owner() external view returns (address);

  function pendingOwner() external view returns (address);

  function pendingStrategy(IERC20Upgradeable) external view returns (IStrategy);

  function registerProtocol() external;

  function setMasterContractApproval(
    address user,
    address masterContract,
    bool approved,
    uint8 v,
    bytes32 r,
    bytes32 s
  ) external;

  function setStrategy(IERC20Upgradeable token, IStrategy newStrategy) external;

  function setStrategyTargetPercentage(IERC20Upgradeable token, uint64 targetPercentage_) external;

  function strategy(IERC20Upgradeable) external view returns (IStrategy);

  function strategyData(IERC20Upgradeable)
    external
    view
    returns (
      uint64 strategyStartDate,
      uint64 targetPercentage,
      uint128 balance
    );

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

  function totals(IERC20Upgradeable) external view returns (Conversion memory totals_);

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

  function transferOwnership(
    address newOwner,
    bool direct,
    bool renounce
  ) external;

  function whitelistMasterContract(address masterContract, bool approved) external;

  function whitelistedMasterContracts(address) external view returns (bool);

  function withdraw(
    IERC20Upgradeable token_,
    address from,
    address to,
    uint256 amount,
    uint256 share
  ) external returns (uint256 amountOut, uint256 shareOut);
}
