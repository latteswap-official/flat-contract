// SPDX-License-Identifier: MIT
/**
  |¯¯¯¯¯|||¯¯¯¯|  '      /¯¯¯¯¯| |¯¯¯¯¯|°
  |    ¯¯|  |       |__   /     !     | |         | 
  |__|¯¯'  |______| /___/¯|__'|  ¯|__|¯  
 */

pragma solidity 0.8.9;
pragma experimental ABIEncoderV2;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";

import "../interfaces/IOracle.sol";

contract CompositeOracle is IOracle, Initializable, AccessControlUpgradeable {
  // Mapping from token to number of sources
  mapping(address => uint256) public primarySourceCount;
  // Mapping from token to (mapping from index to oracle source)
  mapping(address => mapping(uint256 => IOracle)) public primarySources;
  // Mapping from token to (mapping from index to oracle source)
  mapping(address => mapping(uint256 => bytes)) public oracleDatas;
  // Mapping from token to max price deviation (multiplied by 1e18)
  mapping(address => uint256) public maxPriceDeviations;

  uint256 public constant MIN_PRICE_DEVIATION = 1e18;
  uint256 public constant MAX_PRICE_DEVIATION = 1.5e18;

  bytes32 public constant GOVERNANCE_ROLE = keccak256("GOVERNANCE_ROLE");

  event LogSetPrimarySources(address indexed token, uint256 maxPriceDeviation, IOracle[] oracles);

  modifier onlyGovernance() {
    require(hasRole(GOVERNANCE_ROLE, _msgSender()), "CompositeOracle::onlyGovernance::only GOVERNANCE role");
    _;
  }

  function initialize() external initializer {
    AccessControlUpgradeable.__AccessControl_init();

    _setupRole(DEFAULT_ADMIN_ROLE, _msgSender());
    _setupRole(GOVERNANCE_ROLE, _msgSender());
  }

  /// @dev Set oracle primary sources for the token
  /// @param _token Token address to set oracle sources
  /// @param _maxPriceDeviation Max price deviation (in 1e18) for token
  /// @param _sources Oracle sources for the token
  /// @param _oracleDatas Oracle encoded datas for the token
  function setPrimarySources(
    address _token,
    uint256 _maxPriceDeviation,
    IOracle[] memory _sources,
    bytes[] memory _oracleDatas
  ) external onlyGovernance {
    _setPrimarySources(_token, _maxPriceDeviation, _sources, _oracleDatas);
  }

  /// @dev Set oracle primary sources for multiple tokens
  /// @param _tokens List of token addresses to set oracle sources
  /// @param _maxPriceDeviationList List of max price deviations (in 1e18) for tokens
  /// @param _allSources List of oracle sources for tokens
  /// @param _oracleDatas Oracle encoded datas for the token
  function setMultiPrimarySources(
    address[] memory _tokens,
    uint256[] memory _maxPriceDeviationList,
    IOracle[][] memory _allSources,
    bytes[][] memory _oracleDatas
  ) external onlyGovernance {
    require(
      _tokens.length == _allSources.length,
      "CompositeOracle::setMultiPrimarySources::inconsistent length (all sources)"
    );
    require(
      _tokens.length == _oracleDatas.length,
      "CompositeOracle::setMultiPrimarySources::inconsistent length (oracle datas)"
    );
    require(
      _tokens.length == _maxPriceDeviationList.length,
      "CompositeOracle::setMultiPrimarySources::inconsistent length (maxPriceDeviationList)"
    );
    for (uint256 _idx = 0; _idx < _tokens.length; _idx++) {
      _setPrimarySources(_tokens[_idx], _maxPriceDeviationList[_idx], _allSources[_idx], _oracleDatas[_idx]);
    }
  }

  /// @dev Set oracle primary sources for tokens
  /// @param _token Token to set oracle sources
  /// @param _maxPriceDeviation Max price deviation (in 1e18) for token
  /// @param _sources Oracle sources for the token
  /// @param _oracleDatas Oracle encoded datas for the token
  function _setPrimarySources(
    address _token,
    uint256 _maxPriceDeviation,
    IOracle[] memory _sources,
    bytes[] memory _oracleDatas
  ) internal {
    primarySourceCount[_token] = _sources.length;
    require(
      _maxPriceDeviation >= MIN_PRICE_DEVIATION && _maxPriceDeviation <= MAX_PRICE_DEVIATION,
      "CompositeOracle::_setPrimarySources::bad max deviation value"
    );
    require(_sources.length == _oracleDatas.length, "CompositeOracle::_setPrimarySources::inconsistent length");
    require(_sources.length <= 3, "CompositeOracle::_setPrimarySources::sources length exceed 3");
    maxPriceDeviations[_token] = _maxPriceDeviation;
    for (uint256 _idx = 0; _idx < _sources.length; _idx++) {
      primarySources[_token][_idx] = _sources[_idx];
      oracleDatas[_token][_idx] = _oracleDatas[_idx];
    }
    emit LogSetPrimarySources(_token, _maxPriceDeviation, _sources);
  }

  /// @dev Get the latest exchange rate,
  /// if no valid (recent) rate is available, return false
  function get(bytes calldata _data) external view override returns (bool, uint256) {
    return (true, _get(_data));
  }

  /// @dev Check the last exchange rate without any state changes
  function peek(bytes calldata _data) public view override returns (bool, uint256) {
    return (true, _get(_data));
  }

  /// @dev internal function for getting a price
  function _get(bytes calldata _data) internal view returns (uint256) {
    address _token = abi.decode(_data, (address));
    uint256 _candidateSourceCount = primarySourceCount[_token];
    require(_candidateSourceCount > 0, "CompositeOracle::_get::no primary source");
    uint256[] memory _prices = new uint256[](_candidateSourceCount); // the less index, the higher priority
    uint256[] memory _unsortedPrices = new uint256[](_candidateSourceCount);

    // Get valid oracle sources
    uint256 _validSourceCount = 0;
    for (uint256 _idx = 0; _idx < _candidateSourceCount; _idx++) {
      try primarySources[_token][_idx].peek(oracleDatas[_token][_idx]) returns (
        bool, /*isSuccess*/
        uint256 price
      ) {
        _unsortedPrices[_validSourceCount] = price;
        _prices[_validSourceCount++] = price;
      } catch {}
    }
    require(_validSourceCount > 0, "CompositeOracle::_get::no valid source");
    for (uint256 i = 0; i < _validSourceCount - 1; i++) {
      for (uint256 j = 0; j < _validSourceCount - i - 1; j++) {
        if (_prices[j] > _prices[j + 1]) {
          (_prices[j], _prices[j + 1]) = (_prices[j + 1], _prices[j]);
        }
      }
    }
    uint256 _maxPriceDeviation = maxPriceDeviations[_token];

    // Algorithm:
    // - 1 valid source --> return price
    // - 2 valid sources
    //     --> if the the first primary source's price
    //     --> else revert
    // - 3 valid sources --> check deviation threshold of each pair
    //     --> if all within threshold, return the first primary source's price (should be from chainlink oracle)
    //     --> if one pair within threshold, return the first primary source of the pair
    //     --> if none, revert
    // - revert otherwise
    if (_validSourceCount == 1) {
      return _unsortedPrices[0]; // if 1 valid source, return that price
    }

    if (_validSourceCount == 2) {
      require(
        (_prices[1] * 1e18) / _prices[0] <= _maxPriceDeviation,
        "CompositeOracle::_get::too much deviation (2 valid sources)"
      );
      return _unsortedPrices[0]; // if 2 valid sources,  return the first registered price
    }

    if (_validSourceCount == 3) {
      bool _midMinOk = (_prices[1] * 1e18) / _prices[0] <= _maxPriceDeviation;
      bool _maxMidOk = (_prices[2] * 1e18) / _prices[1] <= _maxPriceDeviation;

      if (_midMinOk && _maxMidOk) {
        return _unsortedPrices[0]; // if 3 valid sources, use the first price
      }

      if (_midMinOk) {
        return _getPriceBasedOnPriorities(_unsortedPrices, _prices[0], _prices[1]);
      }

      if (_maxMidOk) {
        return _getPriceBasedOnPriorities(_unsortedPrices, _prices[1], _prices[2]);
      }

      revert("CompositeOracle::_get::too much deviation (3 valid sources)");
    }

    revert("CompositeOracle::_get::more than 3 valid sources not supported");
  }

  /// @dev internal function for getting a price based on priorities
  /// this is used when there are 3 valid sources
  /// @param _priceBasedOnPriorities Unsorted prices
  /// @param _p1 The first price
  /// @param _p2 The second price

  function _getPriceBasedOnPriorities(
    uint256[] memory _priceBasedOnPriorities,
    uint256 _p1,
    uint256 _p2
  ) internal pure returns (uint256) {
    if (_priceBasedOnPriorities[0] == _p1 || _priceBasedOnPriorities[0] == _p2) {
      return _priceBasedOnPriorities[0]; // if 2 valid sources, just validate if one of them are the one having the most priorities, otherwise return the first one
    }
    if (_priceBasedOnPriorities[1] == _p1 || _priceBasedOnPriorities[1] == _p2) {
      return _priceBasedOnPriorities[1]; // if 2 valid sources, just validate if one of them are the one having the most priorities, otherwise return the first one
    }
    return _priceBasedOnPriorities[2];
  }

  /// @dev Check the current spot exchange rate without any state changes
  function peekSpot(bytes calldata _data) external view override returns (uint256) {
    return _get(_data);
  }

  /// @dev Return the name of available oracles for a given token
  function name(bytes calldata _data) public view override returns (string memory) {
    address _token = abi.decode(_data, (address));
    uint256 _candidateSourceCount = primarySourceCount[_token];
    require(_candidateSourceCount > 0, "CompositeOracle::name::no primary source");

    // Get valid oracle sources
    bytes memory _concat;
    for (uint256 _idx = 0; _idx < _candidateSourceCount; _idx++) {
      try primarySources[_token][_idx].name(oracleDatas[_token][_idx]) returns (string memory _name) {
        _concat = _idx == _candidateSourceCount - 1
          ? abi.encodePacked(_concat, _name)
          : abi.encodePacked(_concat, _name, "+");
      } catch {}
    }

    return string(_concat);
  }

  /// @dev Return the symbol of available oracles for a given token
  function symbol(bytes calldata _data) public view override returns (string memory) {
    address _token = abi.decode(_data, (address));
    uint256 _candidateSourceCount = primarySourceCount[_token];
    require(_candidateSourceCount > 0, "CompositeOracle::symbol::no primary source");

    // Get valid oracle sources
    bytes memory _concat;
    for (uint256 _idx = 0; _idx < _candidateSourceCount; _idx++) {
      try primarySources[_token][_idx].symbol(oracleDatas[_token][_idx]) returns (string memory _symbol) {
        _concat = _idx == _candidateSourceCount - 1
          ? abi.encodePacked(_concat, _symbol)
          : abi.encodePacked(_concat, _symbol, "+");
      } catch {}
    }

    return string(_concat);
  }
}
