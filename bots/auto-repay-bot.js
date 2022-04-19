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
  // OLD '0xCC321F48CF7bFeFe100D1Ce13585dcfF7627f754'
  '0x268dbf33ebf61ea2706f070e348fdbe994d7db40'
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
const uniswap = new kit.web3.eth.Contract(Uniswap, ubeswapRouter);

const mcusdAddress = '0x918146359264C492BD6934071c6Bd31C854EDBc3';
const mceurAddress = '0xE273Ad7ee11dCfAA87383aD5977EE1504aC07568';
const mceloAddress = '0x7D00cd74FF385c955EA3d79e47BF06bD7386387D';

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

// todo add useATokenAsFrom, useATokenAsTo
paths[`${CELO.options.address}_${cUSD.options.address}`] = celo_cusd;
paths[`${CELO.options.address}_${cEUR.options.address}`] = celo_ceur;
paths[`${CELO.options.address}_${cREAL.options.address}`] = celo_creal;
paths[`${CELO.options.address}_${MOO.options.address}`] = celo_moo;
paths[`${cUSD.options.address}_${cEUR.options.address}`] = cusd_ceur;
paths[`${cUSD.options.address}_${cREAL.options.address}`] = cusd_creal;
paths[`${cUSD.options.address}_${MOO.options.address}`] = cusd_moo;
paths[`${cEUR.options.address}_${cREAL.options.address}`] = ceur_creal;
paths[`${cEUR.options.address}_${MOO.options.address}`] = ceur_moo;
paths[`${cREAL.options.address}_${MOO.options.address}`] = creal_moo;

paths[`${cUSD.options.address}_${CELO.options.address}`] = [...celo_cusd].reverse();
paths[`${cEUR.options.address}_${CELO.options.address}`] = [...celo_ceur].reverse();
paths[`${cREAL.options.address}_${CELO.options.address}`] = [...celo_creal].reverse();
paths[`${MOO.options.address}_${CELO.options.address}`] = [...celo_moo].reverse();
paths[`${cEUR.options.address}_${cUSD.options.address}`] = [...cusd_ceur].reverse();
paths[`${cREAL.options.address}_${cUSD.options.address}`] = [...cusd_creal].reverse();
paths[`${MOO.options.address}_${cUSD.options.address}`] = [...cusd_moo].reverse();
paths[`${cREAL.options.address}_${cEUR.options.address}`] = [...ceur_creal].reverse();
paths[`${MOO.options.address}_${cEUR.options.address}`] = [...ceur_moo].reverse();
paths[`${MOO.options.address}_${cREAL.options.address}`] = [...creal_moo].reverse();

console.log(paths)

const web3 = kit.web3;
const eth = web3.eth;
kit.addAccount(CELO_BOT_KEY);

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
        const borrowToken = biggestBorrow[0].toLowerCase();

        const swapPath = [] // TODO prepare path for each collateral - debt token

        // set path for swap as new parameter in increaseHealthFactor
        // try ... increaseHealthFactor for different collateralAmount
        // after increaseHealthFactor check that healthfactor is more DONE
        // check that allowance for for collateralAsset is ok on autorepay.address TODO

        // const method = autoRepay.methods.increaseHealthFactor(
        //   {
        //     user, // +
        //     collateralAsset: collateralAsset.options.address,
        //     debtAsset: debtAsset.options.address, // ??
        //     collateralAmount: maxCollateralAmount.toString(0), // ??
        //     debtRepayAmount: repayAmount.toFixed(0), // ?? gemAmountsOut
        //     rateMode, // ??
        //     path: swapPath
        //     useATokenAsFrom, // ??
        //     useATokenAsTo, // ??
        //     useFlashloan, // ??
        //   },
        //   { amount: 0, deadline: 0, v: 0, r: ethers.constants.HashZero, s: ethers.constants.HashZero }
        // );

        // try {
        //   await retry(() => method.estimateGas({ from: caller, gas: DEFAULT_GAS }));
        // } catch (err) {
        //   console.log('Cannot auto repay', err.message);
        //   return;
        // }
        // console.log(
        //   'auto repay',
        //   (await method.send({ from: caller, gas: DEFAULT_GAS })).transactionHash
        // );
      }

    }  catch (err) {
      console.log(`AutoRepay error: ${err} !!!!`);
    }
    await Promise.delay(60000);
  }
}

execute();