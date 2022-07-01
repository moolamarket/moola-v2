// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.6.12;
pragma experimental ABIEncoderV2;

import {BaseUniswapAdapter} from './BaseUniswapAdapter.sol';
import {ILendingPoolAddressesProvider} from '../interfaces/ILendingPoolAddressesProvider.sol';
import {IUniswapV2Router02} from '../interfaces/IUniswapV2Router02.sol';
import {IERC20} from '../dependencies/openzeppelin/contracts/IERC20.sol';
import {DataTypes} from '../protocol/libraries/types/DataTypes.sol';

/**
 * @title UniswapRepayAdapter
 * @notice Uniswap V2 Adapter to perform a repay of a debt with collateral.
 * @author Aave
 **/
contract UniswapRepayAdapter is BaseUniswapAdapter {
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
    bool useFlashLoan;
  }

  constructor(
    ILendingPoolAddressesProvider addressesProvider,
    IUniswapV2Router02 uniswapRouter,
    address wethAddress
  ) public BaseUniswapAdapter(addressesProvider, uniswapRouter, wethAddress) {}

  /**
   * @dev Uses the received funds from the flash loan to repay a debt on the protocol on behalf of the user. Then pulls
   * the collateral from the user and swaps it to the debt asset to repay the flash loan.
   * The user should give this contract allowance to pull the ATokens in order to withdraw the underlying asset, swap it
   * and repay the flash loan.
   * Supports only one asset on the flash loan.
   * @param assets Address of debt asset
   * @param amounts Amount of the debt to be repaid
   * @param premiums Fee of the flash loan
   * @param initiator Address of the user
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
    address initiator,
    bytes calldata params
  ) external override returns (bool) {
    require(msg.sender == address(LENDING_POOL), 'CALLER_MUST_BE_LENDING_POOL');

    (RepayParams memory decodedParams, PermitSignature memory permitSignature) = _decodeParams(
      params
    );

    _swapAndRepayWithPath(
      decodedParams.collateralAsset,
      assets[0],
      decodedParams.path,
      amounts[0],
      decodedParams.collateralAmount,
      decodedParams.rateMode,
      initiator,
      premiums[0],
      permitSignature,
      decodedParams.useATokenAsFrom,
      decodedParams.useATokenAsTo
    );

    return true;
  }

  function repayFromCollateral(
    RepayParams memory repayParams,
    PermitSignature calldata permitSignature
  ) external {
    if (repayParams.useFlashLoan) {
      bytes memory params = abi.encode(repayParams, permitSignature);
      address[] memory assets = new address[](1);
      assets[0] = repayParams.debtAsset;
      uint256[] memory amounts = new uint256[](1);
      amounts[0] = repayParams.debtRepayAmount;
      uint256[] memory modes = new uint256[](1);
      modes[0] = 0;
      LENDING_POOL.flashLoan(address(this), assets, amounts, modes, repayParams.user, params, 0);
    } else {
      swapAndRepayWithPath(
        repayParams.collateralAsset,
        repayParams.debtAsset,
        repayParams.path,
        repayParams.collateralAmount,
        repayParams.debtRepayAmount,
        repayParams.rateMode,
        permitSignature,
        repayParams.useATokenAsFrom,
        repayParams.useATokenAsTo
      );
    }
  }

  /**
   * @dev Swaps the user collateral for the debt asset and then repay the debt on the protocol on behalf of the user
   * without using flash loans. This method can be used when the temporary transfer of the collateral asset to this
   * contract does not affect the user position.
   * The user should give this contract allowance to pull the ATokens in order to withdraw the underlying asset
   * @param collateralAsset Address of asset to be swapped
   * @param debtAsset Address of debt asset
   * @param path Path for swapping collateralAsset into debtAsset
   * @param collateralAmount Amount of the collateral to be swapped
   * @param debtRepayAmount Amount of the debt to be repaid
   * @param debtRateMode Rate mode of the debt to be repaid
   * @param permitSignature struct containing the permit signature
   * @param useATokenAsFrom use corresponding aToken instead of collateralAsset in swap
   * @param useATokenAsTo use corresponding aToken instead of debtAsset in swap
   */
  function swapAndRepayWithPath(
    address collateralAsset,
    address debtAsset,
    address[] memory path,
    uint256 collateralAmount,
    uint256 debtRepayAmount,
    uint256 debtRateMode,
    PermitSignature calldata permitSignature,
    bool useATokenAsFrom,
    bool useATokenAsTo
  ) public {
    DataTypes.ReserveData memory debtReserveData = _getReserveData(debtAsset);

    uint256 amountToRepay;
    {
      address debtToken = DataTypes.InterestRateMode(debtRateMode) ==
        DataTypes.InterestRateMode.STABLE
        ? debtReserveData.stableDebtTokenAddress
        : debtReserveData.variableDebtTokenAddress;
      uint256 currentDebt = IERC20(debtToken).balanceOf(msg.sender);
      amountToRepay = debtRepayAmount <= currentDebt ? debtRepayAmount : currentDebt;
    }
    uint256 maxCollateralToSwap = collateralAmount;
    if (amountToRepay < debtRepayAmount) {
      maxCollateralToSwap = maxCollateralToSwap.mul(amountToRepay).div(debtRepayAmount);
    }

    _doSwapAndPullWithPath(
      collateralAsset,
      debtAsset,
      path,
      msg.sender,
      0,
      permitSignature,
      useATokenAsFrom,
      useATokenAsTo,
      amountToRepay,
      maxCollateralToSwap
    );

    // Repay debt. Approves 0 first to comply with tokens that implement the anti frontrunning approval fix
    IERC20(debtAsset).safeApprove(address(LENDING_POOL), 0);
    IERC20(debtAsset).safeApprove(address(LENDING_POOL), amountToRepay);
    LENDING_POOL.repay(debtAsset, amountToRepay, debtRateMode, msg.sender);
  }

  /**
   * @dev Pulls the initiator collateral and swaps to repay the flash loan(if needed)
   *
   * @param collateralAsset Address of token to be swapped
   * @param debtAsset Address of debt token to be received from the swap
   * @param path Path for swapping collateralAsset into debtAsset
   * @param user Address of the user
   * @param premium Fee of the flash loan
   * @param permitSignature struct containing the permit signature
   * @param useATokenAsFrom use corresponding aToken instead of collateralAsset in swap
   * @param useATokenAsTo use corresponding aToken instead of debtAsset in swap
   * @param amountToRepay amount that transferred in repay
   * @param maxCollateralToSwap maximum amount of collateral to swap
   */
  function _doSwapAndPullWithPath(
    address collateralAsset,
    address debtAsset,
    address[] memory path,
    address user,
    uint256 premium,
    PermitSignature memory permitSignature,
    bool useATokenAsFrom,
    bool useATokenAsTo,
    uint256 amountToRepay,
    uint256 maxCollateralToSwap
  ) internal {
    address collateralATokenAddress = _getReserveData(collateralAsset).aTokenAddress;
    if (collateralAsset != debtAsset) {
      // NOTE: commented for fixing stack too deep error
      // address debtATokenAddress = _getReserveData(debtAsset).aTokenAddress;
      // uint256 neededForFlashLoanDebt = repaidAmount.add(premium);
      uint256 amounts0 = _getAmountsInWIthPath(path, amountToRepay.add(premium))[0];
      require(amounts0 <= maxCollateralToSwap, 'slippage too high');

      if (useATokenAsFrom) {
        // Transfer aTokens from user to contract address
        _transferATokenToContractAddress(collateralATokenAddress, user, amounts0, permitSignature);
      } else {
        // Pull aTokens from user
        _pullAToken(collateralAsset, collateralATokenAddress, user, amounts0, permitSignature);
      }

      // Swap collateral asset to the debt asset
      _swapTokensForExactTokensWithPath(
        collateralAsset,
        debtAsset,
        path,
        amounts0,
        amountToRepay.add(premium)
      );

      if (useATokenAsTo) {
        // withdraw debt AToken
        LENDING_POOL.withdraw(
          debtAsset,
          IERC20(_getReserveData(debtAsset).aTokenAddress).balanceOf(address(this)),
          address(this)
        );
      }
    } else {
      // Pull aTokens from user
      _pullAToken(
        collateralAsset,
        _getReserveData(collateralAsset).aTokenAddress,
        user,
        amountToRepay.add(premium),
        permitSignature
      );
    }
  }

  /**
   * @dev Perform the repay of the debt, pulls the initiator collateral and swaps to repay the flash loan
   *
   * @param collateralAsset Address of token to be swapped
   * @param debtAsset Address of debt token to be received from the swap
   * @param path Path for swapping collateralAsset into debtAsset
   * @param amount Amount of the debt to be repaid
   * @param collateralAmount Amount of the reserve to be swapped
   * @param rateMode Rate mode of the debt to be repaid
   * @param initiator Address of the user
   * @param premium Fee of the flash loan
   * @param permitSignature struct containing the permit signature
   * @param useATokenAsFrom use corresponding aToken instead of collateralAsset in swap
   * @param useATokenAsTo use corresponding aToken instead of debtAsset in swap
   */
  function _swapAndRepayWithPath(
    address collateralAsset,
    address debtAsset,
    address[] memory path,
    uint256 amount,
    uint256 collateralAmount,
    uint256 rateMode,
    address initiator,
    uint256 premium,
    PermitSignature memory permitSignature,
    bool useATokenAsFrom,
    bool useATokenAsTo
  ) internal {
    // Repay debt. Approves for 0 first to comply with tokens that implement the anti frontrunning approval fix.
    IERC20(debtAsset).safeApprove(address(LENDING_POOL), 0);
    IERC20(debtAsset).safeApprove(address(LENDING_POOL), amount);
    uint256 repaidAmount = IERC20(debtAsset).balanceOf(address(this));
    LENDING_POOL.repay(debtAsset, amount, rateMode, initiator);
    repaidAmount = repaidAmount.sub(IERC20(debtAsset).balanceOf(address(this)));

    uint256 maxCollateralToSwap = collateralAmount;
    if (repaidAmount < amount) {
      maxCollateralToSwap = maxCollateralToSwap.mul(repaidAmount).div(amount);
    }

    _doSwapAndPullWithPath(
      collateralAsset,
      debtAsset,
      path,
      initiator,
      premium,
      permitSignature,
      useATokenAsFrom,
      useATokenAsTo,
      repaidAmount,
      maxCollateralToSwap
    );

    // Repay flashloan. Approves for 0 first to comply with tokens that implement the anti frontrunning approval fix.
    IERC20(debtAsset).safeApprove(address(LENDING_POOL), 0);
    IERC20(debtAsset).safeApprove(address(LENDING_POOL), amount.add(premium));
  }

  /**
   * @dev Decodes debt information encoded in the flash loan params
   * @param params Additional variadic field to include extra params.
   *
   * @return RepayParams struct containing decoded params
   * @return PermitSignature struct containing the permit signature
   */
  function _decodeParams(bytes memory params)
    internal
    pure
    returns (RepayParams memory, PermitSignature memory)
  {
    (RepayParams memory repayParams, PermitSignature memory permitSignature) = abi.decode(
      params,
      (RepayParams, PermitSignature)
    );

    return (repayParams, permitSignature);
  }
}
