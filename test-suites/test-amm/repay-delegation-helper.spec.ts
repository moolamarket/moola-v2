import { TestEnv, makeSuite } from './helpers/make-suite';
import { APPROVAL_AMOUNT_LENDING_POOL, RAY } from '../../helpers/constants';
import { convertToCurrencyDecimals } from '../../helpers/contracts-helpers';
import { ProtocolErrors } from '../../helpers/types';
import { strategyWETH } from '../../markets/amm/reservesConfigs';

const { expect } = require('chai');

makeSuite('RepayDelegationHelper', (testEnv: TestEnv) => {
  const {
    CALLER_NOT_POOL_ADMIN,
    LPC_RESERVE_LIQUIDITY_NOT_0,
    RC_INVALID_LTV,
    RC_INVALID_LIQ_THRESHOLD,
    RC_INVALID_LIQ_BONUS,
    RC_INVALID_DECIMALS,
    RC_INVALID_RESERVE_FACTOR,
  } = ProtocolErrors;

  describe('repayDelegation', () => {
    it(`should successfully help delegatee to repays delegator's debt`, async () => {
      const { repayHelper, users } = testEnv;

      const delegatee = users[0]; // msg.sender
      const delegator = users[1];
    });
    it('approves lending pool with the correct amount');
    it('transfers remaining to the delegatee if exists');
    it('emit DelegatedRepayment event');
  });
});
