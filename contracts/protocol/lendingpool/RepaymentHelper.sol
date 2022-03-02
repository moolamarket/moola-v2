pragma solidity 0.6.12;

import {ILendingPoolAddressesProvider} from '../interfaces/ILendingPoolAddressesProvider.sol';
import {ILendingPool} from '../interfaces/ILendingPool.sol';

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

  function DelegateRepayHelper(
    address _delegatee,
    address _asset,
    uint256 _amount,
    uint256 _rateMode
  ) external {
    ILendingPool lendingPool = ILendingPool(ADDRESSES_PROVIDER.getLendingPool());
    uint256 paybackAmount = lendingPool.repay(_asset, _amount, _rateMode, _delegatee);

    uint256 remaining = _amount - paybackAmount;
    if (remaining > 0) {
      lendingPool.deposit(_asset, remaining, _delegatee, 0);
    }

    emit DelegateRepay(msg.sender, _delegatee, _asset, paybackAmount, _rateMode);
  }
}
