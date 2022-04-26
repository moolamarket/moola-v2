require('dotenv').config();

const AutoRepay = require('../abi/AutoRepay.json');
const LendingPoolAddressesProvider = require('../abi/LendingPoolAddressProvider.json');
const LendingPool = require('../abi/LendingPool.json');
const DataProvider = require('../abi/MoolaProtocolDataProvider.json');
const MToken = require('../abi/MToken.json');
const Uniswap = require('../abi/Uniswap.json');
const PriceOracle = require('../abi/PriceOracle.json');

const { newKit } = require('@celo/contractkit');
const BigNumber = require('bignumber.js');
const Promise = require('bluebird');
const eventsCollector = require('events-collector');
const ethers = require('ethers');
const path = require('path');

const CELO_BOT_KEY = process.env.CELO_BOT_KEY;
const DEFAULT_GAS = 2000000;

function BN(num) {
  return new BigNumber(num);
}


let kit;
let addressProvider;
let autoRepay;
let dataProvider;
let cUSD;
let cEUR;
let cREAL;
let MOO;
let CELO;

const ether = '1000000000000000000';
const rpc = 'https://forno.celo.org';
kit = newKit(rpc);
addressProvider = new kit.web3.eth.Contract(
  LendingPoolAddressesProvider,
  '0xD1088091A174d33412a968Fa34Cb67131188B332'
);
autoRepay = new kit.web3.eth.Contract(
  AutoRepay,
  '0xeb1549caebf24dd83e1b5e48abedd81be240e408'
);
dataProvider = new kit.web3.eth.Contract(
  DataProvider,
  '0x43d067ed784D9DD2ffEda73775e2CC4c560103A1'
);

cEUR = new kit.web3.eth.Contract(MToken, '0xD8763CBa276a3738E6DE85b4b3bF5FDed6D6cA73');
cUSD = new kit.web3.eth.Contract(MToken, '0x765DE816845861e75A25fCA122bb6898B8B1282a');
cREAL = new kit.web3.eth.Contract(MToken, '0xe8537a3d056DA446677B9E9d6c5dB704EaAb4787');
MOO = new kit.web3.eth.Contract(MToken, '0x17700282592D6917F6A73D0bF8AcCf4D578c131e');
CELO = new kit.web3.eth.Contract(MToken, '0x471EcE3750Da237f93B8E339c536989b8978a438');

const ubeswapRouter = '0xe3d8bd6aed4f159bc8000a9cd47cffdb95f96121';
const wrappedEth = '0xE919F65739c26a42616b7b8eedC6b5524d1e3aC4';
const ubeswap = new kit.web3.eth.Contract(Uniswap, ubeswapRouter);

const mcusdAddress = '0x918146359264c492bd6934071c6bd31c854edbc3';
const mceurAddress = '0xe273ad7ee11dcfaa87383ad5977ee1504ac07568';
const mceloAddress = '0x7d00cd74ff385c955ea3d79e47bf06bd7386387d';

const tokens = {
  celo: CELO,
  cusd: cUSD,
  ceur: cEUR,
  creal: cREAL,
  moo: MOO,
};

const celo_cusd = [CELO.options.address, mcusdAddress]; // celo-mcusd
const celo_ceur = [CELO.options.address, mceurAddress]; // celo-mceur
const celo_creal = [CELO.options.address, cUSD.options.address, cREAL.options.address]; // celo-cusd, cusd-creal pair
const celo_moo = [MOO.options.address, mceloAddress]; // mcelo-moo

const cusd_ceur = [mcusdAddress, mceurAddress]; // mcusd-mceur
const cusd_creal = [cUSD.options.address, cREAL.options.address]; // cusd-creal
const cusd_moo = [cUSD.options.address, CELO.options.address, MOO.options.address]; // cusd-celo, celo-moo pair

const ceur_creal = [cEUR.options.address, CELO.options.address, cUSD.options.address, cREAL.options.address]; // ceur-celo, celo-cusd, cusd-creal - only 3k usd in pools
const ceur_moo = [mceurAddress, CELO.options.address, MOO.options.address]; // mceur-celo, celo-moo

