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

contract ChainlinkOracle is IOracle, Initializable {
  function initialize() external initializer {}

  // Calculates the lastest exchange rate
  // Uses both divide and multiply only for tokens not supported directly by Chainlink, for example MKR/USD
  function _get(
    address _multiply,
    address _divide,
    uint256 _decimals
  ) internal view returns (uint256) {
    uint256 _price = uint256(1e36);
    if (_multiply != address(0)) {
      _price = _price * uint256(IChainlinkAggregator(_multiply).latestAnswer());
    } else {
      _price = _price * 1e18;
    }

    if (_divide != address(0)) {
      _price = _price / uint256(IChainlinkAggregator(_divide).latestAnswer());
    }

    return _price / _decimals;
  }

  function getDataParameter(
    address _multiply,
    address _divide,
    uint256 _decimals
  ) public pure returns (bytes memory) {
    return abi.encode(_multiply, _divide, _decimals);
  }

  // Get the latest exchange rate
  /// @inheritdoc IOracle
  function get(bytes calldata _data) public view override returns (bool, uint256) {
    (address _multiply, address _divide, uint256 _decimals) = abi.decode(_data, (address, address, uint256));
    return (true, _get(_multiply, _divide, _decimals));
  }

  // Check the last exchange rate without any state changes
  /// @inheritdoc IOracle
  function peek(bytes calldata _data) public view override returns (bool, uint256) {
    (address _multiply, address _divide, uint256 _decimals) = abi.decode(_data, (address, address, uint256));
    return (true, _get(_multiply, _divide, _decimals));
  }

  // Check the current spot exchange rate without any state changes
  /// @inheritdoc IOracle
  function peekSpot(bytes calldata _data) external view override returns (uint256 _rate) {
    (, _rate) = peek(_data);
  }

  /// @inheritdoc IOracle
  function name(bytes calldata) public pure override returns (string memory) {
    return "Chainlink";
  }

  /// @inheritdoc IOracle
  function symbol(bytes calldata) public pure override returns (string memory) {
    return "LINK";
  }
}
