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
  function getDataParameter(
    address _multiply,
    address _divide,
    uint256 _decimals
  ) public pure returns (bytes memory) {
    return bytes("");
  }

  // Get the latest exchange rate
  /// @inheritdoc IOracle
  function get(bytes calldata _data) public override returns (bool, uint256) {
    return (true, 0);
  }

  // Check the last exchange rate without any state changes
  /// @inheritdoc IOracle
  function peek(bytes calldata _data) public view override returns (bool, uint256) {
    return (true, 0);
  }

  // Check the current spot exchange rate without any state changes
  /// @inheritdoc IOracle
  function peekSpot(bytes calldata _data) external view override returns (uint256 _rate) {
    (, _rate) = peek(_data);
  }

  /// @inheritdoc IOracle
  function name(bytes calldata) public view override returns (string memory) {
    return "Mock";
  }

  /// @inheritdoc IOracle
  function symbol(bytes calldata) public view override returns (string memory) {
    return "MOCK";
  }
}
