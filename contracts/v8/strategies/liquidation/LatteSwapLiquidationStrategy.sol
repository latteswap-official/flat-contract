// SPDX-License-Identifier: MIT
pragma solidity 0.8.9;
import "@openzeppelin/contracts-upgradeable/token/ERC20/IERC20Upgradeable.sol";
import "@latteswap/latteswap-contract/contracts/swap/interfaces/ILatteSwapFactory.sol";
import "@latteswap/latteswap-contract/contracts/swap/interfaces/ILatteSwapPair.sol";
import "@latteswap/latteswap-contract/contracts/swap/interfaces/ILatteSwapRouter.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "../../interfaces/IFlashLiquidateStrategy.sol";
import "../../interfaces/IClerk.sol";

contract SushiSwapSwapper is IFlashLiquidateStrategy, Initializable {
  // Local variables
  IClerk public clerk;
  ILatteSwapRouter public router;
  ILatteSwapFactory public factory;

  function initialize(
    IClerk _clerk,
    ILatteSwapRouter _router,
    ILatteSwapFactory _factory
  ) external initializer {
    clerk = _clerk;
    factory = _factory;
    router = _router;
  }

  // Swaps to a flexible amount, from an exact input amount
  /// @inheritdoc IFlashLiquidateStrategy
  function swap(
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
      _pair.swap(0, _amountTo, address(clerk), new bytes(0));
    } else {
      _amountTo = router.getAmountOut(_amountFrom, _reserve1, _reserve0);
      _pair.swap(_amountTo, 0, address(clerk), new bytes(0));
    }

    (, shareReturned) = clerk.deposit(_toToken, address(clerk), _recipient, _amountTo, 0);
    extraShare = shareReturned - _minShareTo;
  }

  // Swaps to an exact amount, from a flexible input amount
  /// @inheritdoc IFlashLiquidateStrategy
  function swapExact(
    IERC20Upgradeable _fromToken,
    IERC20Upgradeable _toToken,
    address _recipient,
    address _refundTo,
    uint256 _suppliedShareFrom,
    uint256 _exactShareTo
  ) public override returns (uint256 shareUsed, uint256 shareReturned) {
    ILatteSwapPair _pair = ILatteSwapPair(factory.getPair(address(_fromToken), address(_toToken)));

    (uint256 _reserve0, uint256 _reserve1, ) = _pair.getReserves();

    uint256 _amountToExact = clerk.toAmount(_toToken, _exactShareTo, true);

    uint256 _amountFrom;
    if (_toToken > _fromToken) {
      _amountFrom = router.getAmountIn(_amountToExact, _reserve0, _reserve1);
      (, shareUsed) = clerk.withdraw(_fromToken, address(this), address(_pair), _amountFrom, 0);
      _pair.swap(0, _amountToExact, address(clerk), "");
    } else {
      _amountFrom = router.getAmountIn(_amountToExact, _reserve1, _reserve0);
      (, shareUsed) = clerk.withdraw(_fromToken, address(this), address(_pair), _amountFrom, 0);
      _pair.swap(_amountToExact, 0, address(clerk), "");
    }

    clerk.deposit(_toToken, address(clerk), _recipient, 0, _exactShareTo);
    shareReturned = _suppliedShareFrom - shareUsed;

    if (shareReturned > 0) {
      clerk.transfer(_fromToken, address(this), _refundTo, shareReturned);
    }
  }
}
