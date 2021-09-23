const { newKit } = require('@celo/contractkit');
const LendingPoolAddressesProvider = require('./abi/LendingPoolAddressProvider.json');
const LendingPool = require('./abi/LendingPool.json');
const DataProvider = require('./abi/MoolaProtocolDataProvider.json');
const MToken = require('./abi/MToken.json');
const DebtToken = require('./abi/DebtToken.json');
const BigNumber = require('bignumber.js');
const Promise = require('bluebird');
let pk;

const INTEREST_RATE = {
  NONE: 0,
  STABLE: 1,
  VARIABLE: 2,
  1: 'STABLE',
  2: 'VARIABLE',
  0: 'NONE',
};

const DEBT_TOKENS = {
  1: 'stableDebtTokenAddress',
  2: 'variableDebtTokenAddress',
}

const ether = '1000000000000000000';
const ray = '1000000000000000000000000000';
const maxUint256 = '0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff';

function BN(num) {
  return new BigNumber(num);
}

function print(num) {
  return BN(num).dividedBy(ether).toFixed();
}

function printRay(num) {
  return BN(num).dividedBy(ray).toFixed();
}

function printRayRate(num) {
  return BN(num).dividedBy(ray).multipliedBy(BN(100)).toFixed(2) + '%';
}

function printActions() {
  console.info('Available actions:');
  console.info('balanceOf celo|cusd|ceur address');
  console.info('getUserReserveData celo|cusd|ceur address');
  console.info('getReserveData celo|cusd|ceur');
  console.info('getUserAccountData address');
  console.info('deposit celo|cusd|ceur address amount [privateKey]');
  console.info('borrow celo|cusd|ceur address amount stable|variable [privateKey]');
  console.info('repay celo|cusd|ceur address amount|all stable|variable [privateKey]');
  console.info('redeem celo|cusd|ceur address amount|all [privateKey]');
  console.info('delegate celo|cusd|ceur to address amount|all stable|variable [privateKey]');
  console.info('borrowFrom celo|cusd|ceur from address amount [privateKey]');
  console.info('repayFor celo|cusd|ceur for address amount stable|variable [privateKey]');
}

const retry = async (fun, tries = 5) => {
  try {
    return await fun();
  } catch(err) {
    if (tries == 0) throw err;
    await Promise.delay(1000);
    return retry(fun, tries - 1);
  }
};

