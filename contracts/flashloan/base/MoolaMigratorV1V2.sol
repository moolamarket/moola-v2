// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.6.12;

import {IERC20} from '../../dependencies/openzeppelin/contracts/IERC20.sol';
import {ILendingPoolAddressesProvider as ILendingPoolAddressesProviderV2} from '../../interfaces/ILendingPoolAddressesProvider.sol';
import {ILendingPool as ILendingPoolV2} from '../../interfaces/ILendingPool.sol';
import {DataTypes} from '../../protocol/libraries/types/DataTypes.sol';

interface ILendingPoolAddressesProviderV1 {
  function getLendingPool() external view returns (address);
  function getLendingPoolCore() external view returns (address);
}

interface ILendingPoolV1 {
  function getUserReserveData(IERC20 _reserve, address _user)
    external
    view
    returns (
      uint256,
      uint256 currentBorrowBalance,
      uint256[4] calldata,
      uint256 originationFee
    );

  function getReserveData(IERC20 _reserve)
    external
    view
    returns (
      uint256[11] calldata,
      IMTokenV1 aTokenAddress
    );

  function repay(IERC20 _reserve, uint256 _amount, address payable _onBehalfOf)
    external
    payable;
}

interface IMTokenV1 {
  function redeem(uint amount) external;
  function balanceOf(address user) external view returns(uint);
  function transferFrom(address from, address to, uint amount) external returns(bool);
}

