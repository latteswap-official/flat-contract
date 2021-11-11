// SPDX-License-Identifier: GPL-3.0

pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "../interfaces/IMasterBarista.sol";
import "../interfaces/IBooster.sol";
import "./SimpleToken.sol";

contract MockMasterBaristaForLatteSwapYield is IMasterBarista {
  /// @dev functions return information. no states changed.

  // Info of each user.
  struct UserInfo {
    uint256 amount; // How many Staking tokens the user has provided.
    uint256 rewardDebt; // Reward debt. See explanation below.
    uint256 bonusDebt; // Last block that user exec something to the pool.
    address fundedBy;
  }

  mapping(address => mapping(address => UserInfo)) public override userInfo;

  function poolLength() external view returns (uint256) {}

  function pendingLatte(address _stakeToken, address _user) external view returns (uint256) {}

  function setUserInfo(
    address _token,
    address _for,
    uint256 _amount,
    uint256 _rewardDebt,
    uint256 _bonusDebt,
    address _fundedBy
  ) external {
    userInfo[_for][_token] = UserInfo({
      amount: _amount,
      rewardDebt: _rewardDebt,
      bonusDebt: _bonusDebt,
      fundedBy: _fundedBy
    });
  }

  function devAddr() external view returns (address) {}

  function devFeeBps() external view returns (uint256) {}

  /// @dev configuration functions
  function addPool(address _stakeToken, uint256 _allocPoint) external {}

  function setPool(address _stakeToken, uint256 _allocPoint) external {}

  function updatePool(address _stakeToken) external {}

  function removePool(address _stakeToken) external {}

  /// @dev user interaction functions
  function deposit(
    address _for,
    address _stakeToken,
    uint256 _amount
  ) external {}

  function withdraw(
    address _for,
    address _stakeToken,
    uint256 _amount
  ) external {}

  function depositLatte(address _for, uint256 _amount) external {}

  function withdrawLatte(address _for, uint256 _amount) external {}

  function depositLatteV2(address _for, uint256 _amount) external {}

  function withdrawLatteV2(address _for, uint256 _amount) external {}

  function harvest(address _for, address _stakeToken) external {}

  function harvest(address _for, address[] calldata _stakeToken) external {}

  function emergencyWithdraw(address _for, address _stakeToken) external {}

  function mintExtraReward(
    address _stakeToken,
    address _to,
    uint256 _amount,
    uint256 _lastRewardBlock
  ) external {}
}

contract MockBoosterForLatteSwapYield is IBooster {
  using SafeERC20 for IERC20;

  address public masterBarista;
  address public latte;

  uint256 public stakeRewardReturned;

  constructor(address _masterBarista, SimpleToken _latte) {
    masterBarista = _masterBarista;
    latte = address(_latte);
  }

  function setStakeRewardReturned(uint256 _amount) public {
    stakeRewardReturned = _amount;
  }

  function stake(address _stakeToken, uint256 _amount) external {
    IERC20(latte).safeTransfer(msg.sender, stakeRewardReturned);
    setStakeRewardReturned(0);

    IERC20(_stakeToken).safeTransferFrom(msg.sender, address(this), _amount);
  }

  function unstake(address _stakeToken, uint256 _amount) external {
    IERC20(latte).safeTransfer(msg.sender, stakeRewardReturned);
    setStakeRewardReturned(0);

    IERC20(_stakeToken).safeTransfer(msg.sender, _amount);
  }

  function harvest(address _stakeToken) external {
    IERC20(latte).safeTransfer(msg.sender, stakeRewardReturned);
    setStakeRewardReturned(0);
  }

  function emergencyWithdraw(address _stakeToken) external {
    setStakeRewardReturned(0);
    IERC20(_stakeToken).safeTransfer(msg.sender, IERC20(_stakeToken).balanceOf(address(this)));
  }
}
