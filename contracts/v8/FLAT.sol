// SPDX-License-Identifier: MIT

/**
  |¯¯¯¯¯|||¯¯¯¯|  '      /¯¯¯¯¯| |¯¯¯¯¯|°
  |    ¯¯|  |       |__   /     !     | |         | 
  |__|¯¯'  |______| /___/¯|__'|  ¯|__|¯  
 */

pragma solidity 0.8.9;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/IERC20Upgradeable.sol";

import "./interfaces/IClerk.sol";

/// @title FLAT - A stablecoin backed by a basket of farmable assets.
// solhint-disable not-rely-on-time
contract FLAT is ERC20("FLAT", "FLAT"), Ownable {
  /// @dev Event
  event LogReplenish(address indexed market, IClerk indexed vault, uint256 amount);
  event LogSetMaxMintBps(uint256 _prevMaxMintBps, uint256 _newMaxMintBps);
  event LogSetCoolDown(uint256 _prevCoolDown, uint256 _newCoolDown);

  /// @dev Constant
  uint256 private constant BPS_PRECISION = 1e5;

  /// @dev Configurations
  uint256 public mintRange;
  uint256 public maxMintBps;

  /// @dev States
  uint256 public lastMintTime;
  uint256 public lastMintAmount;

  /// @notice Contructor to initialize the contract
  /// @param _initCoolDown The cool down period between mints
  /// @param _initMaxMintBps The % of FLAT that can be minted
  constructor(uint256 _initCoolDown, uint256 _initMaxMintBps) {
    require(_initCoolDown >= 6 hours, "bad _newCoolDown");
    require(_initMaxMintBps <= 3000, "bad _newMaxMintBps");

    mintRange = _initCoolDown;
    maxMintBps = _initMaxMintBps;
  }

  /// @notice Burn FLAT from msg.sender
  /// @param _amount The amount of FLAT to burn
  function burn(uint256 _amount) external {
    _burn(msg.sender, _amount);
  }

  /// @notice Perform the actual mint FLAT with supply control logic
  /// @dev Only mint if cool down period pass and supply increase last than totalSupply * maxMintBps
  /// @param _to The address to mint to
  /// @param _amount The amount of FLAT to mint
  function _mintWithSupplyControl(address _to, uint256 _amount) internal {
    require(_to != address(0), "bad _to");

    // Find out total amount that is minted in the given period.
    // If lastMintTime >= now - mintRange, then the mint limit should lift.
    uint256 _totalMintInPeriod = lastMintTime < block.timestamp - mintRange ? 0 : lastMintAmount + _amount;
    require(
      totalSupply() == 0 || (totalSupply() * maxMintBps) / BPS_PRECISION >= _totalMintInPeriod,
      "exceed mint limit"
    );

    // Update states
    lastMintTime = block.timestamp;
    lastMintAmount = _totalMintInPeriod;

    _mint(_to, _amount);
  }

  /// @notice Mint "_amount" FLAT to "_to"
  /// @param _to The address to mint to
  /// @param _amount The amount of FLAT to mint
  function mint(address _to, uint256 _amount) external onlyOwner {
    _mintWithSupplyControl(_to, _amount);
  }

  /// @notice Replenish "_amount" FLAT to "_market" in "_clerk"
  /// @param _market The market to replenish
  /// @param _amount The amount of FLAT to replenish
  /// @param _clerk The clerk to replenish
  function replenish(
    address _market,
    uint256 _amount,
    IClerk _clerk
  ) external onlyOwner {
    _mintWithSupplyControl(address(this), _amount);
    _approve(address(this), address(_clerk), _amount);
    _clerk.deposit(IERC20Upgradeable(address(this)), address(this), _market, _amount, 0);

    emit LogReplenish(_market, _clerk, _amount);
  }

  /// @notice Set mint range
  /// @param _newMintRange The new mint range
  function setMintRange(uint256 _newMintRange) external onlyOwner {
    require(_newMintRange >= 6 hours, "bad _newMintRange");

    uint256 _prevCoolDown = mintRange;
    mintRange = _newMintRange;

    emit LogSetCoolDown(_prevCoolDown, _newMintRange);
  }

  /// @notice Set max mint bps
  /// @param _newMaxMintBps The new max mint bps
  function setMaxMintBps(uint256 _newMaxMintBps) external onlyOwner {
    require(_newMaxMintBps <= 3000, "bad _newMaxMintBps");

    uint256 _prevMaxMintBps = maxMintBps;
    maxMintBps = _newMaxMintBps;

    emit LogSetMaxMintBps(_prevMaxMintBps, _newMaxMintBps);
  }
}
