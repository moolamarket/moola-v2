// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.6.12;

import '../protocol/lendingpool/LendingPool.sol';

/**
 * @title LPImplementationInitializer
 * @notice Initializes LendingPool implementation contract.
 * @author Moola
 **/
contract LPImplementationInitializer {
  constructor(
    ILendingPoolAddressesProvider _ap,
    LendingPool _lp)
  public {
    _lp.initialize(_ap);
  }
}

contract LPImplementationInitializerProd is LPImplementationInitializer(
  ILendingPoolAddressesProvider(0xD1088091A174d33412a968Fa34Cb67131188B332),
  LendingPool(0xBecd348aa5cC976BE8E82ca6f13BC3B53197711F)) {}
