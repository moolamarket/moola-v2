// SPDX-License-Identifier: MIT
pragma solidity 0.6.12;
pragma experimental ABIEncoderV2;

import {BaseUniswapAdapter} from './BaseUniswapAdapter.sol';
import {ILendingPoolAddressesProvider} from '../interfaces/ILendingPoolAddressesProvider.sol';
import {IUniswapV2Router02} from '../interfaces/IUniswapV2Router02.sol';
import {DataTypes} from '../protocol/libraries/types/DataTypes.sol';
import {IERC20} from '../dependencies/openzeppelin/contracts/IERC20.sol';
import {SafeERC20} from '../dependencies/openzeppelin/contracts/SafeERC20.sol';

contract AutoRepay is BaseUniswapAdapter {
  using SafeERC20 for IERC20;

  struct RepayParams {
    address user;
    address collateralAsset;
    address caller;
    uint256 collateralAmount;
    uint256 rateMode;
    PermitSignature permitSignature;
    bool useEthPath;
    bool useATokenAsFrom;
    bool useATokenAsTo;
  }

  struct UserInfo {
    uint256 minHealthFactor;
    uint256 maxHealthFactor;
  }

  mapping(address => UserInfo) public userInfos;

  uint256 public constant FEE = 10;
  uint256 public constant FEE_DECIMALS = 10000;

  constructor(
    ILendingPoolAddressesProvider addressesProvider,
    IUniswapV2Router02 uniswapRouter,
    address wethAddress
  ) public BaseUniswapAdapter(addressesProvider, uniswapRouter, wethAddress) {}

  function setMinMaxHealthFactor(uint256 minHealthFactor, uint256 maxHealthFactor) public {
    require(
      maxHealthFactor >= minHealthFactor,
      'maxHealthFactor should be more or equal than minHealthFactor'
    );
    userInfos[msg.sender] = UserInfo({
      minHealthFactor: minHealthFactor,
      maxHealthFactor: maxHealthFactor
    });
  }

  function _checkMinHealthFactor(address user) internal view {
    (, , , , , uint256 healthFactor) = LENDING_POOL.getUserAccountData(user);
    require(
      healthFactor < userInfos[user].minHealthFactor,
      'User health factor must be less than minHealthFactor for user'
    );
  }

  function _checkHealthFactorInRange(address user) internal view {
    (, , , , , uint256 healthFactor) = LENDING_POOL.getUserAccountData(user);
    require(
      healthFactor >= userInfos[user].minHealthFactor &&
        healthFactor <= userInfos[user].maxHealthFactor,
      'User health factor must be in range {from minHealthFactor to maxHealthFactor}'
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
   * @param params Additional variadic field to include extra params. Expected parameters:
   *   address collateralAsset Address of the reserve to be swapped
   *   uint256 collateralAmount Amount of reserve to be swapped
   *   uint256 rateMode Rate modes of the debt to be repaid
   *   uint256 permitAmount Amount for the permit signature
   *   uint256 deadline Deadline for the permit signature
   *   uint8 v V param for the permit signature
   *   bytes32 r R param for the permit signature
   *   bytes32 s S param for the permit signature
   */
  function executeOperation(
    address[] calldata assets,
    uint256[] calldata amounts,
    uint256[] calldata premiums,
    address,
    bytes calldata params
  ) external override returns (bool) {
    require(msg.sender == address(LENDING_POOL), 'CALLER_MUST_BE_LENDING_POOL');

    RepayParams memory decodedParams = _decodeParams(params);

    // Repay debt. Approves for 0 first to comply with tokens that implement the anti frontrunning approval fix.
    IERC20(assets[0]).safeApprove(address(LENDING_POOL), 0);
    IERC20(assets[0]).safeApprove(address(LENDING_POOL), amounts[0]);
    uint256 repaidAmount = IERC20(assets[0]).balanceOf(address(this));
    LENDING_POOL.repay(assets[0], amounts[0], decodedParams.rateMode, decodedParams.user);
    repaidAmount = repaidAmount.sub(IERC20(assets[0]).balanceOf(address(this)));

    uint256 maxCollateralToSwap = decodedParams.collateralAmount;
    if (repaidAmount < amounts[0]) {
      maxCollateralToSwap = maxCollateralToSwap.mul(repaidAmount).div(amounts[0]);
    }

    _doSwapAndPullWithFee(
      [decodedParams.user, decodedParams.collateralAsset, assets[0], decodedParams.caller],
      [repaidAmount, maxCollateralToSwap, premiums[0]],
      decodedParams.permitSignature,
      [decodedParams.useEthPath, decodedParams.useATokenAsFrom, decodedParams.useATokenAsTo]
    );

    // Repay flashloan. Approves for 0 first to comply with tokens that implement the anti frontrunning approval fix.
    IERC20(assets[0]).safeApprove(address(LENDING_POOL), 0);
    IERC20(assets[0]).safeApprove(address(LENDING_POOL), amounts[0].add(premiums[0]));

    return true;
  }

  function increaseHealthFactor(
    address[3] memory addressParams, // user, collateralAsset, debtAsset,
    uint256[3] memory uintParams, // collateralAmount, debtRepayAmount, debtRateMode,
    PermitSignature calldata permitSignature,
    bool[4] memory boolParams // useEthPath, useATokenAsFrom, useATokenAsTo, useFlashloan
  ) public {
    _checkMinHealthFactor(addressParams[0]);
    if (boolParams[3]) {
      bytes memory params = abi.encode(
        [addressParams[0], addressParams[1], msg.sender],
        uintParams[0],
        uintParams[2],
        permitSignature.amount,
        permitSignature.deadline,
        permitSignature.v,
        permitSignature.r,
        permitSignature.s,
        [boolParams[0], boolParams[1], boolParams[2]]
      );
      address[] memory assets = new address[](1);
      assets[0] = addressParams[2];
      uint256[] memory amounts = new uint256[](1);
      amounts[0] = uintParams[1];
      uint256[] memory modes = new uint256[](1);
      modes[0] = 0;
      LENDING_POOL.flashLoan(address(this), assets, amounts, modes, addressParams[0], params, 0);
    } else {
      DataTypes.ReserveData memory debtReserveData = _getReserveData(addressParams[2]);
      uint256 amountToRepay;
      {
        address debtToken = DataTypes.InterestRateMode(uintParams[2]) ==
          DataTypes.InterestRateMode.STABLE
          ? debtReserveData.stableDebtTokenAddress
          : debtReserveData.variableDebtTokenAddress;
        uint256 currentDebt = IERC20(debtToken).balanceOf(addressParams[0]);
        amountToRepay = uintParams[1] <= currentDebt ? uintParams[1] : currentDebt;
      }
      uint256 maxCollateralToSwap = uintParams[0];
      if (amountToRepay < uintParams[1]) {
        maxCollateralToSwap = maxCollateralToSwap.mul(amountToRepay).div(uintParams[1]);
      }
      _doSwapAndPullWithFee(
        [addressParams[0], addressParams[1], addressParams[2], msg.sender],
        [amountToRepay, maxCollateralToSwap, 0],
        permitSignature,
        [boolParams[0], boolParams[1], boolParams[2]]
      );

      // Repay debt. Approves 0 first to comply with tokens that implement the anti frontrunning approval fix
      IERC20(addressParams[2]).safeApprove(address(LENDING_POOL), 0);
      IERC20(addressParams[2]).safeApprove(address(LENDING_POOL), amountToRepay);
      LENDING_POOL.repay(addressParams[2], amountToRepay, uintParams[2], addressParams[0]);
    }
    _checkHealthFactorInRange(addressParams[0]);
  }

  function _doSwapAndPullWithFee(
    address[4] memory addressParams, // user, collateralAsset, debtAsset, caller
    uint256[3] memory uintParams, // amountToRepay, maxCollateralToSwap, premium
    PermitSignature memory permitSignature,
    bool[3] memory boolParams // useEthPath, useATokenAsFrom, useATokenASTo
  ) internal {
    address collateralATokenAddress = _getReserveData(addressParams[1]).aTokenAddress;
    address debtATokenAddress = _getReserveData(addressParams[2]).aTokenAddress;
    if (addressParams[1] != addressParams[2]) {
      uint256 amounts0 = _getAmountsIn(
        boolParams[1] ? collateralATokenAddress : addressParams[1],
        boolParams[2] ? debtATokenAddress : addressParams[2],
        uintParams[0].add(uintParams[2]),
        boolParams[0]
      )[0];
      require(amounts0 <= uintParams[1], 'slippage too high');
      uint256 feeAmount = amounts0.mul(FEE).div(FEE_DECIMALS);

      if (boolParams[1]) {
        // Transfer aTokens from user to contract address
        _transferATokenToContractAddress(
          collateralATokenAddress,
          addressParams[0],
          amounts0.add(feeAmount),
          permitSignature
        );
        LENDING_POOL.withdraw(addressParams[1], feeAmount, addressParams[3]);
      } else {
        // Pull aTokens from user
        _pullAToken(
          addressParams[1],
          collateralATokenAddress,
          addressParams[0],
          amounts0.add(feeAmount),
          permitSignature
        );
        IERC20(addressParams[1]).safeTransfer(addressParams[3], feeAmount);
      }

      // Swap collateral asset to the debt asset
      _swapTokensForExactTokens(
        addressParams[1],
        addressParams[2],
        boolParams[1] ? collateralATokenAddress : addressParams[1],
        boolParams[2] ? debtATokenAddress : addressParams[2],
        amounts0,
        uintParams[0].add(uintParams[2]),
        boolParams[0]
      );

      if (boolParams[2]) {
        // withdraw debt AToken
        LENDING_POOL.withdraw(
          addressParams[2],
          IERC20(debtATokenAddress).balanceOf(address(this)),
          address(this)
        );
      }
    } else {
      uint256 feeAmount = uintParams[0].mul(FEE).div(FEE_DECIMALS);
      // Pull aTokens from user
      _pullAToken(
        addressParams[1],
        collateralATokenAddress,
        addressParams[0],
        uintParams[0].add(uintParams[2]).add(feeAmount),
        permitSignature
      );
      IERC20(addressParams[1]).safeTransfer(addressParams[3], feeAmount);
    }
  }

  function _decodeParams(bytes memory params) internal pure returns (RepayParams memory) {
    (
      address[3] memory addressParams, // user, collateralAsset, caller,
      uint256 collateralAmount,
      uint256 rateMode,
      uint256 permitAmount,
      uint256 deadline,
      uint8 v,
      bytes32 r,
      bytes32 s,
      bool[3] memory boolParams // useEthPath, useATokenAsFrom, useATokenAsTo
    ) = abi.decode(
        params,
        (address[3], uint256, uint256, uint256, uint256, uint8, bytes32, bytes32, bool[3])
      );

    return
      RepayParams(
        addressParams[0],
        addressParams[1],
        addressParams[2],
        collateralAmount,
        rateMode,
        PermitSignature(permitAmount, deadline, v, r, s),
        boolParams[0],
        boolParams[1],
        boolParams[2]
      );
  }
}
