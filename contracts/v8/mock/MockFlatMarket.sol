// SPDX-License-Identifier: GPL-3.0

/**
  |¯¯¯¯¯|||¯¯¯¯|  '      /¯¯¯¯¯| |¯¯¯¯¯|°
  |    ¯¯|  |       |__   /     !     | |         | 
  |__|¯¯'  |______| /___/¯|__'|  ¯|__|¯  
 */

pragma solidity 0.8.9;
pragma experimental ABIEncoderV2;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/IERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/math/MathUpgradeable.sol";
import "../libraries/LatteConversion.sol";

import "../interfaces/IOracle.sol";
import "../interfaces/IFlashLiquidateStrategy.sol";
import "../interfaces/IClerk.sol";
import "../interfaces/IFlatMarketConfig.sol";
import "../interfaces/ITreasuryHolder.sol";

import "../FLAT.sol";

/// @title MockFlatMarketForTreasuryHolder
// solhint-disable not-rely-on-time
contract MockFlatMarketForTreasuryHolder is OwnableUpgradeable, ReentrancyGuardUpgradeable {
  using LatteConversion for Conversion;
  using SafeERC20Upgradeable for IERC20Upgradeable;

  /// @dev Events
  event LogUpdateCollateralPrice(uint256 newPirce);
  event LogAddCollateral(address indexed from, address indexed to, uint256 share);
  event LogRemoveCollateral(address indexed from, address indexed to, uint256 share);
  event LogBorrow(address indexed from, address indexed to, uint256 amount, uint256 part);
  event LogRepay(address indexed from, address indexed to, uint256 amount, uint256 part);
  event LogFeeTo(address indexed newFeeTo);
  event LogSetInterestPerSec(uint256 oldInterestPerSec, uint256 newInterestPerSec);
  event LogWithdrawSurplus(address indexed feeTo, uint256 surplus);
  event LogWithdrawLiquidationFee(address indexed feeTo, uint256 liquidationFee);

  /// @dev Constants
  uint256 private constant BPS_PRECISION = 1e4;
  uint256 private constant COLLATERAL_PRICE_PRECISION = 1e18;

  /// @dev Default configuration states.
  /// These configurations are expected to be the same amongs markets.
  IClerk public clerk;
  IERC20Upgradeable public flat;

  /// @dev Market configuration states.
  IERC20Upgradeable public collateral;
  IOracle public oracle;
  bytes public oracleData;

  /// @dev Global states of the market
  uint256 public totalCollateralShare;
  uint256 public totalDebtShare;
  uint256 public totalDebtValue;

  /// @dev User's states
  mapping(address => uint256) public userCollateralShare;
  mapping(address => uint256) public userDebtShare;

  /// @dev Price of collateral
  uint256 public collateralPrice;

  /// @dev Interest-related states
  uint256 public lastAccrueTime;

  /// @dev Protocol revenue
  uint256 public surplus;
  uint256 public liquidationFee;

  /// @dev Fee & Risk parameters
  IFlatMerketConfig public marketConfig;

  /// @notice The constructor is only used for the initial master contract.
  /// Subsequent clones are initialised via `init`.
  function initialize(
    IClerk _clerk,
    IERC20Upgradeable _flat,
    IERC20Upgradeable _collateral,
    IFlatMerketConfig _marketConfig,
    IOracle _oracle,
    bytes calldata _oracleData
  ) external initializer {
    OwnableUpgradeable.__Ownable_init();
    ReentrancyGuardUpgradeable.__ReentrancyGuard_init();

    clerk = _clerk;
    flat = _flat;
    collateral = _collateral;
    marketConfig = _marketConfig;
    oracle = _oracle;
    oracleData = _oracleData;
  }

  /// @notice Modifier to check if the user is safe from liquidation at the end of function.
  modifier checkSafe() {
    _;
    require(_checkSafe(msg.sender, collateralPrice), "!safe");
  }

  /// @notice Update collateral price and check slippage
  modifier updateCollateralPriceWithSlippageCheck(uint256 _minPrice, uint256 _maxPrice) {
    (bool _update, uint256 _price) = updateCollateralPrice();
    require(_update, "bad price");
    require(_price >= _minPrice && _price <= _maxPrice, "slippage");
    _;
  }

  /// @notice Perform actual add collateral
  /// @param _to The address of the user to get the collateral added
  /// @param _share The share of the collateral to be added
  function _addCollateral(address _to, uint256 _share) internal {
    userCollateralShare[_to] = userCollateralShare[_to] + _share;
    uint256 _oldTotalCollateralShare = totalCollateralShare;
    totalCollateralShare = _oldTotalCollateralShare + _share;

    _addTokens(collateral, _share);

    emit LogAddCollateral(msg.sender, _to, _share);
  }

  /// @notice Adds `collateral` from msg.sender to the account `to`.
  /// @param _to The receiver of the tokens.
  /// @param _amount The amount of collateral to be added to "_to".
  function addCollateral(address _to, uint256 _amount) public nonReentrant {
    uint256 _share = clerk.toShare(collateral, _amount, false);
    _addCollateral(_to, _share);
  }

  /// @dev Perform token transfer from msg.sender to Market.
  /// @param _token The BEP20 token.
  /// @param _share The amount in shares to add.
  /// False if tokens from msg.sender in `flatVault` should be transferred.
  function _addTokens(IERC20Upgradeable _token, uint256 _share) internal {
    clerk.transfer(_token, msg.sender, address(this), _share);
  }

  /// @notice Perform the actual borrow.
  /// @dev msg.sender borrow "_amount" of FLAT and transfer to "_to"
  /// @param _to The address to received borrowed FLAT
  /// @param _amount The amount of FLAT to be borrowed
  function _borrow(address _to, uint256 _amount) internal returns (uint256 _debtShare, uint256 _share) {
    // 1. Find out debtShare from the give "_value" that msg.sender wish to borrow
    _debtShare = debtValueToShare(_amount, true);

    // 2. Update user's debtShare
    userDebtShare[msg.sender] = userDebtShare[msg.sender] + _debtShare;

    // 3. Book totalDebtShare and totalDebtValue
    totalDebtShare = totalDebtShare + _debtShare;
    totalDebtValue = totalDebtValue + _amount;

    // 4. Transfer borrowed FLAT to "_to"
    _share = clerk.toShare(flat, _amount, false);
    clerk.transfer(flat, address(this), _to, _share);

    emit LogBorrow(msg.sender, _to, _amount, _debtShare);
  }

  /// @notice Sender borrows `_amount` and transfers it to `to`.
  /// @dev "checkSafe" modifier prevents msg.sender from borrow > collateralFactor
  /// @param _to The address to received borrowed FLAT
  /// @param _borrowAmount The amount of FLAT to be borrowed
  function borrow(
    address _to,
    uint256 _borrowAmount,
    uint256 _minPrice,
    uint256 _maxPrice
  )
    external
    nonReentrant
    updateCollateralPriceWithSlippageCheck(_minPrice, _maxPrice)
    checkSafe
    returns (uint256 _debtShare, uint256 _share)
  {
    // Perform actual borrow
    (_debtShare, _share) = _borrow(_to, _borrowAmount);
  }

  /// @notice Sender borrows `_amount` and transfers it to `to`.
  /// @dev "checkSafe" modifier prevents msg.sender from borrow > collateralFactor
  /// @param _to The address to received borrowed FLAT
  /// @param _borrowAmount The amount of FLAT to be borrowed
  /// @param _minPrice The minimum price for collateral
  /// @param _maxPrice The maximum price for collateral
  function borrowAndWithdraw(
    address _to,
    uint256 _borrowAmount,
    uint256 _minPrice,
    uint256 _maxPrice
  )
    external
    nonReentrant
    updateCollateralPriceWithSlippageCheck(_minPrice, _maxPrice)
    checkSafe
    returns (uint256 _debtShare, uint256 _share)
  {
    // 1. Borrow FLAT
    (_debtShare, _share) = _borrow(_to, _borrowAmount);

    // 2. Withdraw FLAT from Clerk to "_to"
    _vaultWithdraw(flat, _to, _borrowAmount, 0);
  }

  /// @notice Return if true "_user" is safe from liquidation.
  /// @dev Beware of unaccrue interest.
  /// @param _user The address to check if it is safe from liquidation.
  /// @param _collateralPrice The exchange rate. Used to cache the `exchangeRate` between calls.
  function _checkSafe(address _user, uint256 _collateralPrice) internal view returns (bool) {
    uint256 _collateralFactor = marketConfig.collateralFactor(address(this), _user);

    require(_collateralFactor <= 9500 && _collateralFactor >= 5000, "bad collateralFactor");

    uint256 _userDebtShare = userDebtShare[_user];
    if (_userDebtShare == 0) return true;
    uint256 _userCollateralShare = userCollateralShare[_user];
    if (_userCollateralShare == 0) return false;

    return
      (clerk.toAmount(collateral, _userCollateralShare, false) * _collateralPrice * _collateralFactor) /
        BPS_PRECISION >=
      (_userDebtShare * totalDebtValue * COLLATERAL_PRICE_PRECISION) / totalDebtShare;
  }

  /// @notice Return the debt value of the given debt share.
  /// @param _debtShare The debt share to be convered.
  /// @param _roundUp If true, then check whether it is needed to round up or not.
  function debtShareToValue(uint256 _debtShare, bool _roundUp) public view returns (uint256) {
    if (totalDebtShare == 0) return _debtShare;
    uint256 _debtValue = (_debtShare * totalDebtValue) / totalDebtShare;
    if (_roundUp && (_debtValue * totalDebtShare) / totalDebtValue < _debtShare) {
      return _debtValue + 1;
    }
    return _debtValue;
  }

  /// @notice Return the debt share for the given debt value.
  /// @param _debtValue The debt value to be converted.
  /// @param _roundUp If true, then check whether it is needed to round up or not.
  function debtValueToShare(uint256 _debtValue, bool _roundUp) public view returns (uint256) {
    if (totalDebtShare == 0) return _debtValue;
    uint256 _debtShare = (_debtValue * totalDebtShare) / totalDebtValue;
    if (_roundUp && (_debtShare * (totalDebtValue)) / totalDebtShare < _debtValue) {
      return _debtShare + 1;
    }
    return _debtShare;
  }

  /// @notice Deposit collateral to Clerk.
  /// @dev msg.sender deposits `_amount` of `_token` to Clerk. "_to" will be credited with `_amount` of `_token`.
  /// @param _token The address of the token to be deposited.
  /// @param _to The address to be credited with `_amount` of `_token`.
  /// @param _collateralAmount The amount of `_token` to be deposited.
  function deposit(
    IERC20Upgradeable _token,
    address _to,
    uint256 _collateralAmount
  ) external nonReentrant {
    _vaultDeposit(_token, _to, _collateralAmount, 0);
  }

  /// @notice Deposit and add collateral from msg.sender to the account `to`.
  /// @param _to The beneficial to received collateral in Clerk.
  /// @param _collateralAmount The amount of collateral to be added to "_to".
  function depositAndAddCollateral(address _to, uint256 _collateralAmount) public nonReentrant {
    // 1. Deposit collateral in Clerk from msg.sender
    _vaultDeposit(collateral, msg.sender, _collateralAmount, 0);

    // 2. Add collateral from msg.sender to _to in Clerk
    uint256 _share = clerk.toShare(collateral, _collateralAmount, false);
    _addCollateral(_to, _share);
  }

  /// @notice Deposit collateral to Clerk and borrow FLAT
  /// @param _to The address to received borrowed FLAT
  /// @param _collateralAmount The amount of collateral to be deposited
  /// @param _borrowAmount The amount of FLAT to be borrowed
  /// @param _minPrice The minimum price of FLAT to be borrowed to prevent slippage
  /// @param _maxPrice The maximum price of FLAT to be borrowed to prevent slippage
  function depositAndBorrow(
    address _to,
    uint256 _collateralAmount,
    uint256 _borrowAmount,
    uint256 _minPrice,
    uint256 _maxPrice
  ) external nonReentrant updateCollateralPriceWithSlippageCheck(_minPrice, _maxPrice) checkSafe {
    // 1. Deposit collateral to the Vault
    (, uint256 _shareOut) = _vaultDeposit(collateral, _to, _collateralAmount, 0);

    // 2. Add collateral
    _addCollateral(_to, _shareOut);

    // 3. Borrow FLAT
    _borrow(_to, _borrowAmount);

    // 4. Withdraw FLAT from Vault to "_to"
    _vaultWithdraw(flat, _to, _borrowAmount, 0);
  }

  /// @notice Repays a loan.
  /// @param _for Address of the user this payment should go.
  /// @param _maxDebtReturn The maxium amount of FLAT to be return.
  function depositAndRepay(address _for, uint256 _maxDebtReturn) external nonReentrant returns (uint256) {
    updateCollateralPrice();
    // 1. Find out how much debt to repaid
    uint256 _debtValue = MathUpgradeable.min(_maxDebtReturn, debtShareToValue(userDebtShare[_for], true));

    // 2. Deposit FLAT to Clerk
    _vaultDeposit(flat, msg.sender, _debtValue, 0);

    // 3. Repay debt
    _repay(_for, _debtValue);

    return _debtValue;
  }

  /// @notice Deposit "_debtValue" FLAT to the vault, repay the debt, and withdraw "_collateralAmount" of collateral.
  /// @dev source of funds to repay debt will come from msg.sender, "_to" is beneficiary
  /// @param _for The address to repay debt for.
  /// @param _to The address to received collateral token.
  /// @param _maxDebtReturn The maxium amount of FLAT to be return.
  /// @param _collateralAmount The amount of collateral to be withdrawn.
  /// @param _minPrice Minimum price to allow the repayment.
  /// @param _maxPrice Maximum price to allow the replayment.
  function depositRepayAndWithdraw(
    address _for,
    address _to,
    uint256 _maxDebtReturn,
    uint256 _collateralAmount,
    uint256 _minPrice,
    uint256 _maxPrice
  ) external nonReentrant updateCollateralPriceWithSlippageCheck(_minPrice, _maxPrice) checkSafe {
    // 1. Find out how much debt to repaid
    uint256 _debtValue = MathUpgradeable.min(_maxDebtReturn, debtShareToValue(userDebtShare[_to], true));

    // 2. Deposit FLAT to Vault for preparing to settle the debt
    _vaultDeposit(flat, msg.sender, _debtValue, 0);

    // 3. Repay the debt
    _repay(_for, _debtValue);

    // 4. Remove collateral from FlatMarket to "_to"
    uint256 _collateralShare = clerk.toShare(collateral, _collateralAmount, false);
    _removeCollateral(msg.sender, _collateralShare);

    // 5. Withdraw collateral to "_to"
    _vaultWithdraw(collateral, _to, _collateralAmount, 0);
  }

  /// @notice Kill user's positions if the _collateralFactor conditon is met.
  /// @param _users An array of user addresses.
  /// @param _maxDebtShares A one-to-one mapping to `users`, contains maximum (partial) borrow amounts (to liquidate) of the respective user.
  /// @param _to Address of the receiver in open liquidations if `swapper` is zero.
  function kill(
    address[] calldata _users,
    uint256[] calldata _maxDebtShares,
    address _to,
    IFlashLiquidateStrategy _flashLiquidateStrategy
  ) public nonReentrant {
    // 1. Load required config
    uint256 _liquidationPenalty = marketConfig.liquidationPenalty(address(this));
    uint256 _liquidationTreasuryBps = marketConfig.liquidationTreasuryBps(address(this));
    require(_liquidationPenalty <= 19000 && _liquidationPenalty >= 10000, "bad liquidation penalty");
    require(_liquidationTreasuryBps <= 2000 && _liquidationTreasuryBps >= 500, "bad liquidation treasury bps");
    require(marketConfig.treasury() != address(0), "bad treasury");

    // 2. Force update collateral price
    (, uint256 _collateralPrice) = updateCollateralPrice();

    // 3. Prepare variables
    uint256 _sumCollateralShare = 0;
    uint256 _sumDebtAmount = 0;
    uint256 _sumDebtShare = 0;
    Conversion memory _flatVaultTotals = clerk.totals(collateral);

    // 4. Loop-through all users to check if we are able to liquidate
    for (uint256 i = 0; i < _users.length; i++) {
      address _user = _users[i];
      // 4.1. If user position not safe, then can liquidate
      if (!_checkSafe(_user, _collateralPrice)) {
        // 4.1.1. Findout how much debt share to liquidate
        uint256 _lessDebtShare = MathUpgradeable.min(_maxDebtShares[i], userDebtShare[_user]);
        // 4.1.2. Convert debt share to FLAT value
        uint256 _borrowAmount = debtShareToValue(_lessDebtShare, false);
        // 4.1.3. Calculate collateral share to be taken out by liquidator
        uint256 _collateralShare = _flatVaultTotals.toShare(
          (_borrowAmount * _liquidationPenalty * COLLATERAL_PRICE_PRECISION) / (BPS_PRECISION * _collateralPrice),
          false
        );

        // 4.1.4. If the value of leftover collateral less than minDebtSize then liquidator should take all
        // Need to recalculate _lessDebtShare and _borrowAmount as well.
        if (
          _collateralShare > userCollateralShare[_user] ||
          clerk.toAmount(collateral, userCollateralShare[_user], false) * _collateralPrice <
          marketConfig.minDebtSize(address(this))
        ) {
          // Take out all collateral
          _collateralShare = userCollateralShare[_user];
          userCollateralShare[_user] = 0;

          // Recalculate borrowAmount & lessDebtShare
          // borrowAmount should be discounted instead of discount on collateral.
          // Round debtShare up to make sure it is not zero if borrowAmount is tiny.
          _borrowAmount =
            (clerk.toAmount(collateral, _collateralShare, false) * _collateralPrice * (2e4 - _liquidationPenalty)) /
            (COLLATERAL_PRICE_PRECISION * BPS_PRECISION);
          _lessDebtShare = debtValueToShare(_borrowAmount, true);
        } else {
          userCollateralShare[_user] = userCollateralShare[_user] - _collateralShare;
        }

        // Update userDebtShare
        userDebtShare[_user] = userDebtShare[_user] - _lessDebtShare;

        emit LogRemoveCollateral(_user, _to, _collateralShare);
        emit LogRepay(msg.sender, _user, _borrowAmount, _lessDebtShare);

        // 4.1.5. If user's collateral is 0, but debtShare is not 0;
        // Then it is bad debt. Hence move user's debt share to treasury.
        // Treausry will settle bad debt later by surplus or liquidation fee
        if (userCollateralShare[_user] == 0 && userDebtShare[_user] != 0) {
          userDebtShare[marketConfig.treasury()] = userDebtShare[_user];
          userDebtShare[_user] = 0;
        }

        // 4.1.6. Update total vairables
        _sumCollateralShare = _sumCollateralShare + _collateralShare;
        _sumDebtAmount = _sumDebtAmount + _borrowAmount;
        _sumDebtShare = _sumDebtShare + _lessDebtShare;
      }
    }

    // 5. Revert if all users are safe
    require(_sumDebtAmount != 0, "all healthy");

    // 6. Update market global states
    totalDebtValue = totalDebtValue - _sumDebtAmount;
    totalDebtShare = totalDebtShare - _sumDebtShare;
    totalCollateralShare = totalCollateralShare - _sumCollateralShare;

    // 7. Take out treasury fee on liquidation
    {
      uint256 _distributionAmount = ((((_sumDebtAmount * _liquidationPenalty) / BPS_PRECISION) - _sumDebtAmount) *
        _liquidationTreasuryBps) / BPS_PRECISION;
      _sumDebtAmount = _sumDebtAmount + _distributionAmount;
      liquidationFee = liquidationFee + _distributionAmount;
    }

    // 8. Convert liquidatable amount to share
    uint256 _allBorrowShare = clerk.toShare(flat, _sumDebtAmount, true);

    // 9. Transfer collateral to liquidator
    clerk.transfer(collateral, address(this), _to, _sumCollateralShare);
    if (address(_flashLiquidateStrategy) != address(0)) {
      // 9.1. If flash liquidate strategy is set, then call the strategy
      _flashLiquidateStrategy.execute(collateral, flat, msg.sender, _allBorrowShare, _sumCollateralShare);
    }
    // 10. Debit FLAT from liquidator, if liquidator doesn't has enough FLAT, then it should revert
    clerk.transfer(flat, msg.sender, address(this), _allBorrowShare);
  }

  /// @notice Reduce the supply of FLAT
  /// @param _amount amount to reduce supply by
  function reduceSupply(uint256 _amount) public onlyOwner {
    clerk.withdraw(flat, address(this), address(this), _amount, 0);
    FLAT(address(flat)).burn(_amount);
  }

  /// @notice Perform the actual removeCollateral.
  /// @dev msg.sender will be the source of funds to remove collateral from and then
  /// the funds will be credited to "_to".
  /// @param _to The beneficary of the removed collateral.
  /// @param _share The amount of collateral to remove in share units.
  function _removeCollateral(address _to, uint256 _share) internal {
    userCollateralShare[msg.sender] = userCollateralShare[msg.sender] - _share;
    totalCollateralShare = totalCollateralShare - _share;

    clerk.transfer(collateral, address(this), _to, _share);

    emit LogRemoveCollateral(msg.sender, _to, _share);
  }

  /// @notice Remove `share` amount of collateral and transfer it to `to`.
  /// @param _to The receiver of the shares.
  /// @param _amount Amount of collaterals to be removed
  function removeCollateral(
    address _to,
    uint256 _amount,
    uint256 _minPrice,
    uint256 _maxPrice
  ) public nonReentrant updateCollateralPriceWithSlippageCheck(_minPrice, _maxPrice) checkSafe {
    uint256 _share = clerk.toShare(collateral, _amount, false);
    _removeCollateral(_to, _share);
  }

  /// @notice Remove and withdraw collateral from Clerk.
  /// @param _to The address to receive token.
  /// @param _collateralAmount The amount of collateral to be withdrawn.
  /// @param _minPrice Minimum price to allow the repayment.
  /// @param _maxPrice Maximum price to allow the replayment.
  function removeCollateralAndWithdraw(
    address _to,
    uint256 _collateralAmount,
    uint256 _minPrice,
    uint256 _maxPrice
  ) external nonReentrant updateCollateralPriceWithSlippageCheck(_minPrice, _maxPrice) checkSafe {
    // 1. Remove collateral from FlatMarket to "_to"
    uint256 _collateralShare = clerk.toShare(collateral, _collateralAmount, false);
    _removeCollateral(msg.sender, _collateralShare);

    // 2. Withdraw collateral to "_to"
    _vaultWithdraw(collateral, _to, _collateralAmount, 0);
  }

  /// @notice Perform the actual repay.
  /// @param _for The address to repay debt.
  /// @param _debtValue The debt value to be repaid.
  function _repay(address _for, uint256 _debtValue) internal returns (uint256 _debtShare) {
    // 1. Findout "_debtShare" from the given "_debtValue"
    _debtShare = debtValueToShare(_debtValue, false);

    // 2. Update user's debtShare
    userDebtShare[_for] = userDebtShare[_for] - _debtShare;

    // 3. Update total debtShare and debtValue
    totalDebtShare = totalDebtShare - _debtShare;
    totalDebtValue = totalDebtValue - _debtValue;

    // 4. Transfer FLAT from msg.sender to this market.
    uint256 _share = clerk.toShare(flat, _debtValue, true);
    clerk.transfer(flat, msg.sender, address(this), _share);

    emit LogRepay(msg.sender, _for, _debtValue, _debtShare);
  }

  /// @notice Repays a loan.
  /// @param _for Address of the user this payment should go.
  /// @param _maxDebtValue The maximum amount of FLAT to be repaid.
  function repay(address _for, uint256 _maxDebtValue) external nonReentrant returns (uint256) {
    updateCollateralPrice();
    uint256 _debtValue = MathUpgradeable.min(_maxDebtValue, debtShareToValue(userDebtShare[_for], true));
    _repay(_for, _debtValue);
    return _debtValue;
  }

  /// @notice Update collateral price from Oracle.
  function updateCollateralPrice() public returns (bool _updated, uint256 _price) {
    (_updated, _price) = oracle.get(oracleData);

    if (_updated) {
      collateralPrice = _price;
      emit LogUpdateCollateralPrice(_price);
    } else {
      // Return the old rate if fetching wasn't successful
      _price = collateralPrice;
    }
  }

  /// @notice Perform deposit token from msg.sender and credit token's balance to "_to"
  /// @param _token The token to deposit.
  /// @param _to The address to credit the deposited token's balance to.
  /// @param _amount The amount of tokens to deposit.
  /// @param _share The amount to deposit in share units.
  function _vaultDeposit(
    IERC20Upgradeable _token,
    address _to,
    uint256 _amount,
    uint256 _share
  ) internal returns (uint256, uint256) {
    return clerk.deposit(_token, msg.sender, _to, uint256(_amount), uint256(_share));
  }

  /// @notice Perform debit token's balance from msg.sender and transfer token to "_to"
  /// @param _token The token to withdraw.
  /// @param _to The address of the receiver.
  /// @param _amount The amount to withdraw.
  /// @param _share The amount to withdraw in share.
  function _vaultWithdraw(
    IERC20Upgradeable _token,
    address _to,
    uint256 _amount,
    uint256 _share
  ) internal returns (uint256, uint256) {
    return clerk.withdraw(_token, msg.sender, _to, _amount, _share);
  }

  /// @notice Withdraw collateral from the Clerk.
  /// @param _token The token to be withdrawn.
  /// @param _to The address of the receiver.
  /// @param _collateralAmount The amount to be withdrawn.
  function withdraw(
    IERC20Upgradeable _token,
    address _to,
    uint256 _collateralAmount
  ) external {
    _vaultWithdraw(_token, _to, _collateralAmount, 0);
  }

  /// @notice Withdraws accumulated surplus + liquidation fee.
  function withdrawSurplus() external returns (uint256, uint256) {
    require(marketConfig.treasury() != address(0), "bad treasury");
    require(marketConfig.treasury() == msg.sender, "not treasury");

    // 1. Cached old data
    uint256 _surplus = surplus;
    uint256 _liquidationFee = liquidationFee;

    // 2. Update calculate _share to be transferred
    uint256 _surplusShare = clerk.toShare(flat, surplus, false);
    uint256 _liquidationFeeShare = clerk.toShare(flat, liquidationFee, false);
    surplus = 0;
    liquidationFee = 0;

    // 3. Perform the actual transfer
    clerk.transfer(flat, address(this), marketConfig.treasury(), _surplusShare + _liquidationFeeShare);

    emit LogWithdrawSurplus(marketConfig.treasury(), _surplus);
    emit LogWithdrawLiquidationFee(marketConfig.treasury(), _liquidationFee);

    return (_surplus, _liquidationFee);
  }

  function mockOnBadDebtCall(uint256 _badDebtValue) external {
    require(marketConfig.treasury() != address(0), "bad treasury");

    ITreasuryHolderCallback(marketConfig.treasury()).onBadDebt(_badDebtValue);
  }
}
