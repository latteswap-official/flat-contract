// SPDX-License-Identifier: MIT

/**
  |¯¯¯¯¯|||¯¯¯¯|  '      /¯¯¯¯¯| |¯¯¯¯¯|°
  |    ¯¯|  |       |__   /     !     | |         | 
  |__|¯¯'  |______| /___/¯|__'|  ¯|__|¯  
 */

pragma solidity 0.8.9;
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "../interfaces/IOracle.sol";
import "../interfaces/IChainlinkAggregator.sol";

contract MockOracle is IOracle {
  // Get the latest exchange rate
  function get(bytes calldata _data) public view override returns (bool, uint256) {
    return (true, 0);
  }

  function name(bytes calldata) public view override returns (string memory) {
    return "Mock";
  }

  function symbol(bytes calldata) public view override returns (string memory) {
    return "MOCK";
  }
}
