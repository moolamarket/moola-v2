// SPDX-License-Identifier: MIT
pragma solidity 0.6.12;
pragma experimental ABIEncoderV2;

import {BaseUniswapAdapter} from './BaseUniswapAdapter.sol';
import {IUniswapV2Router02} from '../interfaces/IUniswapV2Router02.sol';
import {IERC20} from '../dependencies/openzeppelin/contracts/IERC20.sol';
import {PercentageMath} from '../protocol/libraries/math/PercentageMath.sol';
import {SafeERC20} from '../dependencies/openzeppelin/contracts/SafeERC20.sol';
import {ILendingPoolAddressesProvider} from '../interfaces/ILendingPoolAddressesProvider.sol';

contract LeverageTrading is BaseUniswapAdapter {
  using SafeERC20 for IERC20;
  using PercentageMath for uint256;

  constructor(
    ILendingPoolAddressesProvider addressesProvider,
    IUniswapV2Router02 uniswapRouter,
    address wethAddress
  ) public BaseUniswapAdapter(addressesProvider, uniswapRouter, wethAddress) {}

  // Max slippage percent allowed
  uint256 public constant SLIPPAGE_PERCENT = 300; // 3%
  struct LeverageVars {
    uint8 i;
    bool aTokenExist;
    address asset;
    address[] path;
    uint256 amount;
    uint256 minAmountOut;
    uint256 fromAssetDecimals;
    uint256 toAssetDecimals;
    uint256 fromAssetPrice;
    uint256 toAssetPrice;
  }

  struct LeverageParams {
    bool useATokenAsFrom;
    bool useATokenAsTo;
    address toAsset;
  }

  /**
   * @dev Uses the received funds from the flash loan(modes should be 1(stable) or 2(variable))
   *      to swap to WETH and deposit swapped WETH to initiator address.
   * @param assets Address of debt asset
   * @param amounts Amount of the debt to be repaid
   * @param initiator Address of the flashloan caller
   * @param params Additional variadic field to include extra params. Expected parameters:
   *   LeverageParams[] - array of LeverageParams struct
   */
  function executeOperation(
    address[] calldata assets,
    uint256[] calldata amounts,
    uint256[] calldata,
    address initiator,
    bytes calldata params
  ) external override returns (bool) {
    require(msg.sender == address(LENDING_POOL), 'CALLER_MUST_BE_LENDING_POOL');
    LeverageParams[] memory leverageParamsArr = abi.decode(params, (LeverageParams[]));
    require(
      leverageParamsArr.length == assets.length,
      'leverageParams length does not match to assets length'
    );

    LeverageVars memory vars;
    vars.path = new address[](2);

    for (; vars.i < assets.length; vars.i++) {
      LeverageParams memory leverageParams = leverageParamsArr[vars.i];
      vars.asset = assets[vars.i];
      vars.amount = amounts[vars.i];
      vars.fromAssetDecimals = _getDecimals(vars.asset);
      vars.fromAssetPrice = _getPrice(vars.asset);

      vars.toAssetDecimals = _getDecimals(leverageParams.toAsset);
      vars.toAssetPrice = _getPrice(leverageParams.toAsset);

      vars.minAmountOut = vars
        .amount
        .mul(vars.fromAssetPrice.mul(10**vars.toAssetDecimals))
        .div(vars.toAssetPrice.mul(10**vars.fromAssetDecimals))
        .percentMul(PercentageMath.PERCENTAGE_FACTOR.sub(SLIPPAGE_PERCENT));

      vars.path[0] = leverageParams.useATokenAsFrom
        ? _getReserveData(vars.asset).aTokenAddress
        : vars.asset;
      vars.path[1] = leverageParams.useATokenAsTo
        ? _getReserveData(leverageParams.toAsset).aTokenAddress
        : leverageParams.toAsset;

      if (leverageParams.useATokenAsFrom) {
        _deposit(vars.asset, vars.amount, address(this));
      }

      if (leverageParams.useATokenAsFrom || leverageParams.useATokenAsTo) {
        address receiverAddress = leverageParams.useATokenAsTo ? initiator : address(this);

        uint256 balanceBefore = IERC20(vars.path[1]).balanceOf(receiverAddress);
        IERC20(vars.path[0]).safeApprove(address(UNISWAP_ROUTER), 0);
        IERC20(vars.path[0]).safeApprove(address(UNISWAP_ROUTER), vars.amount);
        UNISWAP_ROUTER.swapExactTokensForTokensSupportingFeeOnTransferTokens(
          vars.amount,
          vars.minAmountOut,
          vars.path,
          receiverAddress,
          block.timestamp
        );
        uint256 swappedAmount = IERC20(vars.path[1]).balanceOf(receiverAddress).sub(balanceBefore);
        emit Swapped(vars.path[0], vars.path[1], vars.amount, swappedAmount);

        if (!leverageParams.useATokenAsTo) {
          _deposit(vars.path[1], swappedAmount, initiator);
        }
      } else {
        IERC20(vars.path[0]).safeApprove(address(UNISWAP_ROUTER), 0);
        IERC20(vars.path[0]).safeApprove(address(UNISWAP_ROUTER), vars.amount);
        uint256[] memory swappedAmounts = UNISWAP_ROUTER.swapExactTokensForTokens(
          vars.amount,
          vars.minAmountOut,
          vars.path,
          address(this),
          block.timestamp
        );
        emit Swapped(vars.path[0], vars.path[1], swappedAmounts[0], swappedAmounts[1]);

        _deposit(vars.path[1], swappedAmounts[1], initiator);
      }
    }
    return true;
  }

  function _deposit(
    address asset,
    uint256 amount,
    address onBehalfOf
  ) internal {
    IERC20(asset).safeApprove(address(LENDING_POOL), 0);
    IERC20(asset).safeApprove(address(LENDING_POOL), amount);
    LENDING_POOL.deposit(asset, amount, onBehalfOf, 0);
  }
}
