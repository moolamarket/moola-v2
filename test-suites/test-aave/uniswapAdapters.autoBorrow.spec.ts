import { makeSuite, TestEnv } from './helpers/make-suite';
import {
  convertToCurrencyDecimals,
  getContract,
  buildPermitParams,
  getSignatureFromTypedData,
  buildRepayAdapterParams,
} from '../../helpers/contracts-helpers';
import { getMockUniswapRouter } from '../../helpers/contracts-getters';
import { deployAutoRepay } from '../../helpers/contracts-deployments';
import { MockUniswapV2Router02 } from '../../types/MockUniswapV2Router02';
import { Zero } from '@ethersproject/constants';
import BigNumber from 'bignumber.js';
import { DRE, evmRevert, evmSnapshot } from '../../helpers/misc-utils';
import { ethers } from 'ethers';
import { eContractid } from '../../helpers/types';
import { StableDebtToken } from '../../types/StableDebtToken';
import { BUIDLEREVM_CHAINID } from '../../helpers/buidler-constants';
import { MAX_UINT_AMOUNT } from '../../helpers/constants';
import { VariableDebtToken, WETHGateway } from '../../types';
const { parseEther } = ethers.utils;

const { expect } = require('chai');
const zeroHash = '0x0000000000000000000000000000000000000000000000000000000000000000';
const zeroAddress = '0x0000000000000000000000000000000000000000';
const zeroPermitSignature = {
  amount: 0,
  deadline: 0,
  v: 0,
  r: zeroHash,
  s: zeroHash,
};

