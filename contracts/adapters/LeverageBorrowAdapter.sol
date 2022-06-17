// SPDX-License-Identifier: MIT
pragma solidity 0.6.12;
pragma experimental ABIEncoderV2;

import {BaseUniswapAdapter} from './BaseUniswapAdapter.sol';
import {IUniswapV2Router02} from '../interfaces/IUniswapV2Router02.sol';
import {IERC20} from '../dependencies/openzeppelin/contracts/IERC20.sol';
import {PercentageMath} from '../protocol/libraries/math/PercentageMath.sol';
import {OptimizedSafeERC20} from '../dependencies/openzeppelin/contracts/OptimizedSafeERC20.sol';
import {ILendingPoolAddressesProvider} from '../interfaces/ILendingPoolAddressesProvider.sol';

contract LeverageBorrowAdapter is BaseUniswapAdapter {
  using OptimizedSafeERC20 for IERC20;
  using PercentageMath for uint256;

  constructor(
    ILendingPoolAddressesProvider addressesProvider,
    IUniswapV2Router02 uniswapRouter,
    address wethAddress
  ) public BaseUniswapAdapter(addressesProvider, uniswapRouter, wethAddress) {}

  struct LeverageParams {
    bool useATokenAsFrom;
    bool useATokenAsTo;
    bool useEthPath;
    address toAsset;
    uint256 minAmountOut;
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

    for (uint i = 0; i < assets.length; i++) {
      LeverageParams memory leverageParams = leverageParamsArr[i];
      uint amountIn = amounts[i];
      address asset = assets[i];
      if (leverageParams.useATokenAsFrom) {
        _deposit(asset, amountIn, address(this));
        amountIn = IERC20(_getReserveData(asset).aTokenAddress).balanceOf(address(this));
      }

      // reusing amountIn
      amountIn = _swapExactTokensForTokensNoPriceCheck(
        leverageParams.useATokenAsFrom ? _getReserveData(asset).aTokenAddress : asset,
        leverageParams.useATokenAsTo ? _getReserveData(leverageParams.toAsset).aTokenAddress : leverageParams.toAsset,
        amountIn,
        leverageParams.minAmountOut,
        leverageParams.useEthPath,
        leverageParams.useATokenAsFrom || leverageParams.useATokenAsTo,
        leverageParams.useATokenAsTo ? initiator : address(this)
      );

      if (!leverageParams.useATokenAsTo) {
        _deposit(leverageParams.toAsset, amountIn, initiator);
      }
    }
    return true;
  }

  function _deposit(
    address asset,
    uint256 amount,
    address to
  ) internal {
    IERC20(asset).safeApprove(address(LENDING_POOL), amount);
    LENDING_POOL.deposit(asset, amount, to, 0);
  }
}
