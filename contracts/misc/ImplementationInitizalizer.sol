// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.6.12;

import '../protocol/lendingpool/LendingPool.sol';
import '../protocol/lendingpool/LendingPoolConfigurator.sol';
import '../protocol/tokenization/AToken.sol';
import '../protocol/tokenization/VariableDebtToken.sol';
import '../protocol/tokenization/StableDebtToken.sol';

/**
 * @title ImplementationInitializer
 * @notice Initializes implementation contracts.
 * @author Moola
 **/
contract ImplementationInitializer {
  constructor(
    ILendingPoolAddressesProvider _ap,
    LendingPool _lp,
    LendingPoolConfigurator _lpc,
    AToken _at,
    AToken _dat,
    VariableDebtToken _vat,
    StableDebtToken _sat)
  public {
    _lp.initialize(_ap);
    _lpc.initialize(_ap);
    _at.initialize(ILendingPool(0), address(0), address(0), IAaveIncentivesController(0), 0, '', '', '');
    if (address(_dat) > address(0)) {
      _dat.initialize(ILendingPool(0), address(0), address(0), IAaveIncentivesController(0), 0, '', '', '');
    }
    _vat.initialize(ILendingPool(0), address(0), IAaveIncentivesController(0), 0, '', '', '');
    _sat.initialize(ILendingPool(0), address(0), IAaveIncentivesController(0), 0, '', '', '');
  }
}

