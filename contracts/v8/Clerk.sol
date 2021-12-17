// SPDX-License-Identifier: GPL-3.0

/**
  |¯¯¯¯¯|||¯¯¯¯|  '      /¯¯¯¯¯| |¯¯¯¯¯|°
  |    ¯¯|  |       |__   /     !     | |         | 
  |__|¯¯'  |______| /___/¯|__'|  ¯|__|¯  
 */

// This contract stores funds, handles their transfers, supports yield trategies.

pragma solidity 0.8.9;
pragma experimental ABIEncoderV2;

import "@openzeppelin/contracts-upgradeable/token/ERC20/IERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/math/SafeCastUpgradeable.sol";

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/structs/EnumerableSetUpgradeable.sol";

import "./interfaces/IWBNB.sol";
import "./interfaces/IStrategy.sol";
import "./interfaces/IClerk.sol";

import "./interfaces/IFlatMarket.sol";

import "./libraries/LatteConversion.sol";

// solhint-disable avoid-low-level-calls
// solhint-disable not-rely-on-time

/// @title Clerk
/// @notice The Clerk is the contract that act like a vault for managing funds.
/// it is also capable of handling loans and strategies.
/// Any funds transfered directly onto the Clerk will be LOST, use the deposit function instead.
contract Clerk is IClerk, OwnableUpgradeable {
  using SafeERC20Upgradeable for IERC20Upgradeable;
  using SafeCastUpgradeable for uint256;
  using LatteConversion for Conversion;
  using EnumerableSetUpgradeable for EnumerableSetUpgradeable.AddressSet;

  /// @notice market to whitelisted state for approval
  mapping(address => bool) public override whitelistedMarkets;
  /// @notice if the market has been whitelisted it will be set into tokenToMarkets
  mapping(address => EnumerableSetUpgradeable.AddressSet) private tokenToMarkets;

  struct StrategyData {
    uint64 targetBps;
    uint128 balance; // the balance of the strategy that Clerk thinks is in there
  }

  IERC20Upgradeable public wbnbToken;

  uint256 private constant FLASH_LOAN_FEE = 50; // 0.05%
  uint256 private constant FLASH_LOAN_FEE_PRECISION = 1e5;
  uint256 private constant MAX_TARGET_BPS = 10000; // 100%
  uint256 private constant MINIMUM_SHARE_BALANCE = 1000; // To prevent the ratio going off from tiny share

  // Balance per token per address/contract in shares
  mapping(IERC20Upgradeable => mapping(address => uint256)) public override balanceOf;

  // Rebase from amount to share
  mapping(IERC20Upgradeable => Conversion) internal _totals;

  mapping(IERC20Upgradeable => IStrategy) public override strategy;
  mapping(IERC20Upgradeable => StrategyData) public override strategyData;

  function initialize(address _wbnbToken) public initializer {
    OwnableUpgradeable.__Ownable_init();

    require(_wbnbToken != address(0), "Clerk::initialize:: wbnb token cannot be address(0)");

    wbnbToken = IERC20Upgradeable(_wbnbToken);
  }

  /// Modifier to check if the msg.sender is allowed to use funds
  modifier allowed(address _from, IERC20Upgradeable _token) {
    if (tokenToMarkets[address(_token)].length() == 0) {
      if (!whitelistedMarkets[msg.sender]) {
        require(_from == msg.sender, "Clerk::allowed:: msg.sender != from");
      }
      _;
      return;
    }
    require(
      tokenToMarkets[address(_token)].contains(msg.sender) && whitelistedMarkets[msg.sender],
      "Clerk::allowed:: invalid market"
    );
    _;
  }

  /// @dev Returns the total balance of `token` this contracts holds,
  /// plus the total amount this contract THINKS the strategy holds. (which is kept in strategyData)
  function _balanceOf(IERC20Upgradeable _token) internal view returns (uint256 amount) {
    amount = _token.balanceOf(address(this)) + (strategyData[_token].balance);
  }

  function totals(IERC20Upgradeable _token) external view returns (Conversion memory) {
    return _totals[_token];
  }

  /// @dev wrap the token if the sent token is a native, otherwise just do safeTransferFrom
  function _safeWrap(
    address _from,
    IERC20Upgradeable _token,
    uint256 _amount
  ) internal {
    if (msg.value != 0) {
      require(address(_token) == address(wbnbToken), "Clerk::_safeWrap:: baseToken is not wNative");
      require(_amount == msg.value, "Clerk::_safeWrap:: value != msg.value");
      IWBNB(address(wbnbToken)).deposit{ value: msg.value }();
      return;
    }
    _token.safeTransferFrom(_from, address(this), _amount);
  }

  /// @dev uwrap the token if the sent token is a native, otherwise just do safeTransfer back to the _to
  function _safeUnwrap(
    IERC20Upgradeable _token,
    address _to,
    uint256 _amount
  ) internal {
    if (address(_token) == address(wbnbToken)) {
      IWBNB(address(wbnbToken)).withdraw(_amount);
      (bool _success, ) = _to.call{ value: _amount }("");
      require(_success, "Clerk::withdraw:: BNB transfer failed");
      return;
    }
    _token.safeTransfer(_to, _amount);
  }

  /// @dev Helper function to represent an `amount` of `token` in shares.
  /// @param _token The ERC-20 token.
  /// @param _amount The `token` amount.
  /// @param _roundUp If the result `share` should be rounded up.
  /// @return share The token amount represented in shares.
  function toShare(
    IERC20Upgradeable _token,
    uint256 _amount,
    bool _roundUp
  ) external view override returns (uint256 share) {
    share = _totals[_token].toShare(_amount, _roundUp);
  }

  /// @dev Helper function represent shares back into the `token` amount.
  /// @param _token The ERC-20 token.
  /// @param _share The amount of shares.
  /// @param _roundUp If the result should be rounded up.
  /// @return amount The share amount back into native representation.
  function toAmount(
    IERC20Upgradeable _token,
    uint256 _share,
    bool _roundUp
  ) external view override returns (uint256 amount) {
    amount = _totals[_token].toAmount(_share, _roundUp);
  }

  /// @notice Enables or disables a contract for approval
  function whitelistMarket(address _market, bool _approved) public override onlyOwner {
    // Checks
    require(_market != address(0), "MasterCMgr::whitelistMarket:: Cannot approve address 0");

    // Effects
    whitelistedMarkets[_market] = _approved;
    address _collateral = address(IFlatMarket(_market).collateral());

    if (_approved) {
      tokenToMarkets[_collateral].add(_market);
    } else {
      tokenToMarkets[_collateral].remove(_market);
    }

    emit LogTokenToMarkets(_market, _collateral, _approved);
    emit LogWhiteListMarket(_market, _approved);
  }

  /// @notice Deposit an amount of `token` represented in either `amount` or `share`.
  /// @param _token The ERC-20 token to deposit.
  /// @param _from which account to pull the tokens.
  /// @param _to which account to push the tokens.
  /// @param _amount Token amount in native representation to deposit.
  /// @param _share Token amount represented in shares to deposit. Takes precedence over `amount`.
  /// @return _amountOut The amount deposited.
  /// @return _shareOut The deposited amount repesented in shares.
  function deposit(
    IERC20Upgradeable _token,
    address _from,
    address _to,
    uint256 _amount,
    uint256 _share
  ) public payable override allowed(_from, _token) returns (uint256 _amountOut, uint256 _shareOut) {
    require(address(_token) != address(0), "Clerk::deposit:: token not set");
    require(_to != address(0), "Clerk::deposit:: to not set"); // To avoid a bad UI from burning funds
    // Harvest
    _harvest(_to, _token);

    Conversion memory _total = _totals[_token];
    // If a new token gets added, the tokenSupply call checks that this is a deployed contract. Needed for security.
    require(_total.amount != 0 || _token.totalSupply() > 0, "Clerk::deposit:: No tokens");
    if (_share == 0) {
      // value of the share may be lower than the amount due to rounding, that's ok
      _share = _total.toShare(_amount, false);
      // Any deposit should lead to at least the minimum share balance, otherwise it's ignored (no amount taken)
      if (_total.share + _share.toUint128() < MINIMUM_SHARE_BALANCE) {
        return (0, 0);
      }
    } else {
      // amount may be lower than the value of share due to rounding, in that case, add 1 to amount (Always round up)
      _amount = _total.toAmount(_share, true);
    }
    balanceOf[_token][_to] = balanceOf[_token][_to] + _share;
    _total.share = _total.share + _share.toUint128();
    _total.amount = _total.amount + _amount.toUint128();
    _totals[_token] = _total;

    _safeWrap(_from, _token, _amount);
    // does house keeping, either deposit or withdraw
    _houseKeeping(_to, _token);

    emit LogDeposit(_token, _from, _to, _amount, _share);
    _amountOut = _amount;
    _shareOut = _share;
  }

  /// @notice Withdraws an amount of `token` from a user account.
  /// @param _token The ERC-20 token to withdraw.
  /// @param _from which user to pull the tokens.
  /// @param _to which user to push the tokens.
  /// @param _amount of tokens. Either one of `amount` or `share` needs to be supplied.
  /// @param _share Like above, but `share` takes precedence over `amount`.
  function withdraw(
    IERC20Upgradeable _token,
    address _from,
    address _to,
    uint256 _amount,
    uint256 _share
  ) public override allowed(_from, _token) returns (uint256 _amountOut, uint256 _shareOut) {
    require(address(_token) != address(0), "Clerk::withdraw:: token not set");
    require(_to != address(0), "Clerk::withdraw:: to not set"); // To avoid a bad UI from burning funds

    // Harvest
    _harvest(_from, _token);

    Conversion memory _total = _totals[_token];
    if (_share == 0) {
      // value of the share paid could be lower than the amount paid due to rounding, in that case, add a share (Always round up)
      _share = _total.toShare(_amount, true);
    } else {
      // amount may be lower than the value of share due to rounding, that's ok
      _amount = _total.toAmount(_share, false);
    }

    balanceOf[_token][_from] = balanceOf[_token][_from] - _share;
    _total.amount = _total.amount - _amount.toUint128();
    _total.share = _total.share - _share.toUint128();
    // There have to be at least 1000 shares left to prevent reseting the share/amount ratio (unless it's fully emptied)
    require(_total.share >= MINIMUM_SHARE_BALANCE || _total.share == 0, "Clerk::withdraw:: cannot empty");
    _totals[_token] = _total;

    // does house keeping, either deposit or withdraw
    _houseKeeping(_from, _token);

    _safeUnwrap(_token, _to, _amount);

    emit LogWithdraw(_token, _from, _to, _amount, _share);
    _amountOut = _amount;
    _shareOut = _share;
  }

  /// @notice Transfer shares from a user account to another one.
  /// @param _token The ERC-20 token to transfer.
  /// @param _from which user to pull the tokens.
  /// @param _to which user to push the tokens.
  /// @param _share The amount of `token` in shares.
  function transfer(
    IERC20Upgradeable _token,
    address _from,
    address _to,
    uint256 _share
  ) public override allowed(_from, _token) {
    require(_to != address(0), "Clerk::transfer:: to not set"); // To avoid a bad UI from burning funds

    // Harvest reward (if any) for _from and _to
    _harvest(_from, _token);
    _harvest(_to, _token);

    balanceOf[_token][_from] = balanceOf[_token][_from] - _share;
    balanceOf[_token][_to] = balanceOf[_token][_to] + _share;

    _internalTransferUpdate(_token, _from, _to, balanceOf[_token][_from], balanceOf[_token][_to]);

    emit LogTransfer(_token, _from, _to, _share);
  }

  /// @notice Transfer shares from a user account to multiple other ones.
  /// @param _token The ERC-20 token to transfer.
  /// @param _from which user to pull the tokens.
  /// @param _tos The receivers of the tokens.
  /// @param _shares The amount of `token` in shares for each receiver in `tos`.
  function transferMultiple(
    IERC20Upgradeable _token,
    address _from,
    address[] calldata _tos,
    uint256[] calldata _shares
  ) public override allowed(_from, _token) {
    require(_tos[0] != address(0), "Clerk::transferMultiple:: to[0] not set"); // To avoid a bad UI from burning funds

    uint256 _totalAmount;
    uint256 _len = _tos.length;

    _harvest(_from, _token);

    for (uint256 i = 0; i < _len; i++) {
      _harvest(_tos[i], _token);
      address _to = _tos[i];
      balanceOf[_token][_to] = balanceOf[_token][_to] + _shares[i];
      _totalAmount = _totalAmount + _shares[i];
      emit LogTransfer(_token, _from, _to, _shares[i]);
    }
    balanceOf[_token][_from] = balanceOf[_token][_from] - _totalAmount;
  }

  /// @notice Sets the target percentage of the strategy for `token`.
  /// @dev Only the owner of this contract is allowed to change this.
  /// @param _token The address of the token that maps to a strategy to change.
  /// @param _targetBps The new target in percent. Must be lesser or equal to `MAX_TARGET_BPS`.
  function setStrategyTargetBps(IERC20Upgradeable _token, uint64 _targetBps) public override onlyOwner {
    require(_targetBps <= MAX_TARGET_BPS, "Clerk::setStrategyTargetBps:: Target too high");

    strategyData[_token].targetBps = _targetBps;
    emit LogStrategyTargetBps(_token, _targetBps);
  }

  /// @notice Sets the contract address of a new strategy that conforms to `IStrategy` for `token`.
  /// @param _token The address of the token that maps to a strategy to change.
  /// @param _newStrategy The address of the contract that conforms to `IStrategy`.
  function setStrategy(IERC20Upgradeable _token, IStrategy _newStrategy) public override onlyOwner {
    StrategyData memory _data = strategyData[_token];
    if (address(strategy[_token]) != address(0)) {
      int256 _balanceChange = strategy[_token].exit(_data.balance);
      if (_balanceChange > 0) {
        uint256 _add = uint256(_balanceChange);
        _totals[_token].addAmount(_add);
        emit LogStrategyProfit(_token, _add);
      } else if (_balanceChange < 0) {
        uint256 _sub = uint256(-_balanceChange);
        _totals[_token].subAmount(_sub);
        emit LogStrategyLoss(_token, _sub);
      }

      emit LogStrategyWithdraw(_token, _data.balance);
    }
    strategy[_token] = _newStrategy;
    _data.balance = 0;
    strategyData[_token] = _data;
  }

  /// @notice The actual process of yield farming. Executes the strategy of `token`.
  /// @param _token The address of the token for which a strategy is deployed.
  function harvest(IERC20Upgradeable _token) public override {
    _harvest(msg.sender, _token);
  }

  /// @notice Function for harvesting with specific tokens
  function harvest(IERC20Upgradeable[] memory _tokens) public override {
    uint256 _len = _tokens.length;
    for (uint256 i = 0; i < _len; i++) {
      _harvest(msg.sender, _tokens[i]);
    }
  }

  function _harvest(address _sender, IERC20Upgradeable _token) internal {
    StrategyData memory _data = strategyData[_token];
    IStrategy _strategy = strategy[_token];
    if (address(_strategy) == address(0)) return;
    int256 _balanceChange = _strategy.harvest(
      abi.encode(_data.balance, _sender, _totals[_token].share, balanceOf[_token][_sender])
    );

    if (_balanceChange == 0) {
      return;
    }

    uint256 _totalAmount = _totals[_token].amount;

    // if there is a balance from harvest, add it to amount, thus making 1 share = 1 +- balanceChange amount
    if (_balanceChange > 0) {
      uint256 _add = uint256(_balanceChange);
      _totalAmount = _totalAmount + _add;
      _totals[_token].amount = _totalAmount.toUint128();
      emit LogStrategyProfit(_token, _add);
    } else if (_balanceChange < 0) {
      uint256 _sub = uint256(-_balanceChange);
      _totalAmount = _totalAmount - _sub;
      _totals[_token].amount = _totalAmount.toUint128();
      _data.balance = _data.balance - _sub.toUint128();
      emit LogStrategyLoss(_token, _sub);
    }

    strategyData[_token] = _data;
  }

  /// @dev when transfer occurs, call the strategy to notify the update, in case that the yield strategy requires an update during a balance change
  function _internalTransferUpdate(
    IERC20Upgradeable _token,
    address _from,
    address _to,
    uint256 _fromNewBalance,
    uint256 _toNewBalance
  ) internal {
    IStrategy _strategy = strategy[_token];

    if (address(_strategy) == address(0)) return;
    _strategy.update(abi.encode(_from, _to, _fromNewBalance, _toNewBalance));
  }

  /// @dev function to either invest or withdraw from a strategy depending on a different of targetBalance and strategy balance
  function _houseKeeping(address _sender, IERC20Upgradeable _token) internal {
    StrategyData memory _data = strategyData[_token];
    IStrategy _strategy = strategy[_token];

    if (address(_strategy) == address(0)) return;

    uint256 _totalAmount = _totals[_token].amount;

    uint256 _targetBalance = (_totalAmount * _data.targetBps) / 1e4;

    // if data.balance == targetBalance there is nothing to update
    if (_data.balance < _targetBalance) {
      uint256 _amountOut = _targetBalance - _data.balance;

      _token.safeTransfer(address(_strategy), _amountOut);
      _data.balance = _data.balance + _amountOut.toUint128();
      _strategy.deposit(abi.encode(_amountOut, _sender, _totals[_token].share, balanceOf[_token][_sender]));

      emit LogStrategyDeposit(_token, _amountOut);
    } else if (_data.balance > _targetBalance) {
      uint256 _amountIn = _data.balance - _targetBalance.toUint128();

      uint256 _actualAmountIn = _strategy.withdraw(
        abi.encode(_amountIn, _sender, _totals[_token].share, balanceOf[_token][_sender])
      );

      _data.balance = _data.balance - _actualAmountIn.toUint128();
      emit LogStrategyWithdraw(_token, _actualAmountIn);
    }

    strategyData[_token] = _data;
  }

  // Contract should be able to receive BNB deposits to support deposit
  // solhint-disable-next-line no-empty-blocks
  receive() external payable {}
}
