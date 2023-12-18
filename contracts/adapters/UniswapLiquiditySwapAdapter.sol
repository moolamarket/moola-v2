// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.6.12;
pragma experimental ABIEncoderV2;

import {BaseUniswapAdapter} from './BaseUniswapAdapter.sol';
import {ILendingPoolAddressesProvider} from '../interfaces/ILendingPoolAddressesProvider.sol';
import {IUniswapV2Router02} from '../interfaces/IUniswapV2Router02.sol';
import {IERC20} from '../dependencies/openzeppelin/contracts/IERC20.sol';

/**
 * @title UniswapLiquiditySwapAdapter
 * @notice Uniswap V2 Adapter to swap liquidity.
 * @author Aave
 **/
contract UniswapLiquiditySwapAdapter is BaseUniswapAdapter {
  struct SwapParams {
    address user;
    address assetFrom;
    address assetTo;
    address[] path;
    uint256 amountToSwap;
    uint256 minAmountToReceive;
    bool swapAllBalance;
    bool useATokenAsFrom;
    bool useATokenAsTo;
  }

  constructor(
    ILendingPoolAddressesProvider addressesProvider,
    IUniswapV2Router02 uniswapRouter,
    address wethAddress
  ) public BaseUniswapAdapter(addressesProvider, uniswapRouter, wethAddress) {}

  /**
   * @dev Swaps the received reserve amount from the flash loan into the asset specified in the params.
   * The received funds from the swap are then deposited into the protocol on behalf of the user.
   * The user should give this contract allowance to pull the ATokens in order to withdraw the underlying asset and
   * repay the flash loan.
   * @param assets Address of asset to be swapped
   * @param amounts Amount of the asset to be swapped
   * @param premiums Fee of the flash loan
   * @param initiator Address of the user
   * @param params Additional variadic field to include extra params. Expected parameters:
   *   address assetTo The address of the reserve to be swapped to and deposited
   *   uint256 minAmountToReceive Min amount to be received from the swap
   *   bool swapAllBalance Flag indicating if all the user balance should be swapped
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
    require(initiator == address(this), 'Only this contract can call flashloan');

    (SwapParams memory decodedParams, PermitSignature memory permitSignature) = _decodeParams(
      params
    );

    _swapLiquidity(
      assets[0],
      decodedParams.assetTo,
      decodedParams.path,
      amounts[0],
      premiums[0],
      decodedParams.user,
      decodedParams.minAmountToReceive,
      decodedParams.swapAllBalance,
      permitSignature,
      decodedParams.useATokenAsFrom,
      decodedParams.useATokenAsTo
    );

    return true;
  }

  function liquiditySwap(SwapParams memory swapParams, PermitSignature calldata permitSignature)
    external
  {
    bytes memory params = abi.encode(swapParams, permitSignature);
    address[] memory assets = new address[](1);
    assets[0] = swapParams.assetFrom;
    uint256[] memory amounts = new uint256[](1);
    amounts[0] = swapParams.amountToSwap;
    uint256[] memory modes = new uint256[](1);
    modes[0] = 0;

    LENDING_POOL.flashLoan(address(this), assets, amounts, modes, swapParams.user, params, 0);
  }

  /**
   * @dev Swaps an `amountToSwap` of an asset to another and deposits the funds on behalf of the initiator.
   * @param assetFrom Address of the underlying asset to be swap from
   * @param assetTo Address of the underlying asset to be swap to and deposited
   * @param amount Amount from flash loan
   * @param premium Premium of the flash loan
   * @param minAmountToReceive Min amount to be received from the swap
   * @param swapAllBalance Flag indicating if all the user balance should be swapped
   * @param permitSignature List of struct containing the permit signature
   */

  struct SwapLiquidityLocalVars {
    address aToken;
    uint256 aTokenInitiatorBalance;
    uint256 amountToSwap;
    uint256 receivedAmount;
    uint256 flashLoanDebt;
    uint256 amountToPull;
  }

  function _swapLiquidity(
    address assetFrom,
    address assetTo,
    address[] memory path,
    uint256 amount,
    uint256 premium,
    address initiator,
    uint256 minAmountToReceive,
    bool swapAllBalance,
    PermitSignature memory permitSignature,
    bool useATokenAsFrom,
    bool useATokenAsTo
  ) internal {
    SwapLiquidityLocalVars memory vars;

    vars.aToken = _getReserveData(assetFrom).aTokenAddress;

    vars.aTokenInitiatorBalance = IERC20(vars.aToken).balanceOf(initiator);
    vars.amountToSwap = swapAllBalance && vars.aTokenInitiatorBalance.sub(premium) <= amount
      ? vars.aTokenInitiatorBalance.sub(premium)
      : amount;

    if (useATokenAsFrom) {
      IERC20(assetFrom).safeApprove(address(LENDING_POOL), 0);
      IERC20(assetFrom).safeApprove(address(LENDING_POOL), vars.amountToSwap);
      LENDING_POOL.deposit(assetFrom, vars.amountToSwap, address(this), 0);
    }

    vars.receivedAmount = _swapExactTokensForTokensWithPathNoPriceCheck(
      useATokenAsFrom ? vars.aToken : assetFrom,
      useATokenAsTo ? _getReserveData(assetTo).aTokenAddress : assetTo,
      path,
      vars.amountToSwap,
      minAmountToReceive,
      useATokenAsFrom || useATokenAsTo,
      address(this)
    );

    if (useATokenAsTo) {
      IERC20(_getReserveData(assetTo).aTokenAddress).transfer(initiator, vars.receivedAmount);
    } else {
      IERC20(assetTo).safeApprove(address(LENDING_POOL), 0);
      IERC20(assetTo).safeApprove(address(LENDING_POOL), vars.receivedAmount);
      LENDING_POOL.deposit(assetTo, vars.receivedAmount, initiator, 0);
    }

    vars.flashLoanDebt = amount.add(premium);
    vars.amountToPull = vars.amountToSwap.add(premium);

    _pullAToken(assetFrom, vars.aToken, initiator, vars.amountToPull, permitSignature);

    // Repay flash loan
    IERC20(assetFrom).safeApprove(address(LENDING_POOL), 0);
    IERC20(assetFrom).safeApprove(address(LENDING_POOL), vars.flashLoanDebt);
  }

  function _swapExactTokensForTokensWithPathNoPriceCheck(
    address assetToSwapFrom,
    address assetToSwapTo,
    address[] memory path,
    uint256 amountToSwap,
    uint256 minAmountOut,
    bool aTokenExist,
    address swapTo
  ) internal returns (uint256) {
    require(path.length >= 2, 'Wrong path provided');

    // Approves the transfer for the swap. Approves for 0 first to comply with tokens that implement the anti frontrunning approval fix.
    IERC20(assetToSwapFrom).safeApprove(address(UNISWAP_ROUTER), 0);
    IERC20(assetToSwapFrom).safeApprove(address(UNISWAP_ROUTER), amountToSwap);

    if (aTokenExist) {
      uint256 balanceBefore = IERC20(path[path.length - 1]).balanceOf(address(this));

      UNISWAP_ROUTER.swapExactTokensForTokensSupportingFeeOnTransferTokens(
        amountToSwap,
        minAmountOut,
        path,
        swapTo,
        block.timestamp
      );

      uint256 swappedAmount = IERC20(path[path.length - 1]).balanceOf(address(this)).sub(
        balanceBefore
      );

      emit Swapped(assetToSwapFrom, assetToSwapTo, amountToSwap, swappedAmount);

      return swappedAmount;
    } else {
      uint256[] memory amounts = UNISWAP_ROUTER.swapExactTokensForTokens(
        amountToSwap,
        minAmountOut,
        path,
        swapTo,
        block.timestamp
      );

      emit Swapped(assetToSwapFrom, assetToSwapTo, amounts[0], amounts[amounts.length - 1]);

      return amounts[amounts.length - 1];
    }
  }

  /**
   * @dev Decodes the information encoded in the flash loan params
   * @param params Additional variadic field to include extra params.
   *
   * @return SwapParams struct containing decoded params
   * @return PermitSignature struct containing the permit signature
   */

  function _decodeParams(bytes memory params)
    internal
    pure
    returns (SwapParams memory, PermitSignature memory)
  {
    (SwapParams memory swapParams, PermitSignature memory permitSignature) = abi.decode(
      params,
      (SwapParams, PermitSignature)
    );

    return (swapParams, permitSignature);
  }
}