const creal_moo = [cREAL.options.address, cUSD.options.address, CELO.options.address, MOO.options.address]; // creal-cusd, cusd-celo, celo-moo

const paths = {};

paths[`${CELO.options.address}_${cUSD.options.address}`.toLowerCase()] = { path: celo_cusd, useATokenAsFrom: false, useATokenAsTo: true };
paths[`${CELO.options.address}_${cEUR.options.address}`.toLowerCase()] = { path: celo_ceur, useATokenAsFrom: false, useATokenAsTo: true };
paths[`${CELO.options.address}_${cREAL.options.address}`.toLowerCase()] = { path: celo_creal, useATokenAsFrom: false, useATokenAsTo: false };
paths[`${CELO.options.address}_${MOO.options.address}`.toLowerCase()] = { path: celo_moo, useATokenAsFrom: false, useATokenAsTo: true };
paths[`${cUSD.options.address}_${cEUR.options.address}`.toLowerCase()] = { path: cusd_ceur, useATokenAsFrom: true, useATokenAsTo: true };
paths[`${cUSD.options.address}_${cREAL.options.address}`.toLowerCase()] = { path: cusd_creal, useATokenAsFrom: false, useATokenAsTo: false };
paths[`${cUSD.options.address}_${MOO.options.address}`.toLowerCase()] = { path: cusd_moo, useATokenAsFrom: false, useATokenAsTo: false };
paths[`${cEUR.options.address}_${cREAL.options.address}`.toLowerCase()] = { path: ceur_creal, useATokenAsFrom: false, useATokenAsTo: false };
paths[`${cEUR.options.address}_${MOO.options.address}`.toLowerCase()] = { path: ceur_moo, useATokenAsFrom: true, useATokenAsTo: true };
paths[`${cREAL.options.address}_${MOO.options.address}`.toLowerCase()] = { path: creal_moo, useATokenAsFrom: false, useATokenAsTo: true };

paths[`${cUSD.options.address}_${CELO.options.address}`.toLowerCase()] = { path: [...celo_cusd].reverse(), useATokenAsFrom: true, useATokenAsTo: false };
paths[`${cEUR.options.address}_${CELO.options.address}`.toLowerCase()] = { path: [...celo_ceur].reverse(), useATokenAsFrom: true, useATokenAsTo: false };
paths[`${cREAL.options.address}_${CELO.options.address}`.toLowerCase()] = { path: [...celo_creal].reverse(), useATokenAsFrom: false, useATokenAsTo: false };
paths[`${MOO.options.address}_${CELO.options.address}`.toLowerCase()] = { path: [...celo_moo].reverse(), useATokenAsFrom: true, useATokenAsTo: false };
paths[`${cEUR.options.address}_${cUSD.options.address}`.toLowerCase()] = { path: [...cusd_ceur].reverse(), useATokenAsFrom: true, useATokenAsTo: true };
paths[`${cREAL.options.address}_${cUSD.options.address}`.toLowerCase()] = { path: [...cusd_creal].reverse(), useATokenAsFrom: false, useATokenAsTo: false };
paths[`${MOO.options.address}_${cUSD.options.address}`.toLowerCase()] = { path: [...cusd_moo].reverse(), useATokenAsFrom: false, useATokenAsTo: false };
paths[`${cREAL.options.address}_${cEUR.options.address}`.toLowerCase()] = { path: [...celo_creal].reverse(), useATokenAsFrom: false, useATokenAsTo: false };
paths[`${MOO.options.address}_${cEUR.options.address}`.toLowerCase()] = { path: [...ceur_moo].reverse(), useATokenAsFrom: true, useATokenAsTo: true };
paths[`${MOO.options.address}_${cREAL.options.address}`.toLowerCase()] = { path: [...creal_moo].reverse(), useATokenAsFrom: true, useATokenAsTo: false };

const web3 = kit.web3;
const eth = web3.eth;
kit.addAccount(CELO_BOT_KEY);
const caller = kit.connection.wallet.accountSigners.keys().next().value;

