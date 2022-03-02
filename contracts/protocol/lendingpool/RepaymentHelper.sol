pragma solidity 0.6.12;

import {ILendingPoolAddressesProvider} from '../interfaces/ILendingPoolAddressesProvider.sol';
import {ILendingPool} from '../interfaces/ILendingPool.sol';
import {IERC20} from '../../dependencies/openzeppelin/contracts/IERC20.sol';

contract RepaymentHelper {
  event DelegateRepay(
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
   * @notice Transfer token from msg.sender to itself, repays the debt of _delegatee, and deposit the remaining to _delegatee if the repaid amount is less than _amount
   * @param _delegatee The wallet address to repay debt of
   * @param _asset The asset address to repay
   * @param _amount The amount to repay
   * @param _rateMode The rateMode to use for repayment
   */
  function DelegateRepayHelper(
    address _delegatee,
    address _asset,
    uint256 _amount,
    uint256 _rateMode
  ) external {
    IERC20(_asset).transferFrom(msg.sender, address(this), _amount);

    ILendingPool lendingPool = ILendingPool(ADDRESSES_PROVIDER.getLendingPool());
    uint256 paybackAmount = lendingPool.repay(_asset, _amount, _rateMode, _delegatee);

    uint256 remaining = _amount - paybackAmount;
    if (remaining > 0) {
      lendingPool.deposit(_asset, remaining, _delegatee, 0);
    }

    emit DelegateRepay(msg.sender, _delegatee, _asset, paybackAmount, _rateMode);
  }
}
