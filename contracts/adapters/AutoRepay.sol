// SPDX-License-Identifier: MIT
pragma solidity 0.6.12;
pragma experimental ABIEncoderV2;

import {PercentageMath} from '../protocol/libraries/math/PercentageMath.sol';
import {EnumerableSet} from '@openzeppelin/contracts/utils/EnumerableSet.sol';

import {BaseUniswapAdapter} from './BaseUniswapAdapter.sol';
import {ILendingPoolAddressesProvider} from '../interfaces/ILendingPoolAddressesProvider.sol';
import {IUniswapV2Router02} from '../interfaces/IUniswapV2Router02.sol';
import {DataTypes} from '../protocol/libraries/types/DataTypes.sol';
import {IERC20} from '../dependencies/openzeppelin/contracts/IERC20.sol';
import {SafeERC20} from '../dependencies/openzeppelin/contracts/SafeERC20.sol';

contract AutoRepay is BaseUniswapAdapter {
  using SafeERC20 for IERC20;
  using PercentageMath for uint256;
  using EnumerableSet for EnumerableSet.AddressSet;

  event HealthFactorSet(address indexed user, uint256 min, uint256 max);

  /**
   * @dev struct RepayParams
   *
   * @param user Address of user
   * @param colalteralAsset Address of asset to be swapped
   * @param debtAsset Address of debt asset
   * @param collateralAmount Amount of the collateral to be swapped
   * @param debtRepayAmount Amount of the debt to be repaid
   * @param rateMode Rate mode of the debt to be repaid
   * @param useATokenAsFrom Use aToken as from in swap
   * @param useATokenAsTo Use aToken as to in swap
   * @param useFlashloan Use flahsloan for increasing health factor
   */
  struct RepayParams {
    address user;
    address collateralAsset;
    address debtAsset;
    address[] path;
    uint256 collateralAmount;
    uint256 debtRepayAmount;
    uint256 rateMode;
    bool useATokenAsFrom;
    bool useATokenAsTo;
    bool useFlashloan;
  }

  struct UserInfo {
    uint256 minHealthFactor;
    uint256 maxHealthFactor;
  }

  EnumerableSet.AddressSet private _whitelistedAddresses;

  mapping(address => UserInfo) public userInfos;

  uint256 public constant FEE = 10;
  uint256 public constant HUNDRED_PERCENT = 10000;

  constructor(
    ILendingPoolAddressesProvider addressesProvider,
    IUniswapV2Router02 uniswapRouter,
    address wethAddress
  ) public BaseUniswapAdapter(addressesProvider, uniswapRouter, wethAddress) {}

  function MAX_SLIPPAGE() public override pure returns (uint256) {
    return 200; //2%
  }

  function whitelistAddress(address userAddress) external onlyOwner returns (bool) {
    return _whitelistedAddresses.add(userAddress);
  }

  function removeFromWhitelist(address userAddress) external onlyOwner returns (bool) {
    return _whitelistedAddresses.remove(userAddress);
  }

  function isWhitelisted(address userAddress) public view returns (bool) {
    return _whitelistedAddresses.contains(userAddress);
  }

  function getWitelistedAddresses() external view returns (address[] memory) {
    uint256 length = _whitelistedAddresses.length();
    address[] memory addresses = new address[](length);
    for (uint256 i = 0; i < length; i++) {
      addresses[i] = _whitelistedAddresses.at(i);
    }
    return addresses;
  }

  function setMinMaxHealthFactor(uint256 minHealthFactor, uint256 maxHealthFactor) external {
    require(
      maxHealthFactor >= minHealthFactor,
      'maxHealthFactor should be more or equal than minHealthFactor'
    );
    userInfos[msg.sender] = UserInfo({
      minHealthFactor: minHealthFactor,
      maxHealthFactor: maxHealthFactor
    });
    emit HealthFactorSet(msg.sender, minHealthFactor, maxHealthFactor);
  }

  function _checkMinHealthFactor(address user) internal view returns (uint256) {
    (, , , , , uint256 healthFactor) = LENDING_POOL.getUserAccountData(user);
    require(
      healthFactor < userInfos[user].minHealthFactor,
      'User health factor must be less than minHealthFactor for user'
    );
    return healthFactor;
  }

  function _checkHealthFactorIncreased(address user, uint256 healthFactorBefore) internal view {
    (, , , , , uint256 healthFactor) = LENDING_POOL.getUserAccountData(user);
    require(
      healthFactor > healthFactorBefore && healthFactor <= userInfos[user].maxHealthFactor,
      'User health factor was not increased or more than maxHealthFactor'
    );
  }

  /**
   * @dev Uses the received funds from the flash loan to repay a debt on the protocol on behalf of the user. Then pulls
   * the collateral from the user and swaps it to the debt asset to repay the flash loan.
   * The user should give this contract allowance to pull the ATokens in order to withdraw the underlying asset, swap it
   * and repay the flash loan.
   * Supports only one asset on the flash loan.
   * @param assets Address of debt asset
   * @param amounts Amount of the debt to be repaid
   * @param premiums Fee of the flash loan
   * @param initiator Address of the flashloan caller
   * @param params Additional variadic field to include extra params. Expected parameters:
   *   RepayParams repayParams - See {RepayParams}
   *   PermitSignature permitSignature - struct containing the permit signature
   *   address caller - Address of increaseHealthFactor function caller
   */
  function executeOperation(
    address[] calldata assets,
    uint256[] calldata amounts,
    uint256[] calldata premiums,
    address initiator,
    bytes calldata params
  ) external override returns (bool) {
    require(msg.sender == address(LENDING_POOL), 'CALLER_MUST_BE_LENDING_POOL');
    require(initiator == address(this), 'Only this contract can call flashloan');
    (
      RepayParams memory repayParams,
      PermitSignature memory permitSignature,
      address caller
    ) = _decodeParams(params);
    repayParams.debtAsset = assets[0];
    repayParams.debtRepayAmount = amounts[0];

    // Repay debt. Approves for 0 first to comply with tokens that implement the anti frontrunning approval fix.
    {
      IERC20(repayParams.debtAsset).safeApprove(address(LENDING_POOL), 0);
      IERC20(repayParams.debtAsset).safeApprove(address(LENDING_POOL), repayParams.debtRepayAmount);
      uint256 repaidAmount = IERC20(repayParams.debtAsset).balanceOf(address(this));
      LENDING_POOL.repay(
        repayParams.debtAsset,
        repayParams.debtRepayAmount,
        repayParams.rateMode,
        repayParams.user
      );
      repaidAmount = repaidAmount.sub(IERC20(repayParams.debtAsset).balanceOf(address(this)));

      if (repaidAmount < repayParams.debtRepayAmount) {
        repayParams.collateralAmount = repayParams.collateralAmount.mul(repaidAmount).div(
          repayParams.debtRepayAmount
        );
      }

      repayParams.debtRepayAmount = repaidAmount;
    }

    _doSwapAndPullWithFee(repayParams, permitSignature, caller, premiums[0]);

    // Repay flashloan. Approves for 0 first to comply with tokens that implement the anti frontrunning approval fix.
    IERC20(repayParams.debtAsset).safeApprove(address(LENDING_POOL), 0);
    IERC20(repayParams.debtAsset).safeApprove(address(LENDING_POOL), amounts[0].add(premiums[0]));

    return true;
  }

  /**
   * @dev whitelisted address(caller) calls this function, repay debt from collateral
   * for the user, increases user health factor and take 0.1% fee from collateral
   *
   * @param repayParams See {RepayParams}
   * @param permitSignature struct containing the permit signature
   */
  function increaseHealthFactor(
    RepayParams memory repayParams,
    PermitSignature calldata permitSignature
  ) external {
    require(isWhitelisted(msg.sender), 'Caller is not whitelisted');
    uint256 healthFactorBefore = _checkMinHealthFactor(repayParams.user);
    if (repayParams.useFlashloan) {
      bytes memory params = abi.encode(repayParams, permitSignature, msg.sender);
      address[] memory assets = new address[](1);
      assets[0] = repayParams.debtAsset;
      uint256[] memory amounts = new uint256[](1);
      amounts[0] = repayParams.debtRepayAmount;
      uint256[] memory modes = new uint256[](1);
      modes[0] = 0;
      LENDING_POOL.flashLoan(address(this), assets, amounts, modes, repayParams.user, params, 0);
    } else {
      DataTypes.ReserveData memory debtReserveData = _getReserveData(repayParams.debtAsset);
      uint256 amountToRepay;
      {
        address debtToken = DataTypes.InterestRateMode(repayParams.rateMode) ==
          DataTypes.InterestRateMode.STABLE
          ? debtReserveData.stableDebtTokenAddress
          : debtReserveData.variableDebtTokenAddress;
        uint256 currentDebt = IERC20(debtToken).balanceOf(repayParams.user);
        amountToRepay = repayParams.debtRepayAmount <= currentDebt
          ? repayParams.debtRepayAmount
          : currentDebt;
      }
      if (amountToRepay < repayParams.debtRepayAmount) {
        repayParams.collateralAmount = repayParams.collateralAmount.mul(amountToRepay).div(
          repayParams.debtRepayAmount
        );
      }
      repayParams.debtRepayAmount = amountToRepay;
      _doSwapAndPullWithFee(repayParams, permitSignature, msg.sender, 0);

      // Repay debt. Approves 0 first to comply with tokens that implement the anti frontrunning approval fix
      IERC20(repayParams.debtAsset).safeApprove(address(LENDING_POOL), 0);
      IERC20(repayParams.debtAsset).safeApprove(address(LENDING_POOL), repayParams.debtRepayAmount);
      LENDING_POOL.repay(
        repayParams.debtAsset,
        repayParams.debtRepayAmount,
        repayParams.rateMode,
        repayParams.user
      );
    }
    _checkHealthFactorIncreased(repayParams.user, healthFactorBefore);
  }

  /**
   * @dev If the collateral asset is not equal to the debt asset,
   * then this function pulls tokens from the user, transfers the fee to the whitelisted caller,
   * and swaps the collateral asset to the debt asset.
   * Otherwise, if the collateral asset is equal to the debt asset then the function pulls tokens
   * from the user and transfers the fee to the whitelisted caller.
   *
   * @param repayParams See {RepayParams}
   * @param permitSignature struct containing the permit signature
   * @param caller address of increaseHealthFactor function caller
   * @param premium flashloan fee if called inside executeOperation otherwise 0
   */
  function _doSwapAndPullWithFee(
    RepayParams memory repayParams,
    PermitSignature memory permitSignature,
    address caller,
    uint256 premium
  ) internal {
    address collateralATokenAddress = _getReserveData(repayParams.collateralAsset).aTokenAddress;
    address debtATokenAddress = _getReserveData(repayParams.debtAsset).aTokenAddress;
    if (repayParams.collateralAsset != repayParams.debtAsset) {
      uint256 amounts0 = _getAmountsInWIthPath(
        repayParams.path,
        repayParams.debtRepayAmount.add(premium)
      )[0];

      require(amounts0 <= repayParams.collateralAmount, 'slippage too high');

      uint256 feeAmount = amounts0.mul(FEE).div(HUNDRED_PERCENT);

      _transferATokenToContractAddress(
        collateralATokenAddress,
        repayParams.user,
        amounts0.add(feeAmount),
        permitSignature
      );
      IERC20(collateralATokenAddress).safeTransfer(caller, feeAmount);
      if (!repayParams.useATokenAsFrom) {
        // Pull aTokens from user
        LENDING_POOL.withdraw(repayParams.collateralAsset, amounts0, address(this));
      }

      // Swap collateral asset to the debt asset
      _swapTokensForExactTokensWithPath(
        repayParams.collateralAsset,
        repayParams.debtAsset,
        repayParams.path,
        amounts0,
        repayParams.debtRepayAmount.add(premium)
      );

      if (repayParams.useATokenAsTo) {
        // withdraw debt AToken
        LENDING_POOL.withdraw(
          repayParams.debtAsset,
          IERC20(debtATokenAddress).balanceOf(address(this)),
          address(this)
        );
      }
    } else {
      uint256 feeAmount = repayParams.debtRepayAmount.mul(FEE).div(HUNDRED_PERCENT);
      uint256 aTokenTransferAmount = repayParams.debtRepayAmount.add(premium).add(feeAmount);
      _transferATokenToContractAddress(
        collateralATokenAddress,
        repayParams.user,
        aTokenTransferAmount,
        permitSignature
      );
      LENDING_POOL.withdraw(
        repayParams.collateralAsset,
        repayParams.debtRepayAmount.add(premium),
        address(this)
      );
      IERC20(collateralATokenAddress).safeTransfer(
        caller,
        IERC20(collateralATokenAddress).balanceOf(address(this))
      );
    }
  }

  function _decodeParams(bytes memory params)
    internal
    pure
    returns (
      RepayParams memory,
      PermitSignature memory,
      address
    )
  {
    (RepayParams memory repayParams, PermitSignature memory permitSignature, address caller) = abi
      .decode(params, (RepayParams, PermitSignature, address));

    return (repayParams, permitSignature, caller);
  }
}
