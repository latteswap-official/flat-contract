// SPDX-License-Identifier: MIT
pragma solidity 0.8.9;

import "@openzeppelin/contracts-upgradeable/token/ERC20/IERC20Upgradeable.sol";
import "@latteswap/latteswap-contract/contracts/swap/interfaces/ILatteSwapFactory.sol";
import "@latteswap/latteswap-contract/contracts/swap/interfaces/ILatteSwapPair.sol";
import "@latteswap/latteswap-contract/contracts/swap/interfaces/ILatteSwapRouter.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "../../interfaces/IFlashLiquidateStrategy.sol";
import "../../interfaces/IClerk.sol";

contract LatteSwapLiquidationStrategy is IFlashLiquidateStrategy, Initializable {
  // Local variables
  IClerk public clerk;
  ILatteSwapRouter public router;
  ILatteSwapFactory public factory;

  function initialize(IClerk _clerk, ILatteSwapRouter _router) external initializer {
    clerk = _clerk;
    router = _router;
    factory = ILatteSwapFactory(router.factory());
  }

  // Swaps to a flexible amount, from an exact input amount
  /// @inheritdoc IFlashLiquidateStrategy
  function execute(
    IERC20Upgradeable _fromToken,
    IERC20Upgradeable _toToken,
    address _recipient,
    uint256 _minShareTo,
    uint256 _shareFrom
  ) public override returns (uint256 extraShare, uint256 shareReturned) {
    ILatteSwapPair _pair = ILatteSwapPair(factory.getPair(address(_fromToken), address(_toToken)));
    (uint256 _amountFrom, ) = clerk.withdraw(_fromToken, address(this), address(_pair), 0, _shareFrom);
    (uint256 _reserve0, uint256 _reserve1, ) = _pair.getReserves();
    uint256 _amountTo;
    if (_toToken > _fromToken) {
      _amountTo = router.getAmountOut(_amountFrom, _reserve0, _reserve1);
      _pair.swap(0, _amountTo, address(this), new bytes(0));
    } else {
      _amountTo = router.getAmountOut(_amountFrom, _reserve1, _reserve0);
      _pair.swap(_amountTo, 0, address(this), new bytes(0));
    }
    _toToken.approve(address(clerk), _amountTo);
    (, shareReturned) = clerk.deposit(_toToken, address(this), _recipient, _amountTo, 0);
    extraShare = shareReturned - _minShareTo;
  }
}
