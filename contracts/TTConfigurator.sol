pragma solidity 0.6.12;
pragma experimental ABIEncoderV2;

import {ERC20} from './dependencies/openzeppelin/contracts/ERC20.sol';
import {Ownable} from './dependencies/openzeppelin/contracts/Ownable.sol';
import './protocol/lendingpool/LendingPoolConfigurator.sol';
import './interfaces/ILendingPoolConfigurator.sol';

contract TestToken is ERC20 {
  constructor() public ERC20('Test', 'TT') {
    _mint(msg.sender, 10000 * 10**18);
  }
}

contract TTConfigurator is Ownable {
  address constant lendingPoolConfiguratorAddress = 0x39fe2A4a4174bB5cAC5568ce0715a0b320bcB231;

  LendingPoolConfigurator public lendingPoolConfigurator =
    LendingPoolConfigurator(lendingPoolConfiguratorAddress);
  TestToken public testToken;
  address public assetAddress;

  bytes constant params = '0x10';
  bool constant stableBorrowRateEnabled = true;
  uint8 constant underlyingAssetDecimals = 18;
  address constant aTokenImpl = 0xe8B286649713447D8d5fBeBC28c731830d19B6C9;
  address constant stableDebtTokenImpl = 0xB6a5059A228a16Fa2827E28E52ceC96BBC63D639;
  address constant variableDebtTokenImpl = 0xB65b6a6a6F78E4daABF259c756567ae346699687;
  address constant interestRateStrategyAddress = 0x5B41b0c78659636c6664f08F7cCb620ceA3F1206;
  address constant treasury = 0x643C574128c7C56A1835e021Ad0EcC2592E72624;
  address constant incentivesController = 0x0000000000000000000000000000000000000000;
  string constant underlyingAssetName = 'Test Token';
  string constant aTokenName = 'Moola interest bearing TT';
  string constant aTokenSymbol = 'mTT';
  string constant variableDebtTokenName = 'Moola variable debt bearing TT';
  string constant variableDebtTokenSymbol = 'variableDebtTT';
  string constant stableDebtTokenName = 'Moola stable debt bearing TT';
  string constant stableDebtTokenSymbol = 'stableDebtTT';
  uint256 constant baseLTV = 7500;
  uint256 constant liquidationThreshold = 8000;
  uint256 constant liquidationBonus = 10500;
  uint256 constant reserveFactor = 1000;

  constructor() public {
    testToken = new TestToken();
    assetAddress = address(testToken);
  }

  function execute() external onlyOwner {
    createReserve();
    enableCollateral();
    enableBorrowing();
    setReserveFactor();
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