async function execute(network, action, ...params) {
  if (network === undefined) {
    console.info('Usage: test|main|URL action params');
    printActions();
    return;
  }
  let kit;
  let addressProvider;
  let dataProvider;
  let CELO;
  let cUSD;
  let cEUR;
  let privateKeyRequired = true;
  switch (network) {
    case 'test':
      kit = newKit('https://alfajores-forno.celo-testnet.org');
      addressProvider = new kit.web3.eth.Contract(LendingPoolAddressesProvider, '0xb3072f5F0d5e8B9036aEC29F37baB70E86EA0018');
      cEUR = new kit.web3.eth.Contract(MToken, '0x10c892a6ec43a53e45d0b916b4b7d383b1b78c0f');
      cUSD = new kit.web3.eth.Contract(MToken, '0x874069Fa1Eb16D44d622F2e0Ca25eeA172369bC1');
      CELO = new kit.web3.eth.Contract(MToken, '0xF194afDf50B03e69Bd7D057c1Aa9e10c9954E4C9');
      dataProvider = new kit.web3.eth.Contract(DataProvider, '0x31ccB9dC068058672D96E92BAf96B1607855822E');
      break;
    case 'main':
      kit = newKit('https://forno.celo.org');
      addressProvider = new kit.web3.eth.Contract(LendingPoolAddressesProvider, '0xD1088091A174d33412a968Fa34Cb67131188B332');
      cEUR = new kit.web3.eth.Contract(MToken, '0xD8763CBa276a3738E6DE85b4b3bF5FDed6D6cA73');
      cUSD = new kit.web3.eth.Contract(MToken, '0x765DE816845861e75A25fCA122bb6898B8B1282a');
      CELO = new kit.web3.eth.Contract(MToken, '0x471EcE3750Da237f93B8E339c536989b8978a438');
      dataProvider = new kit.web3.eth.Contract(DataProvider, '0x43d067ed784D9DD2ffEda73775e2CC4c560103A1');
      break;
    default:
      try {
        kit = newKit(network);
      } catch(err) {
        console.info(`Unknown network: ${network}`);
        console.info(`Available networks: test, main, or custom node URL.`);
        return;
      }
      addressProvider = new kit.web3.eth.Contract(LendingPoolAddressesProvider, '0xD1088091A174d33412a968Fa34Cb67131188B332');
      cEUR = new kit.web3.eth.Contract(MToken, '0xD8763CBa276a3738E6DE85b4b3bF5FDed6D6cA73');
      cUSD = new kit.web3.eth.Contract(MToken, '0x765DE816845861e75A25fCA122bb6898B8B1282a');
      CELO = new kit.web3.eth.Contract(MToken, '0x471EcE3750Da237f93B8E339c536989b8978a438');
      dataProvider = new kit.web3.eth.Contract(DataProvider, '0x43d067ed784D9DD2ffEda73775e2CC4c560103A1');
      privateKeyRequired = false;
  }
  const web3 = kit.web3;
  const eth = web3.eth;

  const lendingPool = new eth.Contract(LendingPool, await addressProvider.methods.getLendingPool().call());
  const tokens = {
    celo: CELO,
    cusd: cUSD,
    ceur: cEUR,
  };

  const reserves = {
    celo: CELO.options.address,
    cusd: cUSD.options.address,
    ceur: cEUR.options.address,
  };
  if (action === 'balanceof') {
    const token = tokens[params[0]];
    const user = params[1];
    console.info(BN(((await token.methods.balanceOf(user).call()).toString())).div(ether).toFixed());
    return;
  }
  if (action == 'getuserreservedata') {
    const reserve = reserves[params[0]];
    const user = params[1];
    const data = await dataProvider.methods.getUserReserveData(reserve, user).call();
    const reserveData = await dataProvider.methods.getReserveData(reserve).call();
    const parsedData = {
      Deposited: print(data.currentATokenBalance),
      BorrowedStable: print(data.principalStableDebt),
      DebtStable: print(data.currentStableDebt),
      BorrowRateStable: printRayRate(data.stableBorrowRate),
      BorrowedVariable: print(data.scaledVariableDebt),
      DebtVariable: print(data.currentVariableDebt),
      VariableRate: printRayRate(reserveData.variableBorrowRate),
      LiquidityRate: printRayRate(data.liquidityRate),
      LastUpdateStable: (new Date(BN(data.stableRateLastUpdated).multipliedBy(1000).toNumber())).toLocaleString(),
      IsCollateral: data.usageAsCollateralEnabled,
    };
    console.table(parsedData);
    return;
  }
  if (action == 'getuseraccountdata') {
    const user = params[0];
    const data = await lendingPool.methods.getUserAccountData(user).call();
    const parsedData = {
      TotalCollateral: print(data.totalCollateralETH),
      TotalDebt: print(data.totalDebtETH),
      AvailableBorrow: print(data.availableBorrowsETH),
      LiquidationThreshold: `${BN(data.currentLiquidationThreshold).div(BN(100))}%`,
      LoanToValue: `${BN(data.ltv).div(BN(100))}%`,
      HealthFactor: data.healthFactor.length > 30 ? 'SAFE' : print(data.healthFactor),
    };
    console.table(parsedData);
    return;
  }
  if (action == 'getreservedata') {
    const reserve = reserves[params[0]];
    const data = await dataProvider.methods.getReserveData(reserve).call();
    const reserveTokens = await dataProvider.methods.getReserveTokensAddresses(reserve).call();
    const parsedData = {
      AvailableLiquidity: print(data.availableLiquidity),
      TotalBorrowsStable: print(data.totalStableDebt),
      TotalBorrowsVariable: print(data.totalVariableDebt),
      LiquidityRate: printRayRate(data.liquidityRate),
      VariableRate: printRayRate(data.variableBorrowRate),
      StableRate: printRayRate(data.stableBorrowRate),
      AverageStableRate: printRayRate(data.averageStableBorrowRate),
      LiquidityIndex: printRay(data.liquidityIndex),
      VariableBorrowIndex: printRay(data.variableBorrowIndex),
      MToken: reserveTokens.aTokenAddress,
      LastUpdate: (new Date(BN(data.lastUpdateTimestamp).multipliedBy(1000).toNumber())).toLocaleString(),
    };
    console.table(parsedData);
    return;
  }
  if (action == 'deposit') {
    const reserve = reserves[params[0]];
    const token = tokens[params[0]];
    const user = params[1];
    const amount = web3.utils.toWei(params[2]);
    if (privateKeyRequired) {
      pk = params[3];
      if (!pk) {
        console.error('Missing private key');
        return;
      }
      kit.addAccount(pk);
    }
    console.log('Approve', (await token.methods.approve(lendingPool.options.address, amount).send({from: user, gas: 2000000})).transactionHash);
    try {
      await retry(() => lendingPool.methods.deposit(reserve, amount, user, 0).estimateGas({from: user, gas: 2000000}));
    } catch (err) {
      console.log('Revoke approve', (await token.methods.approve(lendingPool.options.address, 0).send({from: user, gas: 2000000})).transactionHash);
      console.log('Cannot deposit', err.message);
      return;
    }
    console.log('Deposit', (await lendingPool.methods.deposit(reserve, amount, user, 0).send({from: user, gas: 2000000})).transactionHash);
    return;
  }
  if (action == 'borrow') {
    const reserve = reserves[params[0]];
    const user = params[1];
    const amount = web3.utils.toWei(params[2]);
    const rate = INTEREST_RATE[params[3].toUpperCase()];
    if (privateKeyRequired) {
      pk = params[4];
      if (!pk) {
        console.error('Missing private key');
        return;
      }
      kit.addAccount(pk);
    }
    try {
      await retry(() => lendingPool.methods.borrow(reserve, amount, rate, 0, user).estimateGas({from: user, gas: 2000000}));
    } catch (err) {
      console.log('Cannot borrow', err.message);
      return;
    }
    console.log('Borrow', (await lendingPool.methods.borrow(reserve, amount, rate, 0, user).send({from: user, gas: 2000000})).transactionHash);
    return;
  }
  if (action == 'repay') {
    const reserve = reserves[params[0]];
    const token = tokens[params[0]];
    const user = params[1];
    const amount = params[2] === 'all' ? maxUint256 : web3.utils.toWei(params[2]);
    const rate = INTEREST_RATE[params[3].toUpperCase()];
    if (privateKeyRequired) {
      pk = params[3];
      if (!pk) {
        console.error('Missing private key');
        return;
      }
      kit.addAccount(pk);
    }
    console.log('Approve', (await token.methods.approve(lendingPool.options.address, amount).send({from: user, gas: 2000000})).transactionHash);
    try {
      await retry(() => lendingPool.methods.repay(reserve, amount, rate, user).estimateGas({from: user, gas: 2000000}));
    } catch (err) {
      console.log('Revoke approve', (await token.methods.approve(lendingPool.options.address, 0).send({from: user, gas: 2000000})).transactionHash);
      console.log('Cannot repay', err.message);// const pk = require('./pk2.json');

      return;
    }
    console.log('Repay', (await lendingPool.methods.repay(reserve, amount, rate, user).send({from: user, gas: 2000000})).transactionHash);
    console.log('Revoke approve', (await token.methods.approve(lendingPool.options.address, 0).send({from: user, gas: 2000000})).transactionHash);
    return;
  }
  if (action == 'redeem') {
    const reserve = reserves[params[0]];
    const user = params[1];
    const amount = params[2] === 'all' ? maxUint256 : web3.utils.toWei(params[2]);
    if (privateKeyRequired) {
      pk = params[3];
      if (!pk) {
        console.error('Missing private key');
        return;
      }
      kit.addAccount(pk);
    }
    try {
      await retry(() => lendingPool.methods.withdraw(reserve, amount, user).estimateGas({from: user, gas: 2000000}));
    } catch (err) {
      console.log('Cannot redeem', err.message);
      return;
    }
    console.log('Redeem', (await lendingPool.methods.withdraw(reserve, amount, user).send({from: user, gas: 2000000})).transactionHash);
    return;
  }
  if (action == 'delegate') {
    const reserve = reserves[params[0]];
    const token = tokens[params[0]];
    const to = params[1];
    const user = params[2];
    const amount = web3.utils.toWei(params[3]);
    const rate = INTEREST_RATE[params[4].toUpperCase()];
    if (privateKeyRequired) {
      pk = params[5];
      if (!pk) {
        console.error('Missing private key');
        return;
      }
      kit.addAccount(pk);
    }
    const reserveTokens = await dataProvider.methods.getReserveTokensAddresses(reserve).call();
    const debtToken = new eth.Contract(DebtToken, reserveTokens[DEBT_TOKENS[rate]]);
    console.log('Approve credit delegation', (await debtToken.methods.approveDelegation(to, amount).send({from: user, gas: 2000000})).transactionHash);
    return;
  }
  if (action == 'borrowfrom') {
    const reserve = reserves[params[0]];
    const from = params[1];
    const user = params[2];
    const amount = web3.utils.toWei(params[3]);
    const rate = INTEREST_RATE[params[4].toUpperCase()];
    if (privateKeyRequired) {
      pk = params[5];
      if (!pk) {
        console.error('Missing private key');
        return;
      }
      kit.addAccount(pk);
    }
    try {
      await retry(() => lendingPool.methods.borrow(reserve, amount, rate, 0, from).estimateGas({from: user, gas: 2000000}));
    } catch (err) {
      console.log('Cannot borrow', err.message);
      return;
    }
    console.log('Borrow', (await lendingPool.methods.borrow(reserve, amount, rate, 0, from).send({from: user, gas: 2000000})).transactionHash);
    return;
  }
  if (action == 'repayfor') {
    const reserve = reserves[params[0]];
    const token = tokens[params[0]];
    const repayfor = params[1];
    const user = params[2];
    const amount = web3.utils.toWei(params[3]);
    const rate = INTEREST_RATE[params[4].toUpperCase()];
    if (privateKeyRequired) {
      pk = params[5];
      if (!pk) {
        console.error('Missing private key');
        return;
      }
      kit.addAccount(pk);
    }
    console.log('Approve', (await token.methods.approve(lendingPool.options.address, amount).send({from: user, gas: 2000000})).transactionHash);
    try {
      await retry(() => lendingPool.methods.repay(reserve, amount, rate, repayfor).estimateGas({from: user, gas: 2000000}));
    } catch (err) {
      console.log('Revoke approve', (await token.methods.approve(lendingPool.options.address, 0).send({from: user, gas: 2000000})).transactionHash);
      console.log('Cannot repay', err.message);// const pk = require('./pk2.json');

      return;
    }
    console.log('Repay', (await lendingPool.methods.repay(reserve, amount, rate, repayfor).send({from: user, gas: 2000000})).transactionHash);
    console.log('Revoke approve', (await token.methods.approve(lendingPool.options.address, 0).send({from: user, gas: 2000000})).transactionHash);
    return;
  }
  console.error(`Unknown action: ${action}`);
  printActions();
}

execute(...process.argv.slice(2).map(arg => arg.toLowerCase()));
