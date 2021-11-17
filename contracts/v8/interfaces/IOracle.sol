// SPDX-License-Identifier: MIT
/**
  |¯¯¯¯¯|||¯¯¯¯|  '      /¯¯¯¯¯| |¯¯¯¯¯|°
  |    ¯¯|  |       |__   /     !     | |         | 
  |__|¯¯'  |______| /___/¯|__'|  ¯|__|¯  
*/

pragma solidity 0.8.9;

interface IOracle {
  function get(bytes calldata data) external view returns (bool _success, uint256 _rate);

  function symbol(bytes calldata data) external view returns (string memory);

  function name(bytes calldata data) external view returns (string memory);
}
