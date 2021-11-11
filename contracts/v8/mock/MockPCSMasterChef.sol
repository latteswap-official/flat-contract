// SPDX-License-Identifier: GPL-3.0

pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import "./SimpleToken.sol";

import "../interfaces/IPancakeMasterChef.sol";

contract MockPCSMasterchef is IPancakeMasterChef {
  using SafeERC20 for IERC20;

  // Info of each user.
  struct UserInfo {
    uint256 amount; // How many LP tokens the user has provided.
    uint256 rewardDebt; // Reward debt. See explanation below.
  }

  // Info of each pool.
  struct PoolInfo {
    IERC20 lpToken; // Address of LP token contract.
    uint256 allocPoint; // How many allocation points assigned to this pool. SUSHIs to distribute per block.
    uint256 lastRewardBlock; // Last block number that SUSHIs distribution occurs.
    uint256 accCakePerShare; // Accumulated SUSHIs per share, times 1e12. See below.
  }

  address public masterBarista;
  address public _stakeToken;
  address public cake;

  uint256 public stakeRewardReturned;

  mapping(uint256 => PoolInfo) public override poolInfo;
  // Info of each user that stakes LP tokens.
  mapping(uint256 => mapping(address => UserInfo)) public override userInfo;

  constructor(SimpleToken _cake, address _stakingToken) {
    cake = address(_cake);
    _stakeToken = _stakingToken;
  }

  function setStakeRewardReturned(uint256 _amount) public {
    stakeRewardReturned = _amount;
  }

  function deposit(uint256 _pid, uint256 _amount) external override {
    IERC20(cake).safeTransfer(msg.sender, stakeRewardReturned);
    setStakeRewardReturned(0);

    IERC20(_stakeToken).safeTransferFrom(msg.sender, address(this), _amount);
  }

  function withdraw(uint256 _pid, uint256 _amount) external override {
    IERC20(cake).safeTransfer(msg.sender, stakeRewardReturned);
    setStakeRewardReturned(0);

    IERC20(_stakeToken).safeTransfer(msg.sender, _amount);
  }

  function pendingCake(uint256 _pid, address _user) external view override returns (uint256) {
    return 0;
  }

  // Deposit cake to the pool (0)
  function enterStaking(uint256 _amount) external override {}

  // Withdraw cake from the pool
  function leaveStaking(uint256 _amount) external override {}

  function emergencyWithdraw(uint256 _pid) public override {
    setStakeRewardReturned(0);
    IERC20(_stakeToken).safeTransfer(msg.sender, IERC20(_stakeToken).balanceOf(address(this)));
  }
}