makeSuite('Uniswap adapters', (testEnv: TestEnv) => {
  let mockUniswapRouter: MockUniswapV2Router02;
  let evmSnapshotId: string;
  before(async () => {
    mockUniswapRouter = await getMockUniswapRouter();
  });
  beforeEach(async () => {
    evmSnapshotId = await evmSnapshot();
  });
  afterEach(async () => {
    await evmRevert(evmSnapshotId);
  });
  describe('AutoBorrow', () => {
    beforeEach(async () => {
      const { users, weth, dai, usdc, aave, pool, deployer } = testEnv;
      const userAddress = users[0].address;

      // Provide liquidity
      await dai.mint(parseEther('20000'));
      await dai.approve(pool.address, parseEther('20000'));
      await pool.deposit(dai.address, parseEther('20000'), deployer.address, 0);

      const usdcLiquidity = await convertToCurrencyDecimals(usdc.address, '2000000');
      await usdc.mint(usdcLiquidity);
      await usdc.approve(pool.address, usdcLiquidity);
      await pool.deposit(usdc.address, usdcLiquidity, deployer.address, 0);

      await weth.mint(parseEther('100'));
      await weth.approve(pool.address, parseEther('100'));
      await pool.deposit(weth.address, parseEther('100'), deployer.address, 0);

      await aave.mint(parseEther('1000000'));
      await aave.approve(pool.address, parseEther('1000000'));
      await pool.deposit(aave.address, parseEther('1000000'), deployer.address, 0);

      // Make a deposit for user
      await weth.mint(parseEther('1000'));
      await weth.approve(pool.address, parseEther('1000'));
      await pool.deposit(weth.address, parseEther('1000'), userAddress, 0);

      await aave.mint(parseEther('1000000'));
      await aave.approve(pool.address, parseEther('1000000'));
      await pool.deposit(aave.address, parseEther('1000000'), userAddress, 0);

      await usdc.mint(usdcLiquidity);
      await usdc.approve(pool.address, usdcLiquidity);
      await pool.deposit(usdc.address, usdcLiquidity, userAddress, 0);
    });
    describe('constructor', () => {
      it('should deploy with correct parameters', async () => {
        const { addressesProvider, weth } = testEnv;
        await deployAutoRepay([addressesProvider.address, mockUniswapRouter.address, weth.address]);
      });
      it('should revert if not valid addresses provider', async () => {
        const { weth } = testEnv;
        expect(
          deployAutoRepay([mockUniswapRouter.address, mockUniswapRouter.address, weth.address])
        ).to.be.reverted;
      });
    });
    const ten = ethers.BigNumber.from(10);
    describe('executeOperation', () => {
      it('should be possible to setMinTargetMaxHealthFactor and then clearMinTargetMaxHealthFactor', async () => {
        const { users, pool, weth, oracle, dai, autoRepay } = testEnv;
        const user = users[0].signer;
        const userAddress = users[0].address;

        const userData = await pool.getUserAccountData(userAddress);
        await expect(
          autoRepay
          .connect(user)
          .setMinTargetMaxHealthFactor(
            userData.healthFactor.div(4),
            userData.healthFactor.div(2),
            userData.healthFactor.sub(parseEther('0.01')),
            dai.address,
            weth.address,
            1
          )
        ).to.emit(autoRepay, 'HealthFactorSet')
        .withArgs(userAddress, userData.healthFactor.div(4), userData.healthFactor.div(2), userData.healthFactor.sub(parseEther('0.01')), dai.address, weth.address);

        const userInfosSet = await autoRepay.userInfos(userAddress);
        expect(userInfosSet.minHealthFactor).to.be.eq(userData.healthFactor.div(4));
        expect(userInfosSet.targetHealthFactor).to.be.eq(userData.healthFactor.div(2));
        expect(userInfosSet.maxHealthFactor).to.be.eq(userData.healthFactor.sub(parseEther('0.01')));
        expect(userInfosSet.rateMode).to.be.eq(1);
        expect(userInfosSet.collateralAddress).to.be.eq(weth.address);
        expect(userInfosSet.borrowAddress).to.be.eq(dai.address);

        await expect(
          autoRepay
          .connect(user)
          .clearMinTargetMaxHealthFactor()
        ).to.emit(autoRepay, 'HealthFactorSet')
        .withArgs(userAddress, Zero, Zero, Zero, zeroAddress, zeroAddress);

        const userInfosCleared = await autoRepay.userInfos(userAddress);
        expect(userInfosCleared.minHealthFactor).to.be.eq(Zero);
        expect(userInfosCleared.targetHealthFactor).to.be.eq(Zero);
        expect(userInfosCleared.maxHealthFactor).to.be.eq(Zero);
        expect(userInfosCleared.rateMode).to.be.eq(Zero);
        expect(userInfosCleared.collateralAddress).to.be.eq(zeroAddress);
        expect(userInfosCleared.borrowAddress).to.be.eq(zeroAddress);
      });

      it('should NOT be possible to setMinTargetMaxHealthFactor if collateralAddress or rateMode or borrowAddress are not valid', async () => {
        const { users, pool, weth, oracle, dai, autoRepay } = testEnv;
        const user = users[0].signer;
        const userAddress = users[0].address;
        const notValidAddress = users[6].address;

        const userData = await pool.getUserAccountData(userAddress);
        await expect(
          autoRepay
          .connect(user)
          .setMinTargetMaxHealthFactor(
            userData.healthFactor.div(4),
            userData.healthFactor.div(2),
            userData.healthFactor.sub(parseEther('0.01')),
            notValidAddress,
            weth.address,
            1
          )
        ).to.be.revertedWith('Not valid borrowAddress provided');

        await expect(
          autoRepay
          .connect(user)
          .setMinTargetMaxHealthFactor(
            userData.healthFactor.div(4),
            userData.healthFactor.div(2),
            userData.healthFactor.sub(parseEther('0.01')),
            dai.address,
            notValidAddress,
            1
          )
        ).to.be.revertedWith('Not valid collateralAddress provided');

        await expect(
          autoRepay
          .connect(user)
          .setMinTargetMaxHealthFactor(
            userData.healthFactor.div(4),
            userData.healthFactor.div(2),
            userData.healthFactor.sub(parseEther('0.01')),
            dai.address,
            weth.address,
            1000
          )
        ).to.be.revertedWith('Not valid rate mode provided');
      });
      it('should NOT be possible to setMinTargetMaxHealthFactor if collateralAddress and borrowAddress are equal', async () => {
        const { users, pool, weth, oracle, dai, autoRepay } = testEnv;
        const user = users[0].signer;
        const userAddress = users[0].address;
        const notValidAddress = users[6].address;

        const userData = await pool.getUserAccountData(userAddress);
        await expect(
          autoRepay
          .connect(user)
          .setMinTargetMaxHealthFactor(
            userData.healthFactor.div(4),
            userData.healthFactor.div(2),
            userData.healthFactor.sub(parseEther('0.01')),
            weth.address,
            weth.address,
            1
          )
        ).to.be.revertedWith('Collateral and borrow could not be equal');
      });

      it('should NOT be possible swap tokens and borrow if caller is not whitelisted', async () => {
        const { users, pool, weth, aWETH, oracle, dai, autoRepay, helpersContract, aDai } = testEnv;
        const user = users[0].signer;
        const userAddress = users[0].address;
        const caller = users[1].signer;
        const callerAddress = users[1].address;
        const amountWETHtoSwap = await convertToCurrencyDecimals(weth.address, '10');
        const daiPrice = await oracle.getAssetPrice(dai.address);
        const expectedDaiAmount = await convertToCurrencyDecimals(
          dai.address,
          new BigNumber(amountWETHtoSwap.toString()).div(daiPrice.toString()).toFixed(0)
        );

        // Open user Debt
        await pool.connect(user).borrow(dai.address, expectedDaiAmount, 1, 0, userAddress);
        const daiBalance = await dai.balanceOf(userAddress);
        await dai.connect(user).transfer(users[5].address, daiBalance)
        const daiStableDebtTokenAddress = (
          await helpersContract.getReserveTokensAddresses(dai.address)
        ).stableDebtTokenAddress;
        const daiStableDebtContract = await getContract<StableDebtToken>(
          eContractid.StableDebtToken,
          daiStableDebtTokenAddress
        );

        const amountDaiToSwap = await convertToCurrencyDecimals(dai.address, '100');

        const daiDecimals = await dai.decimals();
        const expectedWETHAmount = amountDaiToSwap.mul(daiPrice).div(ten.pow(daiDecimals));
        const liquidityToSwap = expectedWETHAmount;

        const userData = await pool.getUserAccountData(userAddress);
        await autoRepay
          .connect(user)
          .setMinTargetMaxHealthFactor(userData.healthFactor.div(4), userData.healthFactor.div(2), userData.healthFactor.sub(parseEther('0.01')), dai.address, weth.address, 1);

        await mockUniswapRouter.connect(user).setAmountToReturn(dai.address, liquidityToSwap);

        await daiStableDebtContract.connect(user).approveDelegation(autoRepay.address, MAX_UINT_AMOUNT)

        await expect(
          autoRepay.connect(caller).decreaseHealthFactor(
            {
              user: userAddress,
              minCollateralAmountOut: expectedWETHAmount,
              borrowAmount: amountDaiToSwap,
              path: [dai.address, weth.address],
              useATokenAsFrom: false,
              useATokenAsTo: false,
              useFlashloan: true,
            },
            zeroPermitSignature
          )
        ).to.be.revertedWith('Caller is not whitelisted');
      });

      it('should NOT be possible swap tokens and borrow if current healthfactor is less then maxHealthFactor', async () => {
        const { users, pool, weth, aWETH, oracle, dai, autoRepay, helpersContract, aDai } = testEnv;
        const user = users[0].signer;
        const userAddress = users[0].address;
        const caller = users[1].signer;
        const callerAddress = users[1].address;
        const amountWETHtoSwap = await convertToCurrencyDecimals(weth.address, '10');
        const daiPrice = await oracle.getAssetPrice(dai.address);
        const expectedDaiAmount = await convertToCurrencyDecimals(
          dai.address,
          new BigNumber(amountWETHtoSwap.toString()).div(daiPrice.toString()).toFixed(0)
        );

        // Open user Debt
        await pool.connect(user).borrow(dai.address, expectedDaiAmount, 1, 0, userAddress);
        const daiBalance = await dai.balanceOf(userAddress);
        await dai.connect(user).transfer(users[5].address, daiBalance)
        const daiStableDebtTokenAddress = (
          await helpersContract.getReserveTokensAddresses(dai.address)
        ).stableDebtTokenAddress;
        const daiStableDebtContract = await getContract<StableDebtToken>(
          eContractid.StableDebtToken,
          daiStableDebtTokenAddress
        );

        const amountDaiToSwap = await convertToCurrencyDecimals(dai.address, '100');

        const daiDecimals = await dai.decimals();
        const expectedWETHAmount = amountDaiToSwap.mul(daiPrice).div(ten.pow(daiDecimals));
        const liquidityToSwap = expectedWETHAmount;

        const userData = await pool.getUserAccountData(userAddress);
        await autoRepay
          .connect(user)
          .setMinTargetMaxHealthFactor(userData.healthFactor.div(4), userData.healthFactor.div(2), userData.healthFactor.add(parseEther('0.01')), dai.address, weth.address, 1);

        await mockUniswapRouter.connect(user).setAmountToReturn(dai.address, liquidityToSwap);

        await daiStableDebtContract.connect(user).approveDelegation(autoRepay.address, MAX_UINT_AMOUNT)
        await autoRepay.whitelistAddress(callerAddress);

        await expect(
          autoRepay.connect(caller).decreaseHealthFactor(
            {
              user: userAddress,
              minCollateralAmountOut: expectedWETHAmount,
              borrowAmount: amountDaiToSwap,
              path: [dai.address, weth.address],
              useATokenAsFrom: false,
              useATokenAsTo: false,
              useFlashloan: true,
            },
            zeroPermitSignature
          )
        ).to.be.revertedWith('User health factor must be more than maxHealthFactor for user');
      });

      it('should correctly swap tokens and borrow with flashloan', async () => {
        const { users, pool, weth, aWETH, oracle, dai, autoRepay, helpersContract, aDai } = testEnv;
        const user = users[0].signer;
        const userAddress = users[0].address;
        const caller = users[1].signer;
        const callerAddress = users[1].address;
        const amountWETHtoSwap = await convertToCurrencyDecimals(weth.address, '10');
        const daiPrice = await oracle.getAssetPrice(dai.address);
        const expectedDaiAmount = await convertToCurrencyDecimals(
          dai.address,
          new BigNumber(amountWETHtoSwap.toString()).div(daiPrice.toString()).toFixed(0)
        );

        // Open user Debt
        await pool.connect(user).borrow(dai.address, expectedDaiAmount, 1, 0, userAddress);
        const daiBalance = await dai.balanceOf(userAddress);
        await dai.connect(user).transfer(users[5].address, daiBalance)
        const daiStableDebtTokenAddress = (
          await helpersContract.getReserveTokensAddresses(dai.address)
        ).stableDebtTokenAddress;
        const daiStableDebtContract = await getContract<StableDebtToken>(
          eContractid.StableDebtToken,
          daiStableDebtTokenAddress
        );
        const userDaiStableDebtAmountBefore = await daiStableDebtContract.balanceOf(userAddress);

        const amountDaiToSwap = await convertToCurrencyDecimals(dai.address, '100');

        const daiDecimals = await dai.decimals();
        const expectedWETHAmount = amountDaiToSwap.mul(daiPrice).div(ten.pow(daiDecimals));
        const liquidityToSwap = expectedWETHAmount;
        const callerFee = liquidityToSwap
          .mul(await autoRepay.FEE())
          .div(await autoRepay.HUNDRED_PERCENT());
        await autoRepay.whitelistAddress(callerAddress);
        const userData = await pool.getUserAccountData(userAddress);
        await autoRepay
          .connect(user)
          .setMinTargetMaxHealthFactor(userData.healthFactor.div(4), userData.healthFactor.div(2), userData.healthFactor.sub(parseEther('0.01')), dai.address, weth.address, 1);


        const userAEthBalanceBefore = await aWETH.balanceOf(userAddress);

        await mockUniswapRouter.connect(user).setAmountToReturn(dai.address, liquidityToSwap);

        await daiStableDebtContract.connect(user).approveDelegation(autoRepay.address, MAX_UINT_AMOUNT)

        await expect(
          autoRepay.connect(caller).decreaseHealthFactor(
            {
              user: userAddress,
              minCollateralAmountOut: expectedWETHAmount,
              borrowAmount: amountDaiToSwap,
              path: [dai.address, weth.address],
              useATokenAsFrom: false,
              useATokenAsTo: false,
              useFlashloan: true,
            },
            zeroPermitSignature
          )
        ).to.emit(autoRepay, 'Swapped')
        .withArgs(dai.address, weth.address, amountDaiToSwap, liquidityToSwap.toString());
        const adapterWethBalance = await weth.balanceOf(autoRepay.address);
        const adapterDaiBalance = await dai.balanceOf(autoRepay.address);
        const userDaiStableDebtAmount = await daiStableDebtContract.balanceOf(userAddress);
        const userAEthBalance = await aWETH.balanceOf(userAddress);
        const callerAEthBalance = await aWETH.balanceOf(callerAddress);
        const healthFactorAfter = (await pool.getUserAccountData(userAddress)).healthFactor;

        expect(adapterWethBalance).to.be.eq(Zero);
        expect(adapterDaiBalance).to.be.eq(Zero);
        expect(userDaiStableDebtAmountBefore).to.be.lte(expectedDaiAmount.add(amountDaiToSwap));
        expect(userDaiStableDebtAmount).to.be.gte(expectedDaiAmount.add(amountDaiToSwap));
        expect(userAEthBalance).to.be.gt(userAEthBalanceBefore);
        expect(userAEthBalance).to.be.eq(
          userAEthBalanceBefore.add(liquidityToSwap).sub(callerFee)
        );
        expect(callerAEthBalance).to.be.eq(callerFee);
        expect(healthFactorAfter).to.be.lt(userData.healthFactor);
      });

    });
    describe('swapAndBorrow', () => {
      it('should correctly swap tokens and borrow', async () => {
        const { users, pool, weth, aWETH, oracle, dai, autoRepay, helpersContract, aDai } = testEnv;
        const user = users[0].signer;
        const userAddress = users[0].address;
        const caller = users[1].signer;
        const callerAddress = users[1].address;
        const amountWETHtoSwap = await convertToCurrencyDecimals(weth.address, '10');
        const daiPrice = await oracle.getAssetPrice(dai.address);
        const expectedDaiAmount = await convertToCurrencyDecimals(
          dai.address,
          new BigNumber(amountWETHtoSwap.toString()).div(daiPrice.toString()).toFixed(0)
        );
        // Open user Debt
        await pool.connect(user).borrow(dai.address, expectedDaiAmount, 1, 0, userAddress);

        const daiBalance = await dai.balanceOf(userAddress);
        await dai.connect(user).transfer(users[5].address, daiBalance)

        const daiStableDebtTokenAddress = (
          await helpersContract.getReserveTokensAddresses(dai.address)
        ).stableDebtTokenAddress;
        const daiStableDebtContract = await getContract<StableDebtToken>(
          eContractid.StableDebtToken,
          daiStableDebtTokenAddress
        );
        const userDaiStableDebtAmountBefore = await daiStableDebtContract.balanceOf(userAddress);

        const amountDaiToSwap = await convertToCurrencyDecimals(dai.address, '100');

        const daiDecimals = await dai.decimals();
        const expectedWETHAmount = amountDaiToSwap.mul(daiPrice).div(ten.pow(daiDecimals));
        const liquidityToSwap = expectedWETHAmount;
        const callerFee = liquidityToSwap
          .mul(await autoRepay.FEE())
          .div(await autoRepay.HUNDRED_PERCENT());
        await autoRepay.whitelistAddress(callerAddress);
        const userData = await pool.getUserAccountData(userAddress);
        await autoRepay
          .connect(user)
          .setMinTargetMaxHealthFactor(userData.healthFactor.div(4), userData.healthFactor.div(2), userData.healthFactor.sub(parseEther('0.01')), dai.address, weth.address, 1);


        const userAEthBalanceBefore = await aWETH.balanceOf(userAddress);

        await mockUniswapRouter.connect(user).setAmountToReturn(dai.address, liquidityToSwap);

        await daiStableDebtContract.connect(user).approveDelegation(autoRepay.address, MAX_UINT_AMOUNT)

        // TODO check health factor before and after and it should be decreased
        await expect(
          autoRepay.connect(caller).decreaseHealthFactor(
            {
              user: userAddress,
              minCollateralAmountOut: expectedWETHAmount,
              borrowAmount: amountDaiToSwap,
              path: [dai.address, weth.address],
              useATokenAsFrom: false,
              useATokenAsTo: false,
              useFlashloan: false,
            },
            zeroPermitSignature
          )
        ).to.emit(autoRepay, 'Swapped')
        .withArgs(dai.address, weth.address, amountDaiToSwap, liquidityToSwap.toString());
        const adapterWethBalance = await weth.balanceOf(autoRepay.address);
        const adapterDaiBalance = await dai.balanceOf(autoRepay.address);
        const userDaiStableDebtAmount = await daiStableDebtContract.balanceOf(userAddress);
        const userAEthBalance = await aWETH.balanceOf(userAddress);
        const callerAEthBalance = await aWETH.balanceOf(callerAddress);
        const healthFactorAfter = (await pool.getUserAccountData(userAddress)).healthFactor;
        expect(adapterWethBalance).to.be.eq(Zero);
        expect(adapterDaiBalance).to.be.eq(Zero);
        expect(userDaiStableDebtAmountBefore).to.be.lte(expectedDaiAmount.add(amountDaiToSwap));
        expect(userDaiStableDebtAmount).to.be.gte(expectedDaiAmount.add(amountDaiToSwap));
        expect(userAEthBalance).to.be.gt(userAEthBalanceBefore);
        expect(userAEthBalance).to.be.eq(
          userAEthBalanceBefore.add(liquidityToSwap).sub(callerFee)
        );
        expect(callerAEthBalance).to.be.eq(callerFee);
        expect(healthFactorAfter).to.be.lt(userData.healthFactor);
      });
    });
  });
});