const retry = async (fun, tries = 5) => {
  try {
    return await fun();
  } catch (err) {
    if (tries == 0) throw err;
    await Promise.delay(1000);
    return retry(fun, tries - 1);
  }
};

async function execute() {
  const lendingPool = new eth.Contract(
    LendingPool,
    await addressProvider.methods.getLendingPool().call()
  );

  const priceOracle = new kit.web3.eth.Contract(
    PriceOracle,
    await addressProvider.methods.getPriceOracle().call()
  );

  let fromBlock = 12472487;
  let users = {};
  while (true) {
    try {
      const [newEvents, parsedToBlock] = await eventsCollector({
        rpcUrl: rpc,
        log: console.log,
        abi: AutoRepay.filter((el) => el.name == 'HealthFactorSet'),
        address: autoRepay.options.address,
        blockStep: 5000,
        fromBlock,
        toBlock: 'latest',
        blocksExclude: 0,
        timestamps: false,
      });
      fromBlock = parsedToBlock;

      for (let event of newEvents) {
        if (event.args.user) {
          users[event.args.user] = {min: BN(event.args.min), max: BN(event.args.max)};
        }
      }

      const usersData = await Promise.map(
        Object.keys(users),
        async (address) => [
          address,
          await lendingPool.methods.getUserAccountData(address).call(),
        ],
        { concurrency: 20 }
      ).filter(([address, data]) => !BN(data.totalDebtETH).isZero() && BN(data.healthFactor).lt(users[address].min));

      console.log(`Users to auto repay with low health factor: ${usersData.length}`);

      const tokenNames = Object.keys(tokens);

      for (let i = 0; i < usersData.length; i++) {
        const data = usersData[i];
        const user = data[0];

        // building user positions for all tokens (perhpas get the list of user balances instead of getting the reserve data for all of them)
        const positions = await Promise.map(tokenNames, async (token) => {
          let pos = await dataProvider.methods
            .getUserReserveData(tokens[token].options.address, user)
            .call();
          return [token, pos];
        });

        // doing this for every repay attempt as rates will change after every successful repay (by this bot or others)
        const rates = {};
        const tokenAddresses = tokenNames.map(name => tokens[name].options.address);
        const tokenPrices = await priceOracle.methods.getAssetsPrices(tokenAddresses).call()
        for (let i = 0; i < tokenPrices.length; i++) {
          rates[tokenNames[i]] = tokenPrices[i]
        }


        // building collateral vs borrow and finding the largest ones
        const biggestBorrow = positions.sort(([res1, data1], [res2, data2]) =>
          BN(data2.currentStableDebt)
            .plus(data2.currentVariableDebt)
            .multipliedBy(rates[res2])
            .dividedBy(ether)
            .comparedTo(
              BN(data1.currentStableDebt)
                .plus(data1.currentVariableDebt)
                .multipliedBy(rates[res1])
                .dividedBy(ether)
            )
        )[0];
        const biggestCollateral = positions
          .filter(([_, data]) => data.usageAsCollateralEnabled)
          .sort(([res1, data1], [res2, data2]) =>
            BN(data2.currentATokenBalance)
              .multipliedBy(rates[res2])
              .dividedBy(ether)
              .comparedTo(
                BN(data1.currentATokenBalance).multipliedBy(rates[res1]).dividedBy(ether)
              )
          )[0];

        const collateralToken = biggestCollateral[0].toLowerCase();
        const collateralAddress = tokens[biggestCollateral[0]].options.address.toLowerCase();
        const borrowToken = biggestBorrow[0].toLowerCase();
        const borrowAddress = tokens[biggestBorrow[0]].options.address.toLowerCase();

        const swapPath = paths[`${collateralAddress}_${borrowlAddress}`].path;
        const useATokenAsFrom = paths[`${collateralAddress}_${borrowlAddress}`].useATokenAsFrom;
        const useATokenAsTo = paths[`${collateralAddress}_${borrowlAddress}`].useATokenAsTo;

        let rateMode; // 1 for Stable, 2 for Variable
        let repayAmount;

        if (BN(biggestBorrow[1].currentVariableDebt).lt(BN(biggestBorrow[1].currentStableDebt))) {
          rateMode = 1;
          repayAmount = BN(biggestBorrow[1].currentStableDebt);
        } else {
          rateMode = 2;
          repayAmount = BN(biggestBorrow[1].currentVariableDebt);
        }

      const reserveCollateralToken = await dataProvider.methods
        .getReserveTokensAddresses(collateralAddress)
        .call();
      const mToken = new kit.web3.eth.Contract(MToken, reserveCollateralToken.aTokenAddress);
      const reserveDebtToken = await dataProvider.methods
        .getReserveTokensAddresses(borrowlAddress)
        .call();


      const repaySimulation = async (repAmount, attempt) => {
        console.log(`attempt: ${attempt}`)
        const amountOut = repAmount.plus(repAmount.multipliedBy(9).dividedBy(10000)).toFixed(0);
        const amounts = await ubeswap.methods
          .getAmountsIn(amountOut, swapPath)
          .call();
  
        const maxCollateralAmount = BN(amounts[0])
          .plus(BN(amounts[0]).multipliedBy(1).dividedBy(1000))
          .toFixed(0); // 0.1% slippage
        const feeAmount = BN(maxCollateralAmount).multipliedBy(10).dividedBy(10000);
        let method = autoRepay.methods.increaseHealthFactor(
          {
            user,
            collateralAsset: collateralAddress,
            debtAsset: borrowlAddress,
            collateralAmount: maxCollateralAmount.toString(0),
            debtRepayAmount: repAmount.toFixed(0),
            rateMode,
            path: swapPath,
            useATokenAsFrom,
            useATokenAsTo,
            useFlashloan: true,
          },
          { amount: 0, deadline: 0, v: 0, r: ethers.constants.HashZero, s: ethers.constants.HashZero }
        );


        if (
          BN(await mToken.methods.allowance(user, autoRepay.options.address).call()).lt(
            BN(maxCollateralAmount).plus(feeAmount)
          )
        ) {
          console.log(`user ${user} not approved ${mToken.options.address} tokens ${BN(maxCollateralAmount).plus(feeAmount).toFixed(0)} on autoRepay contract`);
          return;
        }

        try {
          await retry(() => method.estimateGas({ from: caller, gas: DEFAULT_GAS }));
          // if success simulation, trying to simulate without flashloan
          try {
            const amountOut = repAmount.toFixed(0);
            const amounts = await ubeswap.methods
              .getAmountsIn(amountOut, swapPath)
              .call();
      
            const maxCollateralAmount = BN(amounts[0])
              .plus(BN(amounts[0]).multipliedBy(1).dividedBy(1000))
              .toFixed(0); // 0.1% slippage
            const methodNoFlashloan = autoRepay.methods.increaseHealthFactor(
              {
                user,
                collateralAsset: collateralAddress,
                debtAsset: borrowlAddress,
                collateralAmount: maxCollateralAmount.toString(0),
                debtRepayAmount: repAmount.toString(0),
                rateMode,
                path: swapPath,
                useATokenAsFrom,
                useATokenAsTo,
                useFlashloan: false,
              },
              { amount: 0, deadline: 0, v: 0, r: ethers.constants.HashZero, s: ethers.constants.HashZero }
            );
            await retry(() => methodNoFlashloan.estimateGas({ from: caller, gas: DEFAULT_GAS }));
            method = methodNoFlashloan;

          } catch (error) {
            console.log('Could not repay without flashloan, flashloan will be used');
          }
        } catch (err) {
          console.log(`Cannot auto repay ${100 - (attempt - 1) * 25 } %`, err.message);

          if (attempt == 4) {
            console.log('Could not repay');
            return;
          }
          await repaySimulation(repAmount.multipliedBy(100 - attempt * 25).dividedBy(100), ++attempt);
          return;
        }
        console.log(
          'auto repay',
          (await method.send({ from: caller, gas: DEFAULT_GAS })).transactionHash
        );
      }

      const attempt = 1;
      await repaySimulation(repayAmount, attempt);

      }

    }  catch (err) {
      console.log(`Global bot error: ${err} !!!!`);
    }
    await Promise.delay(60000);
  }
}

execute();