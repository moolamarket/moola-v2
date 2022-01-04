import { task } from 'hardhat/config';
import { eCeloNetwork } from '../../helpers/types';
import { getTreasuryAddress } from '../../helpers/configuration';
import * as marketConfigs from '../../markets/moola';
import * as reserveConfigs from '../../markets/moola/reservesConfigs';
import { chooseATokenDeployment } from '../../helpers/init-helpers';
import { getLendingPoolAddressesProvider } from '../../helpers/contracts-getters';
import {
  deployDefaultReserveInterestRateStrategy,
  deployStableDebtToken,
  deployVariableDebtToken,
} from '../../helpers/contracts-deployments';
import { setDRE } from '../../helpers/misc-utils';
import { ZERO_ADDRESS } from '../../helpers/constants';

const LENDING_POOL_ADDRESS_PROVIDER = {
  main: '0xD1088091A174d33412a968Fa34Cb67131188B332',
  alfajores: '0xb3072f5F0d5e8B9036aEC29F37baB70E86EA0018',
};

const isSymbolValid = (symbol: string, network: eCeloNetwork) =>
  Object.keys(reserveConfigs).includes('strategy' + symbol) &&
  marketConfigs.MoolaConfig.ReserveAssets[network][symbol] &&
  marketConfigs.MoolaConfig.ReservesConfig[symbol] === reserveConfigs['strategy' + symbol];

task('external:deploy-new-asset-moola', 'Deploy A token, Debt Tokens, Risk Parameters')
  .addParam('symbol', `Asset symbol, needs to have configuration ready`)
  .addFlag('verify', 'Verify contracts at Etherscan')
  .setAction(async ({ verify, symbol }, localBRE) => {
    const network = localBRE.network.name;
    if (!isSymbolValid(symbol, network as eCeloNetwork)) {
      throw new Error(
        `
WRONG RESERVE ASSET SETUP:
        The symbol ${symbol} has no reserve Config and/or reserve Asset setup.
        update /markets/moola/index.ts and add the asset address for ${network} network
        update /markets/moola/reservesConfigs.ts and add parameters for ${symbol}
        `
      );
    }
    setDRE(localBRE);
    const strategyParams = reserveConfigs['strategy' + symbol];
    const reserveAssetAddress =
      marketConfigs.MoolaConfig.ReserveAssets[localBRE.network.name][symbol];
    const deployCustomAToken = chooseATokenDeployment(strategyParams.aTokenImpl);
    const addressProvider = await getLendingPoolAddressesProvider(
      LENDING_POOL_ADDRESS_PROVIDER[network]
    );
    const poolAddress = await addressProvider.getLendingPool();
    const treasuryAddress = await getTreasuryAddress(marketConfigs.MoolaConfig);
    const aToken = await deployCustomAToken(
      [
        poolAddress,
        reserveAssetAddress,
        treasuryAddress,
        ZERO_ADDRESS, // Incentives Controller
        `Moola interest bearing ${symbol}`,
        `m${symbol}`,
      ],
      verify
    );
    const stableDebt = await deployStableDebtToken(
      [
        poolAddress,
        reserveAssetAddress,
        ZERO_ADDRESS, // Incentives Controller
        `Moola stable debt bearing ${symbol}`,
        `stableDebt${symbol}`,
      ],
      verify
    );
    const variableDebt = await deployVariableDebtToken(
      [
        poolAddress,
        reserveAssetAddress,
        ZERO_ADDRESS, // Incentives Controller
        `Moola variable debt bearing ${symbol}`,
        `variableDebt${symbol}`,
      ],
      verify
    );
    const rates = await deployDefaultReserveInterestRateStrategy(
      [
        addressProvider.address,
        strategyParams.optimalUtilizationRate,
        strategyParams.baseVariableBorrowRate,
        strategyParams.variableRateSlope1,
        strategyParams.variableRateSlope2,
        strategyParams.stableRateSlope1,
        strategyParams.stableRateSlope2,
      ],
      verify
    );
    console.log(`
    New interest bearing asset deployed on ${network}:
    Interest bearing m${symbol} address: ${aToken.address}
    Variable Debt variableDebt${symbol} address: ${variableDebt.address}
    Stable Debt stableDebt${symbol} address: ${stableDebt.address}
    Strategy Implementation for ${symbol} address: ${rates.address}
    `);
  });
