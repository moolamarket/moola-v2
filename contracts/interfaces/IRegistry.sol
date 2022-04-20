// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.6.12;

interface IRegistry {
  function getAddressForOrDie(bytes32) external view returns (address);
}