// SPDX-License-Identifier: MIT
pragma solidity 0.6.12;

interface IUbeswapPriceFeed {
  function consult() external view returns (uint256);
}
