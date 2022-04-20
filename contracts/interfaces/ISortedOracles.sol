// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.6.12;

interface ISortedOracles {
  function medianRate(address) external view returns (uint256, uint256);

  function medianTimestamp(address) external view returns (uint256);

  function isOldestReportExpired(address token) external view returns (bool, address);
}
