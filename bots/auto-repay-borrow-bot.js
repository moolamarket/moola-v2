require('dotenv').config();

const AutoRepayAndBorrowAdapter = require('../abi/AutoRepayAndBorrowAdapter.json');
const LendingPoolAddressesProvider = require('../abi/LendingPoolAddressProvider.json');
const LendingPool = require('../abi/LendingPool.json');
const DataProvider = require('../abi/MoolaProtocolDataProvider.json');
const MToken = require('../abi/MToken.json');
const DebtToken = require('../abi/DebtToken.json');
const Uniswap = require('../abi/Uniswap.json');
const PriceOracle = require('../abi/PriceOracle.json');

const { newKit } = require('@celo/contractkit');
const BigNumber = require('bignumber.js');
const Promise = require('bluebird');
const eventsCollector = require('events-collector');
const ethers = require('ethers');
const SwapPath = require('./helpers/helpers.js');

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
  AutoRepayAndBorrowAdapter,
  '0xa948FD5F2653e8BFe35876730dB6a36FA4d46252'
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

const ubeswapRouter = '0xE3D8bd6Aed4F159bc8000a9cD47CffDb95F96121';
const ubeswap = new kit.web3.eth.Contract(Uniswap, ubeswapRouter);

const mcusdAddress = '0x918146359264c492bd6934071c6bd31c854edbc3';
const mceurAddress = '0xe273ad7ee11dcfaa87383ad5977ee1504ac07568';
const mceloAddress = '0x7d00cd74ff385c955ea3d79e47bf06bd7386387d';

const swapPathHelper = new SwapPath(ubeswap, CELO, mceloAddress, cUSD, mcusdAddress, cEUR, mceurAddress, cREAL, MOO);

const tokens = {
  celo: CELO,
  cusd: cUSD,
  ceur: cEUR,
  creal: cREAL,
  moo: MOO,
};

const web3 = kit.web3;
const eth = web3.eth;
kit.addAccount(CELO_BOT_KEY);
const caller = kit.connection.wallet.accountSigners.keys().next().value;

