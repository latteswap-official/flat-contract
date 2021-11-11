// SPDX-License-Identifier: MIT

pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

// Making the original MasterChef as an interface leads to compilation fail.
// Use Contract instead of Interface here
interface IPancakeMasterChef {
  function cake() external view returns (address);

  function poolInfo(uint256 _poolId)
    external
    view
    returns (
      IERC20 lpToken,
      uint256 allocPoint,
      uint256 lastRewardBlock,
      uint256 accCakePerShare
    );

  function userInfo(uint256 _poolId, address _user) external view returns (uint256 amount, uint256 rewardDebt);

  // Deposit LP tokens to MasterChef for SUSHI allocation.
  function deposit(uint256 _pid, uint256 _amount) external;

  // Withdraw LP tokens from MasterChef.
  function withdraw(uint256 _pid, uint256 _amount) external;

  function pendingCake(uint256 _pid, address _user) external view returns (uint256);

  // Deposit cake to the pool (0)
  function enterStaking(uint256 _amount) external;

  // Withdraw cake from the pool
  function leaveStaking(uint256 _amount) external;

  function emergencyWithdraw(uint256 _pid) external;
}
