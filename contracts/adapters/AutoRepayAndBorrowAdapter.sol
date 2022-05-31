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

contract AutoRepayAndBorrowAdapter is BaseUniswapAdapter {
  using SafeERC20 for IERC20;
  using PercentageMath for uint256;
  using EnumerableSet for EnumerableSet.AddressSet;

  event HealthFactorSet(address indexed user, uint256 min, uint256 target, uint256 max, uint256 rateMode, address borrowAddress, address collateralAddress);

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

  struct BorrowParams {
    address user;
    uint256 minCollateralAmountOut;
    uint256 borrowAmount;
    address[] path;
    bool useATokenAsFrom;
    bool useATokenAsTo;
    bool useFlashloan;
  }

  struct UserInfo {
    uint256 minHealthFactor;
    uint256 targetHealthFactor;
    uint256 maxHealthFactor;
    uint256 rateMode;
    address collateralAddress;
    address borrowAddress;
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

  function setMinTargetHealthFactor(uint256 minHealthFactor, uint256 targetHealthFactor) external {
    require(
      targetHealthFactor >= minHealthFactor,
      'targetHealthFactor should be more or equal than minHealthFactor'
    );
    userInfos[msg.sender] = UserInfo({
      minHealthFactor: minHealthFactor,
      targetHealthFactor: targetHealthFactor,
      maxHealthFactor: 0,
      rateMode: 0,
      borrowAddress: address(0),
      collateralAddress: address(0)
    });
    emit HealthFactorSet(msg.sender, minHealthFactor, targetHealthFactor, 0, 0, address(0), address(0));
  }

  function setMinTargetMaxHealthFactor(uint256 minHealthFactor, uint256 targetHealthFactor, uint256 maxHealthFactor, address borrowAddress, address collateralAddress, uint256 rateMode) external {
    require(
      targetHealthFactor >= minHealthFactor,
      'TargetHealthFactor should be more or equal than minHealthFactor'
    );
    require(
      maxHealthFactor >= targetHealthFactor,
      'MaxHealthFactor should be more or equal than targetHealthFactor'
    );
    // 1 for Stable, 2 for Variable
    require(rateMode == 1 || rateMode == 2, 'Not valid rate mode provided');
    require(_getReserveData(collateralAddress).aTokenAddress != address(0), 'Not valid collateralAddress provided');
    require(_getReserveData(borrowAddress).aTokenAddress != address(0), 'Not valid borrowAddress provided');
    require(collateralAddress != borrowAddress, 'Collateral and borrow could not be equal');

    userInfos[msg.sender] = UserInfo({
      minHealthFactor: minHealthFactor,
      targetHealthFactor: targetHealthFactor,
      maxHealthFactor: maxHealthFactor,
      rateMode: rateMode,
      collateralAddress: collateralAddress,
      borrowAddress: borrowAddress
    });
    emit HealthFactorSet(msg.sender, minHealthFactor, targetHealthFactor, maxHealthFactor, rateMode, borrowAddress, collateralAddress);
  }

  function clearMinTargetMaxHealthFactor() external {
    require(userInfos[msg.sender].minHealthFactor > 0, 'Already clear');
    userInfos[msg.sender] = UserInfo({
      minHealthFactor: 0,
      targetHealthFactor: 0,
      maxHealthFactor: 0,
      rateMode: 0,
      collateralAddress: address(0),
      borrowAddress: address(0)
    });
    emit HealthFactorSet(msg.sender, 0, 0, 0, 0, address(0), address(0));
  }

  function _checkMinHealthFactor(address user) internal view returns (uint256) {
    (, , , , , uint256 healthFactor) = LENDING_POOL.getUserAccountData(user);
    require(
      healthFactor < userInfos[user].minHealthFactor,
      'User health factor must be less than minHealthFactor for user'
    );
    return healthFactor;
  }

  function _checkMaxHealthFactor(address user) internal view returns (uint256) {
    (, , , , , uint256 healthFactor) = LENDING_POOL.getUserAccountData(user);
    require(
      healthFactor > userInfos[user].maxHealthFactor,
      'User health factor must be more than maxHealthFactor for user'
    );
    return healthFactor;
  }

  function _checkHealthFactorIncreased(address user, uint256 healthFactorBefore) internal view {
    (, , , , , uint256 healthFactor) = LENDING_POOL.getUserAccountData(user);
    require(
      healthFactor > healthFactorBefore && healthFactor <= userInfos[user].targetHealthFactor,
      'User health factor was not increased or more than targetHealthFactor'
    );
  }

  function _checkHealthFactorDecreased(address user, uint256 healthFactorBefore) internal view {
    (, , , , , uint256 healthFactor) = LENDING_POOL.getUserAccountData(user);
    require(
      healthFactor < healthFactorBefore && healthFactor >= userInfos[user].targetHealthFactor,
      'User health factor was not decreased or less than targetHealthFactor'
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

    (bool isBorrow) = _decodeBoolParam(params);
    if (isBorrow) {
      (
        BorrowParams memory borrowParams,
        PermitSignature memory permitSignature,
        address caller
      ) = _decodeBorrowParams(params);

      UserInfo memory userInfo = userInfos[borrowParams.user];

      IERC20(userInfo.borrowAddress).safeApprove(address(LENDING_POOL), 0);
      IERC20(userInfo.borrowAddress).safeApprove(address(LENDING_POOL), borrowParams.borrowAmount);

      _doSwapAndPullWithFeeBorrow(borrowParams, permitSignature, caller, 0, userInfo);

    } else {
      (
        RepayParams memory repayParams,
        PermitSignature memory permitSignature,
        address caller
      ) = _decodeRepayParams(params);
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

      _doSwapAndPullWithFeeRepay(repayParams, permitSignature, caller, premiums[0]);

      // Repay flashloan. Approves for 0 first to comply with tokens that implement the anti frontrunning approval fix.
      IERC20(repayParams.debtAsset).safeApprove(address(LENDING_POOL), 0);
      IERC20(repayParams.debtAsset).safeApprove(address(LENDING_POOL), amounts[0].add(premiums[0]));
    }

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
      bytes memory params = abi.encode(false, repayParams, permitSignature, msg.sender);
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
      _doSwapAndPullWithFeeRepay(repayParams, permitSignature, msg.sender, 0);

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

  function decreaseHealthFactor(
    BorrowParams memory borrowParams,
    PermitSignature calldata permitSignature
  ) external {
    require(isWhitelisted(msg.sender), 'Caller is not whitelisted');
    uint256 healthFactorBefore = _checkMaxHealthFactor(borrowParams.user);
    UserInfo memory userInfo = userInfos[borrowParams.user];

    if (borrowParams.useFlashloan) {
      bytes memory params = abi.encode(true, borrowParams, permitSignature, msg.sender);
      address[] memory assets = new address[](1);
      assets[0] = userInfo.borrowAddress;
      uint256[] memory amounts = new uint256[](1);
      amounts[0] = borrowParams.borrowAmount;
      uint256[] memory modes = new uint256[](1);
      modes[0] = userInfo.rateMode;
      LENDING_POOL.flashLoan(address(this), assets, amounts, modes, borrowParams.user, params, 0);
    } else {
      IERC20(userInfo.borrowAddress).safeApprove(address(LENDING_POOL), 0);
      IERC20(userInfo.borrowAddress).safeApprove(address(LENDING_POOL), borrowParams.borrowAmount);
      LENDING_POOL.borrow(userInfo.borrowAddress, borrowParams.borrowAmount, userInfo.rateMode, 0, borrowParams.user);
      _doSwapAndPullWithFeeBorrow(borrowParams, permitSignature, msg.sender, 0, userInfo);
    }
    _checkHealthFactorDecreased(borrowParams.user, healthFactorBefore);
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
  function _doSwapAndPullWithFeeRepay(
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

  /**
   * @dev This function pulls tokens from the user, transfers the fee to the whitelisted caller,
   * and swaps the borrow asset to the collateral asset.
   *
   * @param borrowParams See {BorrowParams}
   * @param caller address of increaseHealthFactor function caller
   */
  function _doSwapAndPullWithFeeBorrow(
    BorrowParams memory borrowParams,
    PermitSignature memory,
    address caller,
    uint256,
    UserInfo memory userInfo
  ) internal {
    uint256 amountIn = borrowParams.borrowAmount;
    if (borrowParams.useATokenAsFrom) {
      _deposit(userInfo.borrowAddress, borrowParams.borrowAmount, address(this));
      amountIn = IERC20(_getReserveData(userInfo.borrowAddress).aTokenAddress).balanceOf(address(this));
    }

    address debtATokenAddress = _getReserveData(userInfo.borrowAddress).aTokenAddress;
    address collateralATokenAddress = _getReserveData(userInfo.collateralAddress).aTokenAddress;

    amountIn = _swapExactTokensForTokensWithPath(
      [
        userInfo.borrowAddress,
        userInfo.collateralAddress,
        borrowParams.useATokenAsFrom ? debtATokenAddress : userInfo.borrowAddress,
        borrowParams.useATokenAsTo ? collateralATokenAddress : userInfo.collateralAddress
      ],
      amountIn,
      borrowParams.minCollateralAmountOut,
      borrowParams.path,
      borrowParams.useATokenAsFrom || borrowParams.useATokenAsTo,
      address(this)
    );

    uint256 feeAmount = amountIn.mul(FEE).div(HUNDRED_PERCENT);

    if (!borrowParams.useATokenAsTo) {
      _deposit(userInfo.collateralAddress, amountIn - feeAmount, borrowParams.user);
      _deposit(userInfo.collateralAddress, feeAmount, caller);
    } else {
      IERC20(collateralATokenAddress).safeTransfer(borrowParams.user, amountIn);
      IERC20(collateralATokenAddress).safeTransfer(caller, feeAmount);
    }
  }

  function _decodeRepayParams(bytes memory params)
    internal
    pure
    returns (
      RepayParams memory,
      PermitSignature memory,
      address
    )
  {
    (, RepayParams memory repayParams, PermitSignature memory permitSignature, address caller) = abi
      .decode(params, (bool, RepayParams, PermitSignature, address));

    return (repayParams, permitSignature, caller);
  }

  function _decodeBorrowParams(bytes memory params)
    internal
    pure
    returns (
      BorrowParams memory,
      PermitSignature memory,
      address
    )
  {
    (, BorrowParams memory borrowParams, PermitSignature memory permitSignature, address caller) = abi
      .decode(params, (bool, BorrowParams, PermitSignature, address));

    return (borrowParams, permitSignature, caller);
  }

  function _decodeBoolParam(bytes memory params)
    internal
    pure
    returns (
      bool
    )
  {
    (bool isBorrow) = abi.decode(params, (bool));

    return (isBorrow);
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
