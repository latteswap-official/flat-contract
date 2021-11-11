// SPDX-License-Identifier: MIT

/**
  |¯¯¯¯¯|||¯¯¯¯|  '      /¯¯¯¯¯| |¯¯¯¯¯|°
  |    ¯¯|  |       |__   /     !     | |         | 
  |__|¯¯'  |______| /___/¯|__'|  ¯|__|¯  
 */

pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/IERC20Upgradeable.sol";
import "@openzeppelin/contracts/utils/math/SafeCast.sol";

import "./interfaces/IClerk.sol";

contract FLAT is ERC20("FLAT", "FLAT"), Ownable {
  using SafeCast for uint256;
  struct Minting {
    uint128 time;
    uint128 amount;
  }

  Minting public lastMint;
  uint256 private constant MINTING_PERIOD = 24 hours;
  uint256 private constant MINTING_INCREASE = 15000;
  uint256 private constant MINTING_PRECISION = 1e5;

  event LogMintToClerk(address indexed market, IClerk indexed vault, uint256 amount);

  function mint(address _to, uint256 _amount) public onlyOwner {
    require(_to != address(0), "FLAT::mint:: no mint to zero address");

    // Limits the amount minted per period to a convergence function, with the period duration restarting on every mint
    uint256 _mintedAmount = uint256(lastMint.time < block.timestamp - MINTING_PERIOD ? 0 : lastMint.amount);
    uint256 _totalMintedAmount = _mintedAmount + _amount;
    require(
      totalSupply() == 0 || (totalSupply() * MINTING_INCREASE) / MINTING_PRECISION >= _totalMintedAmount,
      "no mint"
    );

    lastMint.time = block.timestamp.toUint128();
    lastMint.amount = _totalMintedAmount.toUint128();

    _mint(_to, _amount);
  }

  function mintToClerk(
    address _market,
    uint256 _amount,
    IClerk _clerk
  ) public onlyOwner {
    mint(address(this), _amount);
    _approve(address(this), address(_clerk), _amount);
    _clerk.deposit(IERC20Upgradeable(address(this)), address(this), _market, _amount, 0);

    emit LogMintToClerk(_market, _clerk, _amount);
  }

  function burn(uint256 _amount) public {
    _burn(msg.sender, _amount);
  }
}
