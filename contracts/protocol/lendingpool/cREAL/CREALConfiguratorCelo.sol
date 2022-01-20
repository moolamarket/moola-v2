pragma solidity 0.6.12;
pragma experimental ABIEncoderV2;

import {ERC20} from '../../../dependencies/openzeppelin/contracts/ERC20.sol';
import {Ownable} from '../../../dependencies/openzeppelin/contracts/Ownable.sol';
import '../../../protocol/lendingpool/LendingPoolConfigurator.sol';
import '../../../interfaces/ILendingPoolConfigurator.sol';

contract CREALConfiguratorCelo is Ownable {
  address constant lendingPoolConfiguratorAddress = 0x928F63a83217e427A84504950206834CBDa4Aa65;

  LendingPoolConfigurator public lendingPoolConfigurator =
    LendingPoolConfigurator(lendingPoolConfiguratorAddress);

  bytes constant params = '0x10';
  bool constant stableBorrowRateEnabled = true;
  uint8 constant underlyingAssetDecimals = 18;
  address constant cREALAddress = 0xe8537a3d056DA446677B9E9d6c5dB704EaAb4787;
  address constant aTokenImpl = 0x55bFCED2451b2154e06604D4269c9349F31141e6;
  address constant stableDebtTokenImpl = 0xaCdb7B3e2b0a038F1f4eF04736728E0065b689DA;
  address constant variableDebtTokenImpl = 0x0301Cf8F1FCD9255BD32FB7e0fE5B3494f445C2C;
  address constant interestRateStrategyAddress = 0xb3072f5F0d5e8B9036aEC29F37baB70E86EA0018;
  address constant treasury = 0x313bc86D3D6e86ba164B2B451cB0D9CfA7943e5c;
  address constant incentivesController = 0x0000000000000000000000000000000000000000;
  string constant underlyingAssetName = 'Celo Brazilian Real';
  string constant aTokenName = 'Moola interest bearing CREAL';
  string constant aTokenSymbol = 'mCREAL';
  string constant variableDebtTokenName = 'Moola variable debt bearing mCREAL';
  string constant variableDebtTokenSymbol = 'variableDebtmCREAL';
  string constant stableDebtTokenName = 'Moola stable debt bearing CREAL';
  string constant stableDebtTokenSymbol = 'stableDebtmCREAL';
  uint256 constant baseLTV = 7500;
  uint256 constant liquidationThreshold = 8000;
  uint256 constant liquidationBonus = 10500;
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
        underlyingAsset: cREALAddress,
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
      cREALAddress,
      baseLTV,
      liquidationThreshold,
      liquidationBonus
    );
  }

  function enableBorrowing() internal {
    lendingPoolConfigurator.enableBorrowingOnReserve(cREALAddress, stableBorrowRateEnabled);
  }

  function setReserveFactor() internal {
    lendingPoolConfigurator.setReserveFactor(cREALAddress, reserveFactor);
  }
}
