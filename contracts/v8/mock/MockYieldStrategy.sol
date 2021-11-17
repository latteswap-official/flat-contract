// SPDX-License-Identifier: MIT

/**
  |¯¯¯¯¯|||¯¯¯¯|  '      /¯¯¯¯¯| |¯¯¯¯¯|°
  |    ¯¯|  |       |__   /     !     | |         | 
  |__|¯¯'  |______| /___/¯|__'|  ¯|__|¯  
 */

pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/security/Pausable.sol";
import "../interfaces/IStrategy.sol";
import "../interfaces/IBooster.sol";
import "../interfaces/IToken.sol";
import "../interfaces/IMasterBarista.sol";
import "../libraries/WadRayMath.sol";

// solhint-disable not-rely-on-time

contract MockYieldStrategy is IStrategy {
  using WadRayMath for uint256;
  using SafeERC20 for IERC20;

  IERC20 public stakingToken;
  IERC20 public rewardToken;

  constructor(IERC20 _stakingToken) {
    stakingToken = _stakingToken;
    rewardToken = stakingToken;
  }

  // Send the assets to the Strategy and call skim to invest them
  function deposit(bytes calldata _data) external override {
    return;
  }

  // Harvest any profits made converted to the asset and pass them to the caller
  function harvest(bytes calldata _data) public override returns (int256 _amountAdded) {
    (uint256 _balance, , , ) = abi.decode(_data, (uint256, address, uint256, uint256));
    _amountAdded = int256(rewardToken.balanceOf(address(this)) - (_balance));
    rewardToken.safeTransfer(msg.sender, uint256(_amountAdded));
  }

  // Withdraw assets. The returned amount can differ from the requested amount due to rounding or if the request was more than there is.
  function withdraw(bytes calldata _data) external override returns (uint256 _actualAmount) {
    (uint256 _amount, address _sender, , uint256 _stake) = abi.decode(_data, (uint256, address, uint256, uint256));
    rewardToken.safeTransfer(msg.sender, _amount); // Add as profit
    _actualAmount = _amount;
  }

  // Withdraw all assets in the safest way possible. This shouldn't fail.
  function exit(uint256 balance) external override returns (int256 _amountAdded) {
    _amountAdded = 0;
    IERC20(rewardToken).safeTransfer(msg.sender, balance);
  }
}
