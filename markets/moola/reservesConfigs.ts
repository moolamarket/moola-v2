import { eContractid, IReserveParams } from '../../helpers/types';

import { 
  rateStrategyStableTwo,
  rateStrategyCELO,
} from './rateStrategies';

export const strategyCUSD: IReserveParams = {
  strategy: rateStrategyStableTwo,
  baseLTVAsCollateral: '7500',
  liquidationThreshold: '8000',
  liquidationBonus: '10500',
  borrowingEnabled: true,
  stableBorrowRateEnabled: true,
  reserveDecimals: '18',
  aTokenImpl: eContractid.AToken,
  reserveFactor: '1000'
};

export const strategyCEUR: IReserveParams = {
  strategy: rateStrategyStableTwo,
  baseLTVAsCollateral: '7500',
  liquidationThreshold: '8000',
  liquidationBonus: '10500',
  borrowingEnabled: true,
  stableBorrowRateEnabled: true,
  reserveDecimals: '18',
  aTokenImpl: eContractid.AToken,
  reserveFactor: '1000'
};

export const strategyCREAL: IReserveParams = {
  strategy: rateStrategyStableTwo,
  baseLTVAsCollateral: '7500',
  liquidationThreshold: '8000',
  liquidationBonus: '10500',
  borrowingEnabled: true,
  stableBorrowRateEnabled: true,
  reserveDecimals: '18',
  aTokenImpl: eContractid.AToken,
  reserveFactor: '1000',
};

export const strategyCELO: IReserveParams = {
  strategy: rateStrategyCELO,
  baseLTVAsCollateral: '8000',
  liquidationThreshold: '8250',
  liquidationBonus: '10500',
  borrowingEnabled: true,
  stableBorrowRateEnabled: true,
  reserveDecimals: '18',
  aTokenImpl: eContractid.AToken,
  reserveFactor: '1000'
};
