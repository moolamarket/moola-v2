// SPDX-License-Identifier: MIT
pragma solidity 0.6.12;
pragma experimental ABIEncoderV2;

import {ERC20} from '../../../dependencies/openzeppelin/contracts/ERC20.sol';
import {Ownable} from '../../../dependencies/openzeppelin/contracts/Ownable.sol';
import '../../../protocol/lendingpool/LendingPoolConfigurator.sol';
import '../../../interfaces/ILendingPoolConfigurator.sol';

contract UBEConfiguratorCelo is Ownable {
  address constant lendingPoolConfiguratorAddress = 0x39fe2A4a4174bB5cAC5568ce0715a0b320bcB231;

  LendingPoolConfigurator public lendingPoolConfigurator =
    LendingPoolConfigurator(lendingPoolConfiguratorAddress);
  address constant assetAddress = 0x00Be915B9dCf56a3CBE739D9B9c202ca692409EC;

  bytes constant params = '0x10';
  bool constant stableBorrowRateEnabled = true;
  uint8 constant underlyingAssetDecimals = 18;
  address constant aTokenImpl = 0x55bFCED2451b2154e06604D4269c9349F31141e6;
  address constant stableDebtTokenImpl = 0xaCdb7B3e2b0a038F1f4eF04736728E0065b689DA;
  address constant variableDebtTokenImpl = 0x0301Cf8F1FCD9255BD32FB7e0fE5B3494f445C2C;
  address constant interestRateStrategyAddress = 0x801443470c119F2eac65F13886D9e293CdecE2DF;
  address constant treasury = 0x313bc86D3D6e86ba164B2B451cB0D9CfA7943e5c;
  address constant incentivesController = 0x0000000000000000000000000000000000000000;
  string constant underlyingAssetName = 'Ubeswap';
  string constant aTokenName = 'Moola interest bearing UBE';
  string constant aTokenSymbol = 'mUBE';
  string constant variableDebtTokenName = 'Moola variable debt bearing mUBE';
  string constant variableDebtTokenSymbol = 'variableDebtmUBE';
  string constant stableDebtTokenName = 'Moola stable debt bearing mUBE';
  string constant stableDebtTokenSymbol = 'stableDebtmUBE';
  uint256 constant baseLTV = 5000; // TODO-- wait for params
  uint256 constant liquidationThreshold = 6500;
  uint256 constant liquidationBonus = 11000;
  uint256 constant reserveFactor = 1000;

  function execute() external onlyOwner {
    createReserve();
    enableCollateral();
    enableBorrowing();
    setReserveFactor();

    selfdestruct(payable(treasury));
  }

  function destruct() external onlyOwner {
    selfdestruct(payable(treasury));
  }

  function createReserve() internal {
    ILendingPoolConfigurator.InitReserveInput[]
      memory inputs = new ILendingPoolConfigurator.InitReserveInput[](1);
    ILendingPoolConfigurator.InitReserveInput memory input = ILendingPoolConfigurator
      .InitReserveInput({
        aTokenImpl: aTokenImpl,
        stableDebtTokenImpl: stableDebtTokenImpl,
        variableDebtTokenImpl: variableDebtTokenImpl,
        underlyingAssetDecimals: underlyingAssetDecimals,
        interestRateStrategyAddress: interestRateStrategyAddress,
        underlyingAsset: assetAddress,
        treasury: treasury,
        incentivesController: incentivesController,
        underlyingAssetName: underlyingAssetName,
        aTokenName: aTokenName,
        aTokenSymbol: aTokenSymbol,
        variableDebtTokenName: variableDebtTokenName,
        variableDebtTokenSymbol: variableDebtTokenSymbol,
        stableDebtTokenName: stableDebtTokenName,
        stableDebtTokenSymbol: stableDebtTokenSymbol,
        params: params
      });
    inputs[0] = input;

    lendingPoolConfigurator.batchInitReserve(inputs);
  }

  function enableCollateral() internal {
    lendingPoolConfigurator.configureReserveAsCollateral(
      assetAddress,
      baseLTV,
      liquidationThreshold,
      liquidationBonus
    );
  }

  function enableBorrowing() internal {
    lendingPoolConfigurator.enableBorrowingOnReserve(assetAddress, stableBorrowRateEnabled);
  }

  function setReserveFactor() internal {
    lendingPoolConfigurator.setReserveFactor(assetAddress, reserveFactor);
  }
}
