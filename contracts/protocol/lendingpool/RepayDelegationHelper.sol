pragma solidity 0.6.12;

import {ILendingPoolAddressesProvider} from '../../interfaces/ILendingPoolAddressesProvider.sol';
import {ILendingPool} from '../../interfaces/ILendingPool.sol';
import {IERC20} from '../../dependencies/openzeppelin/contracts/IERC20.sol';
import {SafeERC20} from '../../dependencies/openzeppelin/contracts/SafeERC20.sol';

contract RepayDelegationHelper {
  using SafeERC20 for IERC20;

  event DelegatedRepayment(
    address delegator,
    address delegatee,
    address asset,
    uint256 amount,
    uint256 rateMode
  );

  ILendingPoolAddressesProvider public immutable ADDRESSES_PROVIDER;

  constructor(ILendingPoolAddressesProvider addressesProvider) public {
    ADDRESSES_PROVIDER = addressesProvider;
  }

  /**
   * @notice Transfer token from msg.sender to itself, repays the debt of _delegator, and deposit the remaining to _delegator if the repaid amount is less than _amount
   * @param _delegator The wallet address to repay debt of
   * @param _asset The asset address to repay
   * @param _amount The amount to repay
   * @param _rateMode The rateMode to use for repayment: 1 for Stable, 2 for Variable
   */
  function repayDelegation(
    address _delegator,
    address _asset,
    uint256 _amount,
    uint256 _rateMode
  ) external {
    IERC20(_asset).transferFrom(msg.sender, address(this), _amount);

    address lendingPoolAddress = ADDRESSES_PROVIDER.getLendingPool();
    // Repay debt. Approves 0 first to comply with tokens that implement the anti frontrunning approval fix
    IERC20(_asset).safeApprove(lendingPoolAddress, 0);
    IERC20(_asset).safeApprove(lendingPoolAddress, _amount);

    uint256 paybackAmount = ILendingPool(lendingPoolAddress).repay(
      _asset,
      _amount,
      _rateMode,
      _delegator
    );

    uint256 remaining = _amount - paybackAmount;

    if (remaining > 0) {
      uint256 otherRateMode = _rateMode == 1 ? 2 : 1;
      uint256 otherRateModePaybackAmount = ILendingPool(lendingPoolAddress).repay(
        _asset,
        remaining,
        otherRateMode,
        _delegator
      );

      remaining -= otherRateModePaybackAmount;

      if (remaining > 0) {
        ILendingPool(lendingPoolAddress).deposit(_asset, remaining, _delegator, 0);
      }
    }

    emit DelegatedRepayment(_delegator, msg.sender, _asset, _amount, _rateMode);
  }
}
