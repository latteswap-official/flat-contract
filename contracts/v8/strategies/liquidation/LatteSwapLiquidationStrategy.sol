// SPDX-License-Identifier: MIT
pragma solidity 0.8.9;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/IERC20Upgradeable.sol";

import "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";

import "@latteswap/latteswap-contract/contracts/swap/interfaces/ILatteSwapFactory.sol";
import "@latteswap/latteswap-contract/contracts/swap/interfaces/ILatteSwapPair.sol";
import "@latteswap/latteswap-contract/contracts/swap/interfaces/ILatteSwapRouter.sol";
import "../../interfaces/IFlashLiquidateStrategy.sol";
import "../../interfaces/IClerk.sol";

import "../../interfaces/IFlatMarket.sol";

contract LatteSwapLiquidationStrategy is IFlashLiquidateStrategy, OwnableUpgradeable {
  using SafeERC20Upgradeable for IERC20Upgradeable;
  // Local variables
  IClerk public clerk;
  ILatteSwapRouter public router;
  ILatteSwapFactory public factory;

  mapping(address => address[]) public pathToFlat;

  event LogSetPathToFlat(address indexed token, address[] indexed pathToFLAT);

  function initialize(IClerk _clerk, ILatteSwapRouter _router) external initializer {
    OwnableUpgradeable.__Ownable_init();

    clerk = _clerk;
    router = _router;
    factory = ILatteSwapFactory(router.factory());
  }

  function setPathToFlat(address _token, address[] calldata _pathToFLAT) external onlyOwner {
    pathToFlat[_token] = _pathToFLAT;

    emit LogSetPathToFlat(_token, _pathToFLAT);
  }

  function getPathToFlat(address _token) external view returns (address[] memory) {
    return pathToFlat[_token];
  }

  // Swaps to a flexible amount, from an exact input amount
  function execute(
    IERC20Upgradeable _fromToken,
    IERC20Upgradeable _flat,
    address _recipient,
    uint256 _minShareTo,
    uint256 _shareFrom
  ) public override {
    address _token0 = ILatteSwapPair(address(_fromToken)).token0();
    address _token1 = ILatteSwapPair(address(_fromToken)).token1();
    uint256 _amountFrom = clerk.toAmount(_flat, _shareFrom, false);
    IFlatMarket(msg.sender).withdraw(_fromToken, address(this), _amountFrom);

    _fromToken.safeApprove(address(router), _amountFrom);
    // remove liquireity from _amountfrom since _fromToken is an LP
    router.removeLiquidity(_token0, _token1, _amountFrom, 0, 0, address(this), block.timestamp);
    uint256 _balanceToken0 = IERC20Upgradeable(_token0).balanceOf(address(this));
    uint256 _balanceToken1 = IERC20Upgradeable(_token1).balanceOf(address(this));
    // swap token0
    IERC20Upgradeable(_token0).safeApprove(address(router), _balanceToken0);
    router.swapExactTokensForTokens(_balanceToken0, 0, pathToFlat[_token0], address(this), block.timestamp);
    // swap token1
    IERC20Upgradeable(_token1).safeApprove(address(router), _balanceToken1);
    router.swapExactTokensForTokens(_balanceToken1, 0, pathToFlat[_token1], address(this), block.timestamp);
    uint256 _flatBalance = _flat.balanceOf(address(this));
    require(
      clerk.toAmount(_flat, _minShareTo, false) <= _flatBalance,
      "LatteSwapLiquidationStrategy::execute:: not enough FLAT"
    );
    _flat.approve(address(clerk), _flatBalance);
    clerk.deposit(_flat, address(this), _recipient, _flatBalance, 0);
  }
}
