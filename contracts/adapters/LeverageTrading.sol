// SPDX-License-Identifier: MIT
pragma solidity 0.6.12;
pragma experimental ABIEncoderV2;

import {BaseUniswapAdapter} from './BaseUniswapAdapter.sol';
import {IUniswapV2Router02} from '../interfaces/IUniswapV2Router02.sol';
import {IERC20} from '../dependencies/openzeppelin/contracts/IERC20.sol';
import {SafeERC20} from '../dependencies/openzeppelin/contracts/SafeERC20.sol';
import {ILendingPoolAddressesProvider} from '../interfaces/ILendingPoolAddressesProvider.sol';

contract LeverageTrading is BaseUniswapAdapter {
  using SafeERC20 for IERC20;

  constructor(
    ILendingPoolAddressesProvider addressesProvider,
    IUniswapV2Router02 uniswapRouter,
    address wethAddress
  ) public BaseUniswapAdapter(addressesProvider, uniswapRouter, wethAddress) {}

  struct LeverageVars {
    uint256 i;
    address[] path;
    address asset;
    uint256 amount;
    uint256 minAmountOut;
    uint256 wethAmount;
  }

  /**
   * @dev Uses the received funds from the flash loan(modes should be 1(stable) or 2(variable))
   *      to swap to WETH and deposit swapped WETH to initiator address.
   * @param assets Address of debt asset
   * @param amounts Amount of the debt to be repaid
   * @param initiator Address of the flashloan caller
   * @param params Additional variadic field to include extra params. Expected parameters:
   *   bool[] - array of useATokenAsFrom booleans
   */
  function executeOperation(
    address[] calldata assets,
    uint256[] calldata amounts,
    uint256[] calldata,
    address initiator,
    bytes calldata params
  ) external override returns (bool) {
    require(msg.sender == address(LENDING_POOL), 'CALLER_MUST_BE_LENDING_POOL');
    bool[] memory useATokenAsFrom = abi.decode(params, (bool[]));
    require(
      useATokenAsFrom.length == assets.length,
      'useATokensAsFrom length does not match to assets length'
    );

    LeverageVars memory vars;
    vars.path = new address[](2);

    vars.path[1] = WETH_ADDRESS;
    for (; vars.i < assets.length; vars.i++) {
      vars.asset = assets[vars.i];
      vars.amount = amounts[vars.i];
      uint256 fromAssetDecimals = _getDecimals(vars.asset);
      uint256 fromAssetPrice = _getPrice(vars.asset);
      // minAmountOut with 2% slippage
      vars.minAmountOut = vars.amount.mul(fromAssetPrice).div(10**fromAssetDecimals).mul(98).div(
        100
      );
      if (useATokenAsFrom[vars.i]) {
        vars.path[0] = _getReserveData(vars.asset).aTokenAddress;
        IERC20(vars.asset).safeApprove(address(LENDING_POOL), 0);
        IERC20(vars.asset).safeApprove(address(LENDING_POOL), vars.amount);
        LENDING_POOL.deposit(vars.asset, vars.amount, address(this), 0);
        uint256 balanceBefore = IERC20(vars.path[1]).balanceOf(address(this));
        IERC20(vars.path[0]).safeApprove(address(UNISWAP_ROUTER), 0);
        IERC20(vars.path[0]).safeApprove(address(UNISWAP_ROUTER), uint256(-1));
        UNISWAP_ROUTER.swapExactTokensForTokensSupportingFeeOnTransferTokens(
          vars.amount,
          vars.minAmountOut,
          vars.path,
          address(this),
          block.timestamp
        );
        uint256 swappedAmount = IERC20(vars.path[1]).balanceOf(address(this)) - balanceBefore;

        vars.wethAmount += swappedAmount;
        emit Swapped(vars.path[0], vars.path[1], vars.amount, swappedAmount);
      } else {
        vars.path[0] = vars.asset;
        IERC20(vars.path[0]).safeApprove(address(UNISWAP_ROUTER), 0);
        IERC20(vars.path[0]).safeApprove(address(UNISWAP_ROUTER), uint256(-1));
        uint256[] memory swappedAmounts = UNISWAP_ROUTER.swapExactTokensForTokens(
          vars.amount,
          vars.minAmountOut,
          vars.path,
          address(this),
          block.timestamp
        );
        vars.wethAmount += swappedAmounts[1];
        emit Swapped(vars.path[0], vars.path[1], swappedAmounts[0], swappedAmounts[1]);
      }
    }
    // Approves the transfer for the swap. Approves for 0 first to comply with tokens that implement the anti frontrunning approval fix.
    IERC20(WETH_ADDRESS).safeApprove(address(LENDING_POOL), 0);
    IERC20(WETH_ADDRESS).safeApprove(address(LENDING_POOL), vars.wethAmount);
    LENDING_POOL.deposit(WETH_ADDRESS, vars.wethAmount, initiator, 0);
    return true;
  }
}