const retry = async (fun, tries = 5) => {
  try {
    return await fun();
  } catch (err) {
    if (tries == 0) throw err;
    await Promise.delay(100);
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
        abi: AutoRepayAndBorrowAdapter.filter((el) => el.name == 'HealthFactorSet'),
        address: autoRepay.options.address,
        blockStep: 100000,
        fromBlock,
        toBlock: 'latest',
        blocksExclude: 0,
        timestamps: false,
      });
      fromBlock = parsedToBlock;

      for (let event of newEvents) {
        users[event.args.user] = {
          min: BN(event.args.min),
          target: BN(event.args.target),
          max: BN(event.args.max),
          rateMode: BN(event.args.rateMode),
          borrowAddress: event.args.borrowAddress,
          collateralAddress: event.args.collateralAddress
        };
      }

      const usersDataRepay = await Promise.map(
        Object.keys(users),
        async (address) => [
          address,
          await lendingPool.methods.getUserAccountData(address).call(),
        ],
        { concurrency: 20 }
      ).filter(([address, data]) => !BN(data.totalDebtETH).isZero() && BN(data.healthFactor).lt(users[address].min) && !BN(users[address].min).isZero());

      console.log(`Users to auto repay with low health factor: ${usersDataRepay.length}`);

      const tokenNames = Object.keys(tokens);

      for (let i = 0; i < usersDataRepay.length; i++) {
        const data = usersDataRepay[i];
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

        const collateralAddress = tokens[biggestCollateral[0]].options.address.toLowerCase();
        const borrowAddress = tokens[biggestBorrow[0]].options.address.toLowerCase();


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

        const reserveBorrowToken = await dataProvider.methods
        .getReserveTokensAddresses(borrowAddress)
        .call();
        

        const increaseHealthFactorMethod = async (repAmount, amountOut, useFlashloan) => {
          const { amount, path, useATokenAsFrom, useATokenAsTo}  = await swapPathHelper.getBestSwapPathRepay(
            amountOut, collateralAddress, reserveCollateralToken.aTokenAddress, borrowAddress, reserveBorrowToken.aTokenAddress
          );
          const maxCollateralAmount = BN(amount)
            .plus(BN(amount).multipliedBy(1).dividedBy(100))
            .toFixed(0); // 1% slippage
          const feeAmount = BN(maxCollateralAmount).multipliedBy(10).dividedBy(10000);
          let method = autoRepay.methods.increaseHealthFactor(
            {
              user,
              collateralAsset: collateralAddress,
              debtAsset: borrowAddress,
              collateralAmount: maxCollateralAmount.toString(0),
              debtRepayAmount: repAmount.toFixed(0),
              rateMode,
              path,
              useATokenAsFrom,
              useATokenAsTo,
              useFlashloan,
            },
            { amount: 0, deadline: 0, v: 0, r: ethers.constants.HashZero, s: ethers.constants.HashZero }
          );
          return { method, total: BN(maxCollateralAmount).plus(feeAmount) };
        }


        const repaySimulation = async (repAmount, attempt) => {
          console.log(`attempt: ${attempt}`)
          const amountOut = repAmount.plus(repAmount.multipliedBy(9).dividedBy(10000)).toFixed(0);
          let { method, total } = await increaseHealthFactorMethod(repAmount, amountOut, true);
          if (
            BN(await mToken.methods.allowance(user, autoRepay.options.address).call()).lt(total)
          ) {
            console.log(`user ${user} not approved ${mToken.options.address} tokens ${total.toFixed(0)} on autoRepay contract`);
            return;
          }

          try {
            await retry(() => method.estimateGas({ from: caller, gas: DEFAULT_GAS }));
            // if success simulation, trying to simulate without flashloan
            try {
              const amountOut = repAmount.toFixed(0);
              const { method: methodNoFlashloan, } = await increaseHealthFactorMethod(repAmount, amountOut, false);
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
            await repaySimulation(repAmount.multipliedBy(100 - attempt * 25).dividedBy(100), attempt + 1);
            return;
          }
          console.log(
            'auto repay',
            (await method.send({ from: caller, gas: DEFAULT_GAS })).transactionHash
          );
        }

        await repaySimulation(repayAmount, 1);

      }

      const usersDataBorrow = await Promise.map(
        Object.keys(users),
        async (address) => [
          address,
          await lendingPool.methods.getUserAccountData(address).call(),
        ],
        { concurrency: 20 }
      ).filter(([address, data]) => BN(data.healthFactor).gt(users[address].max) && !BN(users[address].max).isZero());

      console.log(`Users to auto repay with health factor more than max: ${usersDataBorrow.length}`);

      for (let i = 0; i < usersDataBorrow.length; i++) {
        const data = usersDataBorrow[i];
        const user = data[0];
        const accountData = data[1];
        const userData = users[user];
        const borrowAddress = userData.borrowAddress;
        const collateralAddress = userData.collateralAddress;
        const [ borrowTokenPrice, collateralTokenPrice ] = await priceOracle.methods.getAssetsPrices([userData.borrowAddress, userData.collateralAddress]).call()
        const maxAbleToBorrow = BN(accountData.totalCollateralETH).multipliedBy(ether).dividedBy(borrowTokenPrice).toFixed(0);

        const reserveCollateralToken = await dataProvider.methods
          .getReserveTokensAddresses(collateralAddress)
          .call();

        const reserveBorrowToken = await dataProvider.methods
        .getReserveTokensAddresses(borrowAddress)
        .call();

        const debtTokenAddress = userData.rateMode == 1 ? reserveBorrowToken.stableDebtTokenAddress : reserveBorrowToken.variableDebtTokenAddress;
        const debtTokenBorrow = new eth.Contract(DebtToken, debtTokenAddress);


        const decreaseHealthFactorMethod = async (maxAbleToBorrow, amount, useFlashloan) => {
          const { path, useATokenAsFrom, useATokenAsTo }  = await swapPathHelper.getBestSwapPathBorrow(
            maxAbleToBorrow, borrowAddress, reserveBorrowToken.aTokenAddress, collateralAddress, reserveCollateralToken.aTokenAddress
          );
          
          const minCollateralAmountOut = BN(amount)
            .minus(BN(amount).multipliedBy(1).dividedBy(100))
            .toFixed(0); // 0.1% slippage
          const method = autoRepay.methods.decreaseHealthFactor(
            {
              user,
              minCollateralAmountOut,
              borrowAmount: maxAbleToBorrow,
              path,
              useATokenAsFrom,
              useATokenAsTo,
              useFlashloan,
            },
            { amount: 0, deadline: 0, v: 0, r: ethers.constants.HashZero, s: ethers.constants.HashZero }
          );
          return method;
        }

        const borrowSimulation = async (maxAbleToBorrow, attempt) => {
          console.log(`attempt: ${attempt}`)
          const minCollateralAmountOut = BN(maxAbleToBorrow).multipliedBy(borrowTokenPrice).dividedBy(collateralTokenPrice).toFixed(0);
          const method = await decreaseHealthFactorMethod(maxAbleToBorrow, minCollateralAmountOut, true);

          if (
            BN(await debtTokenBorrow.methods.borrowAllowance(user, autoRepay.options.address).call()).lt(maxAbleToBorrow)
          ) {
            console.log(`user ${user} not approved borrowAllowance ${debtTokenBorrow.options.address} tokens ${maxAbleToBorrow.toString()} on autoRepay contract, rate mode: ${userData.rateMode}`);
            return;
          }

          try {
            await retry(() => method.estimateGas({ from: caller, gas: DEFAULT_GAS }));
            // if success simulation, trying to simulate without flashloan
            try {
              const methodNoFlashloan = await decreaseHealthFactorMethod(maxAbleToBorrow, minCollateralAmountOut, false);
              await retry(() => methodNoFlashloan.estimateGas({ from: caller, gas: DEFAULT_GAS }));
              method = methodNoFlashloan;

            } catch (error) {
              console.log('Could not borrow without flashloan, flashloan will be used');
            }
          } catch (err) {
            console.log(`Cannot auto borrow ${100 - (attempt - 1) * 25 } %`, err.message);

            if (attempt == 4) {
              console.log('Could not borrow');
              return;
            }
            await borrowSimulation(BN(maxAbleToBorrow).multipliedBy(100 - attempt * 25).dividedBy(100).toFixed(0), attempt + 1);
            return;
          }
          console.log(
            'auto borrow',
            (await method.send({ from: caller, gas: DEFAULT_GAS })).transactionHash
          );
        }

        await borrowSimulation(maxAbleToBorrow, 1);
      }

    }  catch (err) {
      console.log(`Global bot error: ${err} !!!!`);
    }
    await Promise.delay(60000);
  }
}



execute();