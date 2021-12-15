// SPDX-License-Identifier: MIT

/**
  |¯¯¯¯¯|||¯¯¯¯|  '      /¯¯¯¯¯| |¯¯¯¯¯|°
  |    ¯¯|  |       |__   /     !     | |         | 
  |__|¯¯'  |______| /___/¯|__'|  ¯|__|¯  
 */

pragma solidity 0.8.9;

import "@openzeppelin/contracts-upgradeable/token/ERC20/IERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/PausableUpgradeable.sol";

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import "../../interfaces/IStrategy.sol";
import "../../interfaces/IToken.sol";
import "../../interfaces/IPancakeMasterChef.sol";
import "../../libraries/WadRayMath.sol";

// solhint-disable not-rely-on-time

contract PCSYieldStrategy is IStrategy, OwnableUpgradeable, PausableUpgradeable, AccessControlUpgradeable {
  using WadRayMath for uint256;
  using SafeERC20Upgradeable for IERC20Upgradeable;

  // fee-related fields
  uint256 public treasuryFeeBps;
  address public treasuryAccount;

  // contract binding fields
  IERC20Upgradeable public rewardToken;
  IPancakeMasterChef public masterchef;
  IERC20Upgradeable public stakingToken;
  uint256 public pid;

  // periphery
  uint256 public decimals;
  uint256 internal to18ConversionFactor;

  /// @dev Rewards per collateralToken in RAY
  uint256 public accRewardPerShare;
  /// @dev Accummulate reward balance in WAD
  uint256 public accRewardBalance;

  /// @dev Mapping of user => rewardDebts
  mapping(address => uint256) public rewardDebts;

  bytes32 public constant GOVERNANCE_ROLE = keccak256("GOVERNANCE_ROLE");

  event LogSkim(uint256 amount);
  event LogPause();
  event LogUnpause();
  event LogUpdate(address indexed user, uint256 indexed newRewardDebt, uint256 indexed prevRewardDebt);

  modifier onlyGovernance() {
    require(hasRole(GOVERNANCE_ROLE, _msgSender()), "PCSYieldStrategy::onlyGovernance::only GOVERNANCE role");
    _;
  }

  function initialize(
    IPancakeMasterChef _masterchef,
    IERC20Upgradeable _stakingToken,
    uint256 _pid
  ) external initializer {
    OwnableUpgradeable.__Ownable_init();
    PausableUpgradeable.__Pausable_init();
    AccessControlUpgradeable.__AccessControl_init();
    masterchef = _masterchef;
    stakingToken = _stakingToken;
    pid = _pid;
    rewardToken = IERC20Upgradeable(masterchef.cake());
    decimals = IToken(address(_stakingToken)).decimals();
    to18ConversionFactor = 10**(18 - decimals);
    (IERC20 _lpToken, , , ) = masterchef.poolInfo(pid);
    require(
      address(_lpToken) == address(stakingToken),
      "PCSYieldStrategy::initialize::lpToken must be the same as stakingToken"
    ); // sanity check on staking token and pid

    _setupRole(DEFAULT_ADMIN_ROLE, _msgSender());
    _setupRole(GOVERNANCE_ROLE, _msgSender());
  }

  function setTreasuryFeeBps(uint256 _treasuryFeeBps) external onlyOwner {
    require(_treasuryFeeBps <= 5000, "PCSYieldStrategy::setTreasuryFeeBps:: treasury fee bps");
    treasuryFeeBps = _treasuryFeeBps;
  }

  function setTreasuryAccount(address _treasuryAccount) external onlyOwner {
    require(_treasuryAccount != address(0), "PCSYieldStrategy::setTreasuryAccount:: treasury account");
    treasuryAccount = _treasuryAccount;
  }

  // Send the assets to the Strategy and call skim to invest them
  function deposit(bytes calldata _data) external override onlyGovernance whenNotPaused {
    (uint256 _amount, address _sender, , uint256 _stake) = abi.decode(_data, (uint256, address, uint256, uint256));
    // turns amount with n decimal into WAD
    uint256 _share = (_amount * to18ConversionFactor).wdiv(WadRayMath.WAD); // [wad] convert amount of staking token with vary decimal points
    // Overflow check for int256(wad) cast below
    // Also enforces a non-zero wad
    require(int256(_share) > 0, "PCSYieldStrategy::deposit:: share overflow");

    rewardDebts[_sender] = _stake.rmulup(accRewardPerShare);

    stakingToken.safeApprove(address(masterchef), _share);
    masterchef.deposit(pid, _share);
    stakingToken.safeApprove(address(masterchef), uint256(0));

    emit LogSkim(_amount);
  }

  // Harvest any profits made converted to the asset and pass them to the caller
  function harvest(bytes calldata _data) public override onlyGovernance whenNotPaused returns (int256 _amountAdded) {
    (, address _sender, uint256 _totalShare, uint256 _stake) = abi.decode(_data, (uint256, address, uint256, uint256));
    _harvest(_sender, _totalShare, _stake);
    return 0;
  }

  function _harvest(
    address _user,
    uint256 _totalShare,
    uint256 _stake
  ) internal {
    (uint256 _stakedBalance, ) = masterchef.userInfo(pid, address(this));

    if (_stakedBalance > 0) masterchef.withdraw(pid, 0); // harvest
    uint256 _allRewards = rewardToken.balanceOf(address(this)) - accRewardBalance;

    if (_totalShare > 0) accRewardPerShare = accRewardPerShare + (_allRewards.rdiv(_totalShare));

    uint256 _rewardDebt = rewardDebts[_user];
    uint256 _rewards = _stake.rmul(accRewardPerShare);

    if (_rewards > _rewardDebt) {
      rewardDebts[_user] = _rewards;

      uint256 _back = _rewards - (_rewardDebt);
      uint256 _treasuryFee = (_back * treasuryFeeBps) / 1e4;

      rewardToken.safeTransfer(treasuryAccount, _treasuryFee);
      rewardToken.safeTransfer(_user, _back - _treasuryFee);
    }

    accRewardBalance = rewardToken.balanceOf(address(this));
  }

  // Withdraw assets. The returned amount can differ from the requested amount due to rounding or if the request was more than there is.
  function withdraw(bytes calldata _data)
    external
    override
    onlyGovernance
    whenNotPaused
    returns (uint256 _actualAmount)
  {
    (uint256 _amount, address _sender, , uint256 _stake) = abi.decode(_data, (uint256, address, uint256, uint256));

    // turns amount with n decimal into WAD
    uint256 _share = (_amount * to18ConversionFactor).wdivup(WadRayMath.WAD); // [wad]
    // Overflow check for int256(wad) cast below
    // Also enforces a non-zero wad
    require(int256(_share) > 0, "PCSYieldStrategy::withdraw:: share overflow");

    rewardDebts[_sender] = _stake.rmulup(accRewardPerShare);

    masterchef.withdraw(pid, _share);
    stakingToken.safeTransfer(_msgSender(), _amount);

    return _amount;
  }

  // Withdraw all assets in the safest way possible. This shouldn't fail.
  function exit(uint256 balance) external override onlyGovernance whenNotPaused returns (int256 _amountAdded) {
    masterchef.emergencyWithdraw(pid);

    uint256 _stakingBalance = stakingToken.balanceOf(address(this));

    stakingToken.safeTransfer(_msgSender(), _stakingBalance);

    return int256(_stakingBalance - balance);
  }

  /**
   * @notice Triggers stopped state
   * @dev Only possible when contract not paused.
   */
  function pause() external onlyGovernance whenNotPaused {
    _pause();
    emit LogPause();
  }

  // Update is an adhoc function for a special update notified by the caller of this strategy
  function update(bytes calldata _data) external override onlyGovernance whenNotPaused {
    (address _from, address _to, uint256 _newFromStake, uint256 _newToStake) = abi.decode(
      _data,
      (address, address, uint256, uint256)
    );
    uint256 _fromRewardDebts = rewardDebts[_from];
    uint256 _toRewardDebts = rewardDebts[_to];
    rewardDebts[_from] = _newFromStake.rmulup(accRewardPerShare);
    rewardDebts[_to] = _newToStake.rmulup(accRewardPerShare);

    emit LogUpdate(_from, rewardDebts[_from], _fromRewardDebts);
    emit LogUpdate(_to, rewardDebts[_to], _toRewardDebts);
  }

  /**
   * @notice Returns to normal state
   * @dev Only possible when contract is paused.
   */
  function unpause() external onlyGovernance whenPaused {
    _unpause();
    emit LogUnpause();
  }
}