contract MoolaMigratorV1V2 {
  ILendingPoolAddressesProviderV1 public immutable ADDRESSES_PROVIDER_V1;
  ILendingPoolAddressesProviderV2 public immutable ADDRESSES_PROVIDER_V2;
  ILendingPoolV1 public immutable LENDING_POOL_V1;
  ILendingPoolV2 public immutable LENDING_POOL_V2;
  address public immutable LENDING_POOL_CORE_V1;
  IMTokenV1 public immutable mCUSD_V1;
  IMTokenV1 public immutable mCEUR_V1;
  IMTokenV1 public immutable mCELO_V1;
  IERC20 public immutable CUSD;
  IERC20 public immutable CEUR;
  IERC20 public immutable CELO;
  IERC20 public constant RESERVE_CELO = IERC20(0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE);

  constructor(
    ILendingPoolAddressesProviderV1 providerV1, ILendingPoolAddressesProviderV2 providerV2,
    IERC20 cusd, IERC20 ceur, IERC20 celo)
  public {
    ADDRESSES_PROVIDER_V1 = providerV1;
    ADDRESSES_PROVIDER_V2 = providerV2;
    CUSD = cusd;
    CEUR = ceur;
    CELO = celo;
    ILendingPoolV1 poolV1 = ILendingPoolV1(providerV1.getLendingPool());
    LENDING_POOL_V1 = poolV1;
    address poolV2 = providerV2.getLendingPool();
    LENDING_POOL_V2 = ILendingPoolV2(poolV2);
    address coreV1 = providerV1.getLendingPoolCore();
    LENDING_POOL_CORE_V1 = coreV1;
    cusd.approve(coreV1, type(uint).max);
    ceur.approve(coreV1, type(uint).max);
    cusd.approve(poolV2, type(uint).max);
    ceur.approve(poolV2, type(uint).max);
    celo.approve(poolV2, type(uint).max);
    (, mCUSD_V1) = poolV1.getReserveData(cusd);
    (, mCEUR_V1) = poolV1.getReserveData(ceur);
    (, mCELO_V1) = poolV1.getReserveData(RESERVE_CELO);
  }

  function migrate() external {
    uint originationFee;
    uint debtCUSD;
    uint debtCEUR;
    uint debtCELO;
    (, debtCUSD, , originationFee) = LENDING_POOL_V1.getUserReserveData(CUSD, msg.sender);
    debtCUSD = debtCUSD + originationFee;
    (, debtCEUR, , originationFee) = LENDING_POOL_V1.getUserReserveData(CEUR, msg.sender);
    debtCEUR = debtCEUR + originationFee;
    (, debtCELO, , originationFee) = LENDING_POOL_V1.getUserReserveData(RESERVE_CELO, msg.sender);
    debtCELO = debtCELO + originationFee;
    uint debts = 0;
    if (debtCUSD > 0) debts++;
    if (debtCEUR > 0) debts++;
    if (debtCELO > 0) debts++;
    if (debts == 0) {
      migrateCollateral(msg.sender);
      return;
    }
    uint position = 0;
    address[] memory assets = new address[](debts);
    uint[] memory amounts = new uint[](debts);
    uint[] memory modes = new uint[](debts);
    if (debtCUSD > 0) {
      assets[position] = address(CUSD);
      amounts[position] = debtCUSD;
      modes[position] = uint(DataTypes.InterestRateMode.VARIABLE);
      position++;
    }
    if (debtCEUR > 0) {
      assets[position] = address(CEUR);
      amounts[position] = debtCEUR;
      modes[position] = uint(DataTypes.InterestRateMode.VARIABLE);
      position++;
    }
    if (debtCELO > 0) {
      assets[position] = address(CELO);
      amounts[position] = debtCELO;
      modes[position] = uint(DataTypes.InterestRateMode.VARIABLE);
    }
    LENDING_POOL_V2.flashLoan(address(this), assets, amounts, modes, msg.sender, abi.encode(msg.sender), 0);
  }

  function executeOperation(
    IERC20[] calldata assets,
    uint256[] calldata amounts,
    uint256[] calldata,
    address initiator,
    bytes calldata params
  ) external returns (bool) {
    require(msg.sender == address(LENDING_POOL_V2), 'Migrator:executeOperation: invalid caller');
    require(address(this) == initiator, 'Migrator:executeOperation: invalid initiator');
    address payable user = payable(abi.decode(params, (address)));
    for (uint i = 0; i < assets.length; i++) {
      if (assets[i] == CELO) {
        LENDING_POOL_V1.repay{value: amounts[i]}(RESERVE_CELO, amounts[i], user);
        continue;
      }
      LENDING_POOL_V1.repay(assets[i], amounts[i], user);
    }
    migrateCollateral(user);
    return true;
  }

  function migrateCollateral(address user) internal {
    uint mBalance = mCUSD_V1.balanceOf(user);
    if (mBalance > 0) {
      mCUSD_V1.transferFrom(user, address(this), mBalance);
      mCUSD_V1.redeem(mBalance);
      LENDING_POOL_V2.deposit(address(CUSD), mBalance, user, 0);
    }
    mBalance = mCEUR_V1.balanceOf(user);
    if (mBalance > 0) {
      mCEUR_V1.transferFrom(user, address(this), mBalance);
      mCEUR_V1.redeem(mBalance);
      LENDING_POOL_V2.deposit(address(CEUR), mBalance, user, 0);
    }
    mBalance = mCELO_V1.balanceOf(user);
    if (mBalance > 0) {
      mCELO_V1.transferFrom(user, address(this), mBalance);
      mCELO_V1.redeem(mBalance);
      LENDING_POOL_V2.deposit(address(CELO), mBalance, user, 0);
    }
  }

  receive () external payable {}
  fallback () external payable {}
}

contract MoolaMigratorV1V2Alfajores is
  MoolaMigratorV1V2(ILendingPoolAddressesProviderV1(0x6EAE47ccEFF3c3Ac94971704ccd25C7820121483),
    ILendingPoolAddressesProviderV2(0xb3072f5F0d5e8B9036aEC29F37baB70E86EA0018),
    IERC20(0x874069Fa1Eb16D44d622F2e0Ca25eeA172369bC1),
    IERC20(0x10c892A6EC43a53E45D0B916B4b7D383B1b78C0F),
    IERC20(0xF194afDf50B03e69Bd7D057c1Aa9e10c9954E4C9)) {}

contract MoolaMigratorV1V2Celo is
  MoolaMigratorV1V2(ILendingPoolAddressesProviderV1(0x7AAaD5a5fa74Aec83b74C2a098FBC86E17Ce4aEA),
    ILendingPoolAddressesProviderV2(0xD1088091A174d33412a968Fa34Cb67131188B332),
    IERC20(0x765DE816845861e75A25fCA122bb6898B8B1282a),
    IERC20(0xD8763CBa276a3738E6DE85b4b3bF5FDed6D6cA73),
    IERC20(0x471EcE3750Da237f93B8E339c536989b8978a438)) {}