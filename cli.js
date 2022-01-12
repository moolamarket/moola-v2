const { newKit } = require('@celo/contractkit');
const LendingPoolAddressesProvider = require('./abi/LendingPoolAddressProvider.json');
const LendingPool = require('./abi/LendingPool.json');
const Uniswap = require('./abi/Uniswap.json');
const DataProvider = require('./abi/MoolaProtocolDataProvider.json');
const MToken = require('./abi/MToken.json');
const MoolaMigratorV1V2 = require('./abi/MoolaMigratorV1V2.json');
const DebtToken = require('./abi/DebtToken.json');
const BigNumber = require('bignumber.js');
const Promise = require('bluebird');
const { consoleTestResultHandler } = require('tslint/lib/test');
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

function nowSeconds() {
  return Math.floor(Date.now() / 1000);
}

function printActions() {
  console.info('Available actions:');
  console.info('balanceOf celo|cusd|ceur|creal address');
  console.info('getUserReserveData celo|cusd|ceur|creal address');
  console.info('getReserveData celo|cusd|ceur|creal');
  console.info('getUserAccountData address');
  console.info('deposit celo|cusd|ceur|creal address amount [privateKey]');
  console.info('borrow celo|cusd|ceur|creal address amount stable|variable [privateKey]');
  console.info('repay celo|cusd|ceur|creal address amount|all stable|variable [privateKey]');
  console.info('redeem celo|cusd|ceur|creal address amount|all [privateKey]');
  console.info('delegate celo|cusd|ceur|creal to address amount|all stable|variable [privateKey]');
  console.info('borrowFrom celo|cusd|ceur|creal from address amount [privateKey]');
  console.info('repayFor celo|cusd|ceur|creal for address amount stable|variable [privateKey]');
  console.info('migrate-step-2 address [privateKey]');
  console.info('liquidation-bot address [privateKey]');
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
  let migrator;
  let privateKeyRequired = true;
  switch (network) {
    case 'test':
      kit = newKit('https://alfajores-forno.celo-testnet.org');
      addressProvider = new kit.web3.eth.Contract(LendingPoolAddressesProvider, '0xb3072f5F0d5e8B9036aEC29F37baB70E86EA0018');
      cEUR = new kit.web3.eth.Contract(MToken, '0x10c892a6ec43a53e45d0b916b4b7d383b1b78c0f');
      cUSD = new kit.web3.eth.Contract(MToken, '0x874069Fa1Eb16D44d622F2e0Ca25eeA172369bC1');
      cREAL = new kit.web3.eth.Contract(MToken, '0xE4D517785D091D3c54818832dB6094bcc2744545');
      CELO = new kit.web3.eth.Contract(MToken, '0xF194afDf50B03e69Bd7D057c1Aa9e10c9954E4C9');
      dataProvider = new kit.web3.eth.Contract(DataProvider, '0x31ccB9dC068058672D96E92BAf96B1607855822E');
      migrator = new kit.web3.eth.Contract(MoolaMigratorV1V2, '0x78660A4bbe5108c8258c39696209329B3bC214ba');
      break;
    case 'main':
      kit = newKit('https://forno.celo.org');
      addressProvider = new kit.web3.eth.Contract(LendingPoolAddressesProvider, '0xD1088091A174d33412a968Fa34Cb67131188B332');
      cEUR = new kit.web3.eth.Contract(MToken, '0xD8763CBa276a3738E6DE85b4b3bF5FDed6D6cA73');
      cUSD = new kit.web3.eth.Contract(MToken, '0x765DE816845861e75A25fCA122bb6898B8B1282a');
      cREAL = new kit.web3.eth.Contract(MToken, '0xe8537a3d056DA446677B9E9d6c5dB704EaAb4787');
      CELO = new kit.web3.eth.Contract(MToken, '0x471EcE3750Da237f93B8E339c536989b8978a438');
      dataProvider = new kit.web3.eth.Contract(DataProvider, '0x43d067ed784D9DD2ffEda73775e2CC4c560103A1');
      migrator = new kit.web3.eth.Contract(MoolaMigratorV1V2, '0xB87ebF9CD90003B66CF77c937eb5628124fA0662');
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
      cREAL = new kit.web3.eth.Contract(MToken, '0xe8537a3d056DA446677B9E9d6c5dB704EaAb4787');
      CELO = new kit.web3.eth.Contract(MToken, '0x471EcE3750Da237f93B8E339c536989b8978a438');
      dataProvider = new kit.web3.eth.Contract(DataProvider, '0x43d067ed784D9DD2ffEda73775e2CC4c560103A1');
      migrator = new kit.web3.eth.Contract(MoolaMigratorV1V2, '0xB87ebF9CD90003B66CF77c937eb5628124fA0662');
      privateKeyRequired = false;
  }
  const web3 = kit.web3;
  const eth = web3.eth;

  const lendingPool = new eth.Contract(LendingPool, await addressProvider.methods.getLendingPool().call());
  const tokens = {
    celo: CELO,
    cusd: cUSD,
    ceur: cEUR,
    creal: cREAL,
  };

  const reserves = {
    celo: CELO.options.address,
    cusd: cUSD.options.address,
    ceur: cEUR.options.address,
    creal: cREAL.options.address,
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
      VariableDebtToken: reserveTokens.variableDebtTokenAddress,
      StableDebtToken: reserveTokens.stableDebtTokenAddress,
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
      pk = params[4];
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
      console.log('Cannot repay', err.message);

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
      console.log('Cannot repay', err.message);

      return;
    }
    console.log('Repay', (await lendingPool.methods.repay(reserve, amount, rate, repayfor).send({from: user, gas: 2000000})).transactionHash);
    console.log('Revoke approve', (await token.methods.approve(lendingPool.options.address, 0).send({from: user, gas: 2000000})).transactionHash);
    return;
  }
  if (action == 'migrate-step-2') {
    const user = params[0];
    if (privateKeyRequired) {
      pk = params[1];
      if (!pk) {
        console.error('Missing private key');
        return;
      }
      kit.addAccount(pk);
    }
    const reserveTokensMCUSD = await dataProvider.methods.getReserveTokensAddresses(reserves.cusd).call();
    const reserveTokensMCEUR = await dataProvider.methods.getReserveTokensAddresses(reserves.ceur).call();
    const reserveTokensMCELO = await dataProvider.methods.getReserveTokensAddresses(reserves.celo).call();
    const debtTokenMCUSD = new eth.Contract(DebtToken, reserveTokensMCUSD.variableDebtTokenAddress);
    const debtTokenMCEUR = new eth.Contract(DebtToken, reserveTokensMCEUR.variableDebtTokenAddress);
    const debtTokenMCELO = new eth.Contract(DebtToken, reserveTokensMCELO.variableDebtTokenAddress);
    console.log('Delegate migrator CUSD', (await debtTokenMCUSD.methods.approveDelegation(migrator.options.address, maxUint256).send({from: user, gas: 2000000})).transactionHash);
    console.log('Delegate migrator CEUR', (await debtTokenMCEUR.methods.approveDelegation(migrator.options.address, maxUint256).send({from: user, gas: 2000000})).transactionHash);
    console.log('Delegate migrator CELO', (await debtTokenMCELO.methods.approveDelegation(migrator.options.address, maxUint256).send({from: user, gas: 2000000})).transactionHash);
    try {
      await retry(() => migrator.methods.migrate().estimateGas({from: user, gas: 4000000}));
      console.log('Migrate', (await migrator.methods.migrate().send({from: user, gas: 4000000})).transactionHash);
    } catch (err) {
      console.error('Cannot migrate', err.message);
    }
    console.log('Revoke delegation from migrator CUSD', (await debtTokenMCUSD.methods.approveDelegation(migrator.options.address, 0).send({from: user, gas: 2000000})).transactionHash);
    console.log('Revoke delegation from migrator CEUR', (await debtTokenMCEUR.methods.approveDelegation(migrator.options.address, 0).send({from: user, gas: 2000000})).transactionHash);
    console.log('Revoke delegation from migrator CELO', (await debtTokenMCELO.methods.approveDelegation(migrator.options.address, 0).send({from: user, gas: 2000000})).transactionHash);
    console.log('Now proceed to moola-v1 migrate-step-3');
    return;
  }

  if (action == 'liquidation-bot') {
    if (network == 'test') {
      throw new Error('Liquidation bot only works on the mainnet.');
    }
    
    // doing some setup here
    const tokenNames = Object.keys(tokens)
    const localnode = process.env.CELO_BOT_NODE || kit.connection.web3.currentProvider.existingProvider.host;
    const user = process.env.CELO_BOT_ADDRESS || params[0];
    if (privateKeyRequired) {
      pk = process.env.CELO_BOT_PK || params[1];
      if (!pk) {
        console.error('Missing private key');
        return;
      }
      kit.addAccount(pk);
    }
    const sushiSwapRouter = '0x1421bDe4B10e8dd459b3BCb598810B1337D56842';
    const wrappedEth = '0xE919F65739c26a42616b7b8eedC6b5524d1e3aC4';
    const uniswap = new kit.web3.eth.Contract(Uniswap, sushiSwapRouter);

    // approving spend of the tokens
    await Promise.map(tokenNames, async (token) => {
      console.log(`Checking ${token} for approval`)
      if ((await tokens[token].methods.allowance(user, lendingPool.options.address).call()).length < 30) {
        console.log('Approve Moola', (await tokens[token].methods.approve(lendingPool.options.address, maxUint256).send({from: user, gas: 2000000})).transactionHash);
      }
      if ((await tokens[token].methods.allowance(user, uniswap.options.address).call()).length < 30) {
        console.log('Approve Uniswap', (await tokens[token].methods.approve(uniswap.options.address, maxUint256).send({from: user, gas: 2000000})).transactionHash);
      }
    })

    const eventsCollector = require('events-collector');
    let fromBlock = 8955468;
    let users = {};
    while(true) {
      try {
        // get new blocks and search
        const [newEvents, parsedToBlock] = await eventsCollector({
          rpcUrl: localnode,
          log: console.log,
          abi: LendingPool.filter(el => el.name == 'Borrow'),
          address: lendingPool.options.address,
          blockStep: 5000,
          fromBlock,
          toBlock: 'latest',
          blocksExclude: 0,
          timestamps: false,
        });
        fromBlock = parsedToBlock;
        for (let event of newEvents) {
          if (event.args.user) {
            users[event.args.user] = true;
          }
          if (event.args.onBehalfOf) {
            users[event.args.onBehalfOf] = true;
          }
        }

        // collecting users that have a non zero debt
        const usersData = await Promise.map(Object.keys(users), async (address) => [address, await lendingPool.methods.getUserAccountData(address).call()], {concurrency: 20})
          .filter(([address, data]) => !BN(data.totalDebtETH).isZero());
        
        console.log(`Users with debts: ${usersData.length}`);

        // sorting to get riskiest on top
        const riskiest = usersData.sort(([a1, data1], [a2, data2]) => BN(data1.healthFactor).comparedTo(BN(data2.healthFactor)));

        // showing top 3 riskiest users
        console.log(`Top 3 Riskiest users of ${riskiest.length}:`);
        for (let riskiestUser of riskiest.slice(0, 3)) {
          console.log(`${riskiestUser[0]} ${BN(print(riskiestUser[1].healthFactor)).toFixed(3)} ${BN(print(riskiestUser[1].totalCollateralETH)).toFixed(3)}`);
        }

        // should probably limit the amount of users we run on here (could be a LONG list)
        const risky = usersData.filter(([address, data]) => BN(data.healthFactor).dividedBy(ether).lt(BN(1))).map(el => el[0]);

        console.log(`found ${risky.length} users to run`);

        // need to check the run time per user here TODO
        for (let riskUser of risky) {
          console.log(`!!!!! liquidating user ${riskUser} !!!!!`)
          const riskData = await lendingPool.methods.getUserAccountData(riskUser).call();

          // doing this for every liquidation attempt as rates will change after every successful liquidation (by this bot or others)
          const rates = {}
          await Promise.map(tokenNames, async (token) => {
            if (token === 'celo') {
              rates["celo"] = BN(ether)
            } else {
              rates[token] = BN((await uniswap.methods.getAmountsOut(ether, [CELO.options.address, wrappedEth, tokens[token].options.address]).call())[2])
            }
          })

          // building user positions for all tokens (perhpas get the list of user balances instead of getting the reserve data for all of them)
          const positions = await Promise.map(tokenNames, async (token) => {
            let pos = await dataProvider.methods.getUserReserveData(tokens[token].options.address, riskUser).call()
            return [token, pos];
          })

          // for display only
          const parsedData = {
            Address: riskUser,
            TotalCollateral: print(riskData.totalCollateralETH),
            TotalDebt: print(riskData.totalDebtETH),
            HealthFactor: print(riskData.healthFactor),
          }
          console.table(parsedData);

          // building collateral vs borrow and finding the largest ones
          const biggestBorrow = positions.sort(([res1, data1], [res2, data2]) => BN(data2.currentStableDebt).plus(data2.currentVariableDebt).multipliedBy(rates[res2]).dividedBy(ether).comparedTo(BN(data1.currentStableDebt).plus(data1.currentVariableDebt).multipliedBy(rates[res1]).dividedBy(ether)))[0];
          const biggestCollateral = positions.filter(([_, data]) => data.usageAsCollateralEnabled).sort(([res1, data1], [res2, data2]) => BN(data2.currentATokenBalance).multipliedBy(rates[res2]).dividedBy(ether).comparedTo(BN(data1.currentATokenBalance).multipliedBy(rates[res1]).dividedBy(ether)))[0];

          const collateralToken = biggestCollateral[0].toLowerCase();
          const borrowToken = biggestBorrow[0].toLowerCase();

          try {
            try {
              // estimating gas cost for liquidation just as a precaution
              await lendingPool.methods.liquidationCall(tokens[collateralToken].options.address, tokens[borrowToken].options.address, riskUser, await tokens[borrowToken].methods.balanceOf(user).call(), false).estimateGas({from: user, gas: 2000000});
            } catch (err) {
              console.log(`[${riskUser}] Cannot estimate liquidate ${collateralToken}->${borrowToken}`, err.message);
              throw err;
            }

            // balance before liquidation
            const collateralBefore = await tokens[collateralToken].methods.balanceOf(user).call();
            console.log(`Balance of ${collateralToken} Before Liquidation: ${print(collateralBefore)}`);

            // liquidating
            await lendingPool.methods.liquidationCall(tokens[collateralToken].options.address, tokens[borrowToken].options.address, riskUser, await tokens[borrowToken].methods.balanceOf(user).call(), false).send({from: user, gas: 2000000});

            // calculating profit
            const profit = BN((await tokens[collateralToken].methods.balanceOf(user).call())).minus(collateralBefore);

            // make sure we are profiting from this liquidation
            console.log(`Profit: ${print(profit)}`);
            if (!profit.isPositive()) {
              console.log(`NO Profit!`);
              throw new Error('No Profit');
            }

            // setting up the swap
            if (collateralToken !== borrowToken) {
              // set swap path
              let swapPath = [tokens[collateralToken].options.address, tokens[borrowToken].options.address];

              // for swapping celo we need to go through wrapped ETH
              if (borrowToken === 'celo' || collateralToken === 'celo') {
                swapPath = [tokens[collateralToken].options.address, wrappedEth, tokens[borrowToken].options.address]
              }

              // swap the liquidated asset
              await retry(async () => {
                // getting swap rate
                const amountOut = BN((await uniswap.methods.getAmountsOut(profit, swapPath).call())[swapPath.length - 1]);

                // estimate gas for the swap as a precaution
                try {
                  await uniswap.methods.swapExactTokensForTokens(profit, amountOut.multipliedBy(BN(999)).dividedBy(BN(1000)).toFixed(0), swapPath, user, nowSeconds() + 300).estimateGas({from: user, gas: 2000000});
                } catch (err) {
                  console.log(`[${riskUser}] Cannot estimate swap ${collateralToken}->${borrowToken}`, err.message);
                  throw err;
                }

                // swap
                const receipt = await uniswap.methods.swapExactTokensForTokens(profit, amountOut.multipliedBy(BN(999)).dividedBy(BN(1000)).toFixed(0), swapPath, user, nowSeconds() + 300).send({from: user, gas: 2000000});
                if (!receipt.status) {
                  throw Error('Swap failed');
                }
              });
            }

            // all done! showing balance after liquidation
            console.log(`${collateralToken}: ${print(await tokens[collateralToken].methods.balanceOf(user).call())}`);
          } catch (err) {
            // something went wrong
            console.log(`[${riskUser}] Cannot send liquidate ${collateralToken}->${borrowToken}`, err.message);
          }
        }
      } catch (err) {
        console.log(`!!!!error ${err} !!!!`)
      }
      await Promise.delay(60000);
    }
  }
  console.error(`Unknown action: ${action}`);
  printActions();
}

execute(...process.argv.slice(2).map(arg => arg.toLowerCase()));
