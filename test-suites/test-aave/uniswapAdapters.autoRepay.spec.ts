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
  describe('AutoRepay', () => {
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
    describe('executeOperation', () => {
      it('should correctly swap tokens and repay debt', async () => {
        const { users, pool, weth, aWETH, oracle, dai, autoRepay, helpersContract } = testEnv;
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
        const daiStableDebtTokenAddress = (
          await helpersContract.getReserveTokensAddresses(dai.address)
        ).stableDebtTokenAddress;
        const daiStableDebtContract = await getContract<StableDebtToken>(
          eContractid.StableDebtToken,
          daiStableDebtTokenAddress
        );
        const userDaiStableDebtAmountBefore = await daiStableDebtContract.balanceOf(userAddress);
        const liquidityToSwap = amountWETHtoSwap;
        const callerFee = liquidityToSwap
          .mul(await autoRepay.FEE())
          .div(await autoRepay.HUNDRED_PERCENT());
        await autoRepay.whitelistAddress(callerAddress);
        const userData = await pool.getUserAccountData(userAddress);
        await autoRepay
          .connect(user)
          .setMinMaxHealthFactor(userData.healthFactor.add('1'), MAX_UINT_AMOUNT);
        await aWETH.connect(user).approve(autoRepay.address, liquidityToSwap.add(callerFee));
        const userAEthBalanceBefore = await aWETH.balanceOf(userAddress);
        await mockUniswapRouter.connect(user).setAmountToSwap(weth.address, liquidityToSwap);
        const flashLoanDebt = new BigNumber(expectedDaiAmount.toString())
          .multipliedBy(1.0001)
          .toFixed(0);
        await mockUniswapRouter.setAmountIn(
          flashLoanDebt,
          weth.address,
          dai.address,
          liquidityToSwap
        );
        await expect(
          autoRepay.connect(caller).increaseHealthFactor(
            {
              user: userAddress,
              collateralAsset: weth.address,
              debtAsset: dai.address,
              collateralAmount: liquidityToSwap,
              debtRepayAmount: expectedDaiAmount,
              rateMode: 1,
              path: [weth.address, dai.address],
              useATokenAsFrom: false,
              useATokenAsTo: false,
              useFlashloan: true,
            },
            zeroPermitSignature
          )
        )
          .to.emit(autoRepay, 'Swapped')
          .withArgs(weth.address, dai.address, liquidityToSwap.toString(), flashLoanDebt);
        const adapterWethBalance = await weth.balanceOf(autoRepay.address);
        const adapterDaiBalance = await dai.balanceOf(autoRepay.address);
        const userDaiStableDebtAmount = await daiStableDebtContract.balanceOf(userAddress);
        const userAEthBalance = await aWETH.balanceOf(userAddress);
        const callerAEthBalance = await aWETH.balanceOf(callerAddress);
        expect(adapterWethBalance).to.be.eq(Zero);
        expect(adapterDaiBalance).to.be.eq(Zero);
        expect(userDaiStableDebtAmountBefore).to.be.gte(expectedDaiAmount);
        expect(userDaiStableDebtAmount).to.be.lt(expectedDaiAmount);
        expect(userAEthBalance).to.be.lt(userAEthBalanceBefore);
        expect(userAEthBalance).to.be.gte(
          userAEthBalanceBefore.sub(liquidityToSwap.add(callerFee))
        );
        expect(callerAEthBalance).to.be.eq(callerFee);
      });

      it('should correctly swap tokens and repay debt with permit', async () => {
        const { users, pool, weth, aWETH, oracle, dai, autoRepay, helpersContract } = testEnv;
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
        const daiStableDebtTokenAddress = (
          await helpersContract.getReserveTokensAddresses(dai.address)
        ).stableDebtTokenAddress;
        const daiStableDebtContract = await getContract<StableDebtToken>(
          eContractid.StableDebtToken,
          daiStableDebtTokenAddress
        );
        const userDaiStableDebtAmountBefore = await daiStableDebtContract.balanceOf(userAddress);
        const liquidityToSwap = amountWETHtoSwap;
        const userAEthBalanceBefore = await aWETH.balanceOf(userAddress);
        const callerFee = liquidityToSwap
          .mul(await autoRepay.FEE())
          .div(await autoRepay.HUNDRED_PERCENT());
        await autoRepay.whitelistAddress(callerAddress);
        const userData = await pool.getUserAccountData(userAddress);
        await autoRepay
          .connect(user)
          .setMinMaxHealthFactor(userData.healthFactor.add('1'), MAX_UINT_AMOUNT);
        const chainId = DRE.network.config.chainId || BUIDLEREVM_CHAINID;
        const deadline = MAX_UINT_AMOUNT;
        const nonce = (await aWETH._nonces(userAddress)).toNumber();
        const msgParams = buildPermitParams(
          chainId,
          aWETH.address,
          '1',
          await aWETH.name(),
          userAddress,
          autoRepay.address,
          nonce,
          deadline,
          liquidityToSwap.add(callerFee).toString()
        );
        const ownerPrivateKey = require('../../test-wallets.js').accounts[1].secretKey;
        if (!ownerPrivateKey) {
          throw new Error('INVALID_OWNER_PK');
        }
        const { v, r, s } = getSignatureFromTypedData(ownerPrivateKey, msgParams);
        await mockUniswapRouter.connect(user).setAmountToSwap(weth.address, liquidityToSwap);
        const flashLoanDebt = new BigNumber(expectedDaiAmount.toString())
          .multipliedBy(1.0001)
          .toFixed(0);
        await mockUniswapRouter.setAmountIn(
          flashLoanDebt,
          weth.address,
          dai.address,
          liquidityToSwap
        );
        await mockUniswapRouter.setAmountIn(
          flashLoanDebt,
          weth.address,
          dai.address,
          liquidityToSwap
        );
        await expect(
          autoRepay.connect(caller).increaseHealthFactor(
            {
              user: userAddress,
              collateralAsset: weth.address,
              debtAsset: dai.address,
              collateralAmount: liquidityToSwap,
              debtRepayAmount: expectedDaiAmount,
              rateMode: 1,
              path: [weth.address, dai.address],
              useATokenAsFrom: false,
              useATokenAsTo: false,
              useFlashloan: true,
            },
            {
              amount: liquidityToSwap.add(callerFee).toString(),
              deadline: deadline,
              v: v,
              r: r,
              s: s,
            }
          )
        )
          .to.emit(autoRepay, 'Swapped')
          .withArgs(weth.address, dai.address, liquidityToSwap.toString(), flashLoanDebt);
        const adapterWethBalance = await weth.balanceOf(autoRepay.address);
        const adapterDaiBalance = await dai.balanceOf(autoRepay.address);
        const userDaiStableDebtAmount = await daiStableDebtContract.balanceOf(userAddress);
        const userAEthBalance = await aWETH.balanceOf(userAddress);
        const callerAEthBalance = await aWETH.balanceOf(callerAddress);
        expect(adapterWethBalance).to.be.eq(Zero);
        expect(adapterDaiBalance).to.be.eq(Zero);
        expect(userDaiStableDebtAmountBefore).to.be.gte(expectedDaiAmount);
        expect(userDaiStableDebtAmount).to.be.lt(expectedDaiAmount);
        expect(userAEthBalance).to.be.lt(userAEthBalanceBefore);
        expect(userAEthBalance).to.be.gte(
          userAEthBalanceBefore.sub(liquidityToSwap.add(callerFee))
        );
        expect(callerAEthBalance).to.be.eq(callerFee);
      });

      it('should revert if caller is not whitelisted', async () => {
        const { users, pool, weth, aWETH, oracle, dai, autoRepay } = testEnv;
        const user = users[0].signer;
        const userAddress = users[0].address;
        const caller = users[1].signer;
        const amountWETHtoSwap = await convertToCurrencyDecimals(weth.address, '10');
        const daiPrice = await oracle.getAssetPrice(dai.address);
        const expectedDaiAmount = await convertToCurrencyDecimals(
          dai.address,
          new BigNumber(amountWETHtoSwap.toString()).div(daiPrice.toString()).toFixed(0)
        );
        // Open user Debt
        await pool.connect(user).borrow(dai.address, expectedDaiAmount, 1, 0, userAddress);
        const liquidityToSwap = amountWETHtoSwap;
        const callerFee = liquidityToSwap
          .mul(await autoRepay.FEE())
          .div(await autoRepay.HUNDRED_PERCENT());
        const userData = await pool.getUserAccountData(userAddress);
        await autoRepay
          .connect(user)
          .setMinMaxHealthFactor(userData.healthFactor.add('1'), MAX_UINT_AMOUNT);
        await aWETH.connect(user).approve(autoRepay.address, liquidityToSwap.add(callerFee));
        await mockUniswapRouter.connect(user).setAmountToSwap(weth.address, liquidityToSwap);
        const flashLoanDebt = new BigNumber(expectedDaiAmount.toString())
          .multipliedBy(1.0001)
          .toFixed(0);
        await mockUniswapRouter.setAmountIn(
          flashLoanDebt,
          weth.address,
          dai.address,
          liquidityToSwap
        );
        await expect(
          autoRepay.connect(caller).increaseHealthFactor(
            {
              user: userAddress,
              collateralAsset: weth.address,
              debtAsset: dai.address,
              collateralAmount: liquidityToSwap,
              debtRepayAmount: expectedDaiAmount,
              rateMode: 1,
              path: [weth.address, dai.address],
              useATokenAsFrom: false,
              useATokenAsTo: false,
              useFlashloan: true,
            },
            zeroPermitSignature
          )
        ).to.be.revertedWith('Caller is not whitelisted');
      });

      it('should revert if user health factor is more or equal than minHealthFactor', async () => {
        const { users, pool, weth, aWETH, oracle, dai, autoRepay } = testEnv;
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
        const liquidityToSwap = amountWETHtoSwap;
        const callerFee = liquidityToSwap
          .mul(await autoRepay.FEE())
          .div(await autoRepay.HUNDRED_PERCENT());
        await autoRepay.whitelistAddress(callerAddress);
        const userData = await pool.getUserAccountData(userAddress);
        await autoRepay
          .connect(user)
          .setMinMaxHealthFactor(
            userData.healthFactor.sub(userData.healthFactor.div(10)),
            MAX_UINT_AMOUNT
          );

        await aWETH.connect(user).approve(autoRepay.address, liquidityToSwap.add(callerFee));
        await mockUniswapRouter.connect(user).setAmountToSwap(weth.address, liquidityToSwap);
        const flashLoanDebt = new BigNumber(expectedDaiAmount.toString())
          .multipliedBy(1.0001)
          .toFixed(0);
        await mockUniswapRouter.setAmountIn(
          flashLoanDebt,
          weth.address,
          dai.address,
          liquidityToSwap
        );
        await expect(
          autoRepay.connect(caller).increaseHealthFactor(
            {
              user: userAddress,
              collateralAsset: weth.address,
              debtAsset: dai.address,
              collateralAmount: liquidityToSwap,
              debtRepayAmount: expectedDaiAmount,
              rateMode: 1,
              path: [weth.address, dai.address],
              useATokenAsFrom: false,
              useATokenAsTo: false,
              useFlashloan: true,
            },
            zeroPermitSignature
          )
        ).to.be.revertedWith('User health factor must be less than minHealthFactor for user');
      });

      it(
        'should revert if after repay user health factor ' + 'is more  than maxHealthFactor',
        async () => {
          const { users, pool, weth, aWETH, oracle, dai, autoRepay } = testEnv;
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
          const liquidityToSwap = amountWETHtoSwap;
          const callerFee = liquidityToSwap
            .mul(await autoRepay.FEE())
            .div(await autoRepay.HUNDRED_PERCENT());
          await autoRepay.whitelistAddress(callerAddress);
          const userData = await pool.getUserAccountData(userAddress);
          await autoRepay
            .connect(user)
            .setMinMaxHealthFactor(userData.healthFactor.add(1), userData.healthFactor.add(100));
          await aWETH.connect(user).approve(autoRepay.address, liquidityToSwap.add(callerFee));
          await mockUniswapRouter.connect(user).setAmountToSwap(weth.address, liquidityToSwap);
          const flashLoanDebt = new BigNumber(expectedDaiAmount.toString())
            .multipliedBy(1.0001)
            .toFixed(0);
          await mockUniswapRouter.setAmountIn(
            flashLoanDebt,
            weth.address,
            dai.address,
            liquidityToSwap
          );
          await expect(
            autoRepay.connect(caller).increaseHealthFactor(
              {
                user: userAddress,
                collateralAsset: weth.address,
                debtAsset: dai.address,
                collateralAmount: liquidityToSwap,
                debtRepayAmount: expectedDaiAmount,
                rateMode: 1,
                path: [weth.address, dai.address],
                useATokenAsFrom: false,
                useATokenAsTo: false,
                useFlashloan: true,
              },
              zeroPermitSignature
            )
          ).to.be.revertedWith('User health factor was not increased or more than maxHealthFactor');
        }
      );

      it('should revert if caller not lending pool', async () => {
        const { users, pool, weth, aWETH, oracle, dai, autoRepay } = testEnv;
        const user = users[0].signer;
        const userAddress = users[0].address;
        const amountWETHtoSwap = await convertToCurrencyDecimals(weth.address, '10');
        const daiPrice = await oracle.getAssetPrice(dai.address);
        const expectedDaiAmount = await convertToCurrencyDecimals(
          dai.address,
          new BigNumber(amountWETHtoSwap.toString()).div(daiPrice.toString()).toFixed(0)
        );
        // Open user Debt
        await pool.connect(user).borrow(dai.address, expectedDaiAmount, 1, 0, userAddress);
        const liquidityToSwap = amountWETHtoSwap;
        await aWETH.connect(user).approve(autoRepay.address, liquidityToSwap);
        await mockUniswapRouter.connect(user).setAmountToSwap(weth.address, liquidityToSwap);
        await expect(
          autoRepay
            .connect(user)
            .executeOperation(
              [dai.address],
              [expectedDaiAmount.toString()],
              [0],
              userAddress,
              '0x00'
            )
        ).to.be.revertedWith('CALLER_MUST_BE_LENDING_POOL');
      });

      it('should revert if initiator is not contract address', async () => {
        const { users, pool, weth, oracle, dai, autoRepay, aWETH } = testEnv;
        const user = users[0].signer;
        const userAddress = users[0].address;
        const amountWETHtoSwap = await convertToCurrencyDecimals(weth.address, '10');
        await weth.connect(user).mint(amountWETHtoSwap);
        await weth.connect(user).transfer(autoRepay.address, amountWETHtoSwap);
        const daiPrice = await oracle.getAssetPrice(dai.address);
        const expectedDaiAmount = await convertToCurrencyDecimals(
          dai.address,
          new BigNumber(amountWETHtoSwap.toString()).div(daiPrice.toString()).toFixed(0)
        );
        // Open user Debt
        await pool.connect(user).borrow(dai.address, expectedDaiAmount, 2, 0, userAddress);
        const liquidityToSwap = amountWETHtoSwap;
        await aWETH.connect(user).approve(autoRepay.address, liquidityToSwap);
        await mockUniswapRouter.connect(user).setAmountToSwap(weth.address, liquidityToSwap);
        const params = buildRepayAdapterParams(
          weth.address,
          liquidityToSwap,
          1,
          0,
          0,
          0,
          '0x0000000000000000000000000000000000000000000000000000000000000000',
          '0x0000000000000000000000000000000000000000000000000000000000000000',
          false,
          false,
          false
        );
        await expect(
          pool
            .connect(user)
            .flashLoan(
              autoRepay.address,
              [dai.address],
              [expectedDaiAmount.toString()],
              [0],
              userAddress,
              params,
              0
            )
        ).to.be.revertedWith('Only this contract can call flashloan');
      });

      it('should revert if there is not debt to repay with the specified rate mode', async () => {
        const { users, pool, weth, aWETH, oracle, dai, autoRepay, helpersContract } = testEnv;
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
        await pool.connect(user).borrow(dai.address, expectedDaiAmount, 2, 0, userAddress);
        const liquidityToSwap = amountWETHtoSwap;
        const callerFee = liquidityToSwap
          .mul(await autoRepay.FEE())
          .div(await autoRepay.HUNDRED_PERCENT());
        await autoRepay.whitelistAddress(callerAddress);
        const userData = await pool.getUserAccountData(userAddress);
        await autoRepay
          .connect(user)
          .setMinMaxHealthFactor(userData.healthFactor.add('1'), MAX_UINT_AMOUNT);
        await aWETH.connect(user).approve(autoRepay.address, liquidityToSwap.add(callerFee));
        await mockUniswapRouter.connect(user).setAmountToSwap(weth.address, liquidityToSwap);
        const flashLoanDebt = new BigNumber(expectedDaiAmount.toString())
          .multipliedBy(1.0001)
          .toFixed(0);
        await mockUniswapRouter.setAmountIn(
          flashLoanDebt,
          weth.address,
          dai.address,
          liquidityToSwap
        );
        await expect(
          autoRepay.connect(caller).increaseHealthFactor(
            {
              user: userAddress,
              collateralAsset: weth.address,
              debtAsset: dai.address,
              collateralAmount: liquidityToSwap,
              debtRepayAmount: expectedDaiAmount,
              rateMode: 1,
              path: [weth.address, dai.address],
              useATokenAsFrom: false,
              useATokenAsTo: false,
              useFlashloan: true,
            },
            zeroPermitSignature
          )
        ).to.be.reverted;
      });

      it('should revert if there is not debt to repay', async () => {
        const { users, weth, oracle, dai, autoRepay, aWETH, usdc, pool } = testEnv;
        const user = users[0].signer;
        const userAddress = users[0].address;
        const caller = users[1].signer;
        const callerAddress = users[1].address;
        const amountWETHtoSwap = await convertToCurrencyDecimals(weth.address, '10');

        // borrow another token
        await pool.connect(user).borrow(weth.address, '1000000', 2, 0, userAddress);

        await weth.connect(user).mint(amountWETHtoSwap);
        await weth.connect(user).transfer(autoRepay.address, amountWETHtoSwap);
        const daiPrice = await oracle.getAssetPrice(dai.address);
        const expectedDaiAmount = await convertToCurrencyDecimals(
          dai.address,
          new BigNumber(amountWETHtoSwap.toString()).div(daiPrice.toString()).toFixed(0)
        );
        const liquidityToSwap = amountWETHtoSwap;
        const callerFee = liquidityToSwap
          .mul(await autoRepay.FEE())
          .div(await autoRepay.HUNDRED_PERCENT());
        await autoRepay.whitelistAddress(callerAddress);
        const userData = await pool.getUserAccountData(userAddress);
        await autoRepay
          .connect(user)
          .setMinMaxHealthFactor(userData.healthFactor.add('1'), MAX_UINT_AMOUNT);
        await aWETH.connect(user).approve(autoRepay.address, liquidityToSwap.add(callerFee));
        await mockUniswapRouter.connect(user).setAmountToSwap(weth.address, liquidityToSwap);

        await expect(
          autoRepay.connect(caller).increaseHealthFactor(
            {
              user: userAddress,
              collateralAsset: weth.address,
              debtAsset: dai.address,
              collateralAmount: liquidityToSwap,
              debtRepayAmount: expectedDaiAmount,
              rateMode: 2,
              path: [weth.address, dai.address],
              useATokenAsFrom: false,
              useATokenAsTo: false,
              useFlashloan: true,
            },
            zeroPermitSignature
          )
        ).to.be.reverted;
      });

      it('should revert when max amount allowed to swap is bigger than max slippage', async () => {
        const { users, pool, weth, oracle, dai, aWETH, autoRepay } = testEnv;
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
        const bigMaxAmountToSwap = amountWETHtoSwap.mul(2);
        const callerFee = bigMaxAmountToSwap
          .mul(await autoRepay.FEE())
          .div(await autoRepay.HUNDRED_PERCENT());
        await autoRepay.whitelistAddress(callerAddress);
        const userData = await pool.getUserAccountData(userAddress);
        await autoRepay
          .connect(user)
          .setMinMaxHealthFactor(userData.healthFactor.add('1'), MAX_UINT_AMOUNT);
        await aWETH.connect(user).approve(autoRepay.address, bigMaxAmountToSwap.add(callerFee));
        await mockUniswapRouter.connect(user).setAmountToSwap(weth.address, bigMaxAmountToSwap);
        const flashLoanDebt = new BigNumber(expectedDaiAmount.toString())
          .multipliedBy(1.0001)
          .toFixed(0);
        await mockUniswapRouter.setAmountIn(
          flashLoanDebt,
          weth.address,
          dai.address,
          bigMaxAmountToSwap
        );
        await expect(
          autoRepay.connect(caller).increaseHealthFactor(
            {
              user: userAddress,
              collateralAsset: weth.address,
              debtAsset: dai.address,
              collateralAmount: bigMaxAmountToSwap,
              debtRepayAmount: expectedDaiAmount,
              rateMode: 1,
              path: [weth.address, dai.address],
              useATokenAsFrom: false,
              useATokenAsTo: false,
              useFlashloan: true,
            },
            zeroPermitSignature
          )
        ).to.be.revertedWith('maxAmountToSwap exceed max slippage');
      });

      it('should swap, repay debt and pull the needed ATokens leaving no leftovers', async () => {
        const { users, pool, weth, aWETH, oracle, dai, autoRepay, helpersContract } = testEnv;
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
        const daiStableDebtTokenAddress = (
          await helpersContract.getReserveTokensAddresses(dai.address)
        ).stableDebtTokenAddress;
        const daiStableDebtContract = await getContract<StableDebtToken>(
          eContractid.StableDebtToken,
          daiStableDebtTokenAddress
        );
        const userDaiStableDebtAmountBefore = await daiStableDebtContract.balanceOf(userAddress);
        const liquidityToSwap = amountWETHtoSwap;
        const callerFee = liquidityToSwap
          .mul(await autoRepay.FEE())
          .div(await autoRepay.HUNDRED_PERCENT());
        await autoRepay.whitelistAddress(callerAddress);
        const userData = await pool.getUserAccountData(userAddress);
        await autoRepay
          .connect(user)
          .setMinMaxHealthFactor(userData.healthFactor.add('1'), MAX_UINT_AMOUNT);
        await aWETH.connect(user).approve(autoRepay.address, liquidityToSwap.add(callerFee));
        const userAEthBalanceBefore = await aWETH.balanceOf(userAddress);
        const userWethBalanceBefore = await weth.balanceOf(userAddress);
        const actualWEthSwapped = new BigNumber(liquidityToSwap.toString())
          .multipliedBy(0.995)
          .toFixed(0);
        const actualCallerFee = ethers.BigNumber.from(actualWEthSwapped)
          .mul(await autoRepay.FEE())
          .div(await autoRepay.HUNDRED_PERCENT());
        await mockUniswapRouter.connect(user).setAmountToSwap(weth.address, actualWEthSwapped);
        const flashLoanDebt = new BigNumber(expectedDaiAmount.toString())
          .multipliedBy(1.0001)
          .toFixed(0);
        await mockUniswapRouter.setAmountIn(
          flashLoanDebt,
          weth.address,
          dai.address,
          actualWEthSwapped
        );

        await expect(
          autoRepay.connect(caller).increaseHealthFactor(
            {
              user: userAddress,
              collateralAsset: weth.address,
              debtAsset: dai.address,
              collateralAmount: liquidityToSwap,
              debtRepayAmount: expectedDaiAmount,
              rateMode: 1,
              path: [weth.address, dai.address],
              useATokenAsFrom: false,
              useATokenAsTo: false,
              useFlashloan: true,
            },
            zeroPermitSignature
          )
        )
          .to.emit(autoRepay, 'Swapped')
          .withArgs(weth.address, dai.address, actualWEthSwapped.toString(), flashLoanDebt);
        const adapterWethBalance = await weth.balanceOf(autoRepay.address);
        const adapterDaiBalance = await dai.balanceOf(autoRepay.address);
        const userDaiStableDebtAmount = await daiStableDebtContract.balanceOf(userAddress);
        const userAEthBalance = await aWETH.balanceOf(userAddress);
        const adapterAEthBalance = await aWETH.balanceOf(autoRepay.address);
        const userWethBalance = await weth.balanceOf(userAddress);
        const callerAEthBalance = await aWETH.balanceOf(callerAddress);
        expect(adapterAEthBalance).to.be.eq(Zero);
        expect(adapterWethBalance).to.be.eq(Zero);
        expect(adapterDaiBalance).to.be.eq(Zero);
        expect(userDaiStableDebtAmountBefore).to.be.gte(expectedDaiAmount);
        expect(userDaiStableDebtAmount).to.be.lt(expectedDaiAmount);
        expect(userAEthBalance).to.be.lt(userAEthBalanceBefore);
        expect(userAEthBalance).to.be.eq(
          userAEthBalanceBefore.sub(actualCallerFee.add(actualWEthSwapped))
        );
        expect(userWethBalance).to.be.eq(userWethBalanceBefore);
        expect(callerAEthBalance).to.be.eq(actualCallerFee);
      });

      it('should correctly swap tokens and repay the whole stable debt', async () => {
        const { users, pool, weth, aWETH, oracle, dai, autoRepay, helpersContract } = testEnv;
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
        const daiStableDebtTokenAddress = (
          await helpersContract.getReserveTokensAddresses(dai.address)
        ).stableDebtTokenAddress;
        const daiStableDebtContract = await getContract<StableDebtToken>(
          eContractid.StableDebtToken,
          daiStableDebtTokenAddress
        );
        const userDaiStableDebtAmountBefore = await daiStableDebtContract.balanceOf(userAddress);
        // Add a % to repay on top of the debt
        const liquidityToSwap = ethers.BigNumber.from(
          new BigNumber(amountWETHtoSwap.toString()).multipliedBy(2).toFixed(0)
        );
        const callerFee = liquidityToSwap
          .mul(await autoRepay.FEE())
          .div(await autoRepay.HUNDRED_PERCENT());
        await autoRepay.whitelistAddress(callerAddress);
        const userData = await pool.getUserAccountData(userAddress);
        await autoRepay
          .connect(user)
          .setMinMaxHealthFactor(userData.healthFactor.add('1'), MAX_UINT_AMOUNT);
        await aWETH.connect(user).approve(autoRepay.address, liquidityToSwap.add(callerFee));
        const userAEthBalanceBefore = await aWETH.balanceOf(userAddress);
        // Add a % to repay on top of the debt
        const amountToRepay = new BigNumber(expectedDaiAmount.toString())
          .multipliedBy(2)
          .toFixed(0);
        await mockUniswapRouter.connect(user).setAmountToSwap(weth.address, amountWETHtoSwap);
        await mockUniswapRouter.setDefaultMockValue(amountWETHtoSwap);
        const actualCallerFee = amountWETHtoSwap
          .mul(await autoRepay.FEE())
          .div(await autoRepay.HUNDRED_PERCENT());
        await autoRepay.connect(caller).increaseHealthFactor(
          {
            user: userAddress,
            collateralAsset: weth.address,
            debtAsset: dai.address,
            collateralAmount: liquidityToSwap,
            debtRepayAmount: amountToRepay,
            rateMode: 1,
            path: [weth.address, dai.address],
            useATokenAsFrom: false,
            useATokenAsTo: false,
            useFlashloan: true,
          },
          zeroPermitSignature
        );
        const adapterWethBalance = await weth.balanceOf(autoRepay.address);
        const adapterDaiBalance = await dai.balanceOf(autoRepay.address);
        const userDaiStableDebtAmount = await daiStableDebtContract.balanceOf(userAddress);
        const userAEthBalance = await aWETH.balanceOf(userAddress);
        const adapterAEthBalance = await aWETH.balanceOf(autoRepay.address);
        const callerAEthBalance = await aWETH.balanceOf(callerAddress);
        expect(adapterAEthBalance).to.be.eq(Zero);
        expect(adapterWethBalance).to.be.eq(Zero);
        expect(adapterDaiBalance).to.be.eq(Zero);
        expect(userDaiStableDebtAmountBefore).to.be.gte(expectedDaiAmount);
        expect(userDaiStableDebtAmount).to.be.eq(Zero);
        expect(userAEthBalance).to.be.lt(userAEthBalanceBefore);
        expect(userAEthBalance).to.be.gte(userAEthBalanceBefore.sub(liquidityToSwap));
        expect(callerAEthBalance).to.be.eq(actualCallerFee);
      });

      it('should correctly swap tokens and repay the whole variable debt', async () => {
        const { users, pool, weth, aWETH, oracle, dai, autoRepay, helpersContract } = testEnv;
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
        await pool.connect(user).borrow(dai.address, expectedDaiAmount, 2, 0, userAddress);
        const daiStableVariableTokenAddress = (
          await helpersContract.getReserveTokensAddresses(dai.address)
        ).variableDebtTokenAddress;
        const daiVariableDebtContract = await getContract<StableDebtToken>(
          eContractid.VariableDebtToken,
          daiStableVariableTokenAddress
        );
        const userDaiVariableDebtAmountBefore = await daiVariableDebtContract.balanceOf(
          userAddress
        );
        // Add a % to repay on top of the debt
        const liquidityToSwap = ethers.BigNumber.from(
          new BigNumber(amountWETHtoSwap.toString()).multipliedBy(2).toFixed(0)
        );
        const callerFee = liquidityToSwap
          .mul(await autoRepay.FEE())
          .div(await autoRepay.HUNDRED_PERCENT());
        await autoRepay.whitelistAddress(callerAddress);
        const userData = await pool.getUserAccountData(userAddress);
        await autoRepay
          .connect(user)
          .setMinMaxHealthFactor(userData.healthFactor.add('1'), MAX_UINT_AMOUNT);
        await aWETH.connect(user).approve(autoRepay.address, liquidityToSwap.add(callerFee));
        const userAEthBalanceBefore = await aWETH.balanceOf(userAddress);
        // Add a % to repay on top of the debt
        const amountToRepay = new BigNumber(expectedDaiAmount.toString())
          .multipliedBy(2)
          .toFixed(0);
        await mockUniswapRouter.connect(user).setAmountToSwap(weth.address, amountWETHtoSwap);
        await mockUniswapRouter.setDefaultMockValue(amountWETHtoSwap);
        const actualCallerFee = amountWETHtoSwap
          .mul(await autoRepay.FEE())
          .div(await autoRepay.HUNDRED_PERCENT());
        await autoRepay.connect(caller).increaseHealthFactor(
          {
            user: userAddress,
            collateralAsset: weth.address,
            debtAsset: dai.address,
            collateralAmount: liquidityToSwap,
            debtRepayAmount: amountToRepay,
            rateMode: 2,
            path: [weth.address, dai.address],
            useATokenAsFrom: false,
            useATokenAsTo: false,
            useFlashloan: true,
          },
          zeroPermitSignature
        );
        const adapterWethBalance = await weth.balanceOf(autoRepay.address);
        const adapterDaiBalance = await dai.balanceOf(autoRepay.address);
        const userDaiVariableDebtAmount = await daiVariableDebtContract.balanceOf(userAddress);
        const userAEthBalance = await aWETH.balanceOf(userAddress);
        const adapterAEthBalance = await aWETH.balanceOf(autoRepay.address);
        const callerAEthBalance = await aWETH.balanceOf(callerAddress);
        expect(adapterAEthBalance).to.be.eq(Zero);
        expect(adapterWethBalance).to.be.eq(Zero);
        expect(adapterDaiBalance).to.be.eq(Zero);
        expect(userDaiVariableDebtAmountBefore).to.be.gte(expectedDaiAmount);
        expect(userDaiVariableDebtAmount).to.be.eq(Zero);
        expect(userAEthBalance).to.be.lt(userAEthBalanceBefore);
        expect(userAEthBalance).to.be.gte(userAEthBalanceBefore.sub(liquidityToSwap));
        expect(callerAEthBalance).to.be.eq(actualCallerFee);
      });

      it(
        'should correctly repay debt via flash ' + 'loan using the same asset as collateral',
        async () => {
          const { users, pool, aDai, dai, autoRepay, helpersContract } = testEnv;
          const user = users[0].signer;
          const userAddress = users[0].address;
          const caller = users[1].signer;
          const callerAddress = users[1].address;
          // Add deposit for user
          await dai.mint(parseEther('30'));
          await dai.approve(pool.address, parseEther('30'));
          await pool.deposit(dai.address, parseEther('30'), userAddress, 0);
          const amountCollateralToSwap = parseEther('10');
          const debtAmount = parseEther('10');
          // Open user Debt
          await pool.connect(user).borrow(dai.address, debtAmount, 2, 0, userAddress);
          const daiVariableDebtTokenAddress = (
            await helpersContract.getReserveTokensAddresses(dai.address)
          ).variableDebtTokenAddress;
          const daiVariableDebtContract = await getContract<VariableDebtToken>(
            eContractid.VariableDebtToken,
            daiVariableDebtTokenAddress
          );
          const userDaiVariableDebtAmountBefore = await daiVariableDebtContract.balanceOf(
            userAddress
          );
          const callerFee = amountCollateralToSwap
            .mul(await autoRepay.FEE())
            .div(await autoRepay.HUNDRED_PERCENT());
          await autoRepay.whitelistAddress(callerAddress);
          const userData = await pool.getUserAccountData(userAddress);
          await autoRepay
            .connect(user)
            .setMinMaxHealthFactor(userData.healthFactor.add('1'), MAX_UINT_AMOUNT);
          const flashLoanDebt = new BigNumber(amountCollateralToSwap.toString())
            .multipliedBy(1.0001)
            .toFixed(0);
          await aDai
            .connect(user)
            .approve(autoRepay.address, ethers.BigNumber.from(flashLoanDebt).add(callerFee));
          const userADaiBalanceBefore = await aDai.balanceOf(userAddress);
          const userDaiBalanceBefore = await dai.balanceOf(userAddress);
          await autoRepay.connect(caller).increaseHealthFactor(
            {
              user: userAddress,
              collateralAsset: dai.address,
              debtAsset: dai.address,
              collateralAmount: amountCollateralToSwap,
              debtRepayAmount: amountCollateralToSwap,
              rateMode: 2,
              path: [dai.address, dai.address],
              useATokenAsFrom: false,
              useATokenAsTo: false,
              useFlashloan: true,
            },
            zeroPermitSignature
          );
          const adapterDaiBalance = await dai.balanceOf(autoRepay.address);
          const userDaiVariableDebtAmount = await daiVariableDebtContract.balanceOf(userAddress);
          const userADaiBalance = await aDai.balanceOf(userAddress);
          const adapterADaiBalance = await aDai.balanceOf(autoRepay.address);
          const userDaiBalance = await dai.balanceOf(userAddress);
          expect(adapterADaiBalance).to.be.eq(Zero, 'adapter aDAI balance should be zero');
          expect(adapterDaiBalance).to.be.eq(Zero, 'adapter DAI balance should be zero');
          expect(userDaiVariableDebtAmountBefore).to.be.gte(
            debtAmount,
            'user DAI variable debt before should be gte debtAmount'
          );
          expect(userDaiVariableDebtAmount).to.be.lt(
            debtAmount,
            'user dai variable debt amount should be lt debt amount'
          );
          expect(userADaiBalance).to.be.lt(
            userADaiBalanceBefore,
            'user aDAI balance should be lt aDAI prior balance'
          );
          expect(userADaiBalance).to.be.gte(
            userADaiBalanceBefore.sub(flashLoanDebt).sub(callerFee),
            'user aDAI balance should be gte aDAI prior balance sub flash loan debt'
          );
          expect(userDaiBalance).to.be.eq(
            userDaiBalanceBefore,
            'user dai balance eq prior balance'
          );
        }
      );
    });
    describe('swapAndRepay', () => {
      it('should correctly swap tokens and repay debt', async () => {
        const { users, pool, weth, aWETH, oracle, dai, autoRepay, helpersContract } = testEnv;
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
        const daiStableDebtTokenAddress = (
          await helpersContract.getReserveTokensAddresses(dai.address)
        ).stableDebtTokenAddress;
        const daiStableDebtContract = await getContract<StableDebtToken>(
          eContractid.StableDebtToken,
          daiStableDebtTokenAddress
        );
        const userDaiStableDebtAmountBefore = await daiStableDebtContract.balanceOf(userAddress);
        const liquidityToSwap = amountWETHtoSwap;
        const callerFee = liquidityToSwap
          .mul(await autoRepay.FEE())
          .div(await autoRepay.HUNDRED_PERCENT());
        await autoRepay.whitelistAddress(callerAddress);
        const userData = await pool.getUserAccountData(userAddress);
        await autoRepay
          .connect(user)
          .setMinMaxHealthFactor(userData.healthFactor.add('1'), MAX_UINT_AMOUNT);
        await aWETH.connect(user).approve(autoRepay.address, liquidityToSwap.add(callerFee));
        const userAEthBalanceBefore = await aWETH.balanceOf(userAddress);
        await mockUniswapRouter.setAmountToSwap(weth.address, liquidityToSwap);
        await mockUniswapRouter.setDefaultMockValue(liquidityToSwap);
        await autoRepay.connect(caller).increaseHealthFactor(
          {
            user: userAddress,
            collateralAsset: weth.address,
            debtAsset: dai.address,
            collateralAmount: liquidityToSwap,
            debtRepayAmount: expectedDaiAmount,
            rateMode: 1,
            path: [weth.address, dai.address],
            useATokenAsFrom: false,
            useATokenAsTo: false,
            useFlashloan: false,
          },
          zeroPermitSignature
        );
        const adapterWethBalance = await weth.balanceOf(autoRepay.address);
        const adapterDaiBalance = await dai.balanceOf(autoRepay.address);
        const userDaiStableDebtAmount = await daiStableDebtContract.balanceOf(userAddress);
        const userAEthBalance = await aWETH.balanceOf(userAddress);
        const callerAEthBalance = await aWETH.balanceOf(callerAddress);
        expect(adapterWethBalance).to.be.eq(Zero);
        expect(adapterDaiBalance).to.be.eq(Zero);
        expect(userDaiStableDebtAmountBefore).to.be.gte(expectedDaiAmount);
        expect(userDaiStableDebtAmount).to.be.lt(expectedDaiAmount);
        expect(userAEthBalance).to.be.lt(userAEthBalanceBefore);
        expect(userAEthBalance).to.be.gte(
          userAEthBalanceBefore.sub(liquidityToSwap.add(callerFee))
        );
        expect(callerAEthBalance).to.be.eq(callerFee);
      });

      it('should correctly swap tokens and repay debt with permit', async () => {
        const { users, pool, weth, aWETH, oracle, dai, autoRepay, helpersContract } = testEnv;
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
        const daiStableDebtTokenAddress = (
          await helpersContract.getReserveTokensAddresses(dai.address)
        ).stableDebtTokenAddress;
        const daiStableDebtContract = await getContract<StableDebtToken>(
          eContractid.StableDebtToken,
          daiStableDebtTokenAddress
        );
        const userDaiStableDebtAmountBefore = await daiStableDebtContract.balanceOf(userAddress);
        const liquidityToSwap = amountWETHtoSwap;
        const userAEthBalanceBefore = await aWETH.balanceOf(userAddress);
        await mockUniswapRouter.setAmountToSwap(weth.address, liquidityToSwap);

        await mockUniswapRouter.setDefaultMockValue(liquidityToSwap);
        const callerFee = liquidityToSwap
          .mul(await autoRepay.FEE())
          .div(await autoRepay.HUNDRED_PERCENT());
        await autoRepay.whitelistAddress(callerAddress);
        const userData = await pool.getUserAccountData(userAddress);
        await autoRepay
          .connect(user)
          .setMinMaxHealthFactor(userData.healthFactor.add('1'), MAX_UINT_AMOUNT);
        const chainId = DRE.network.config.chainId || BUIDLEREVM_CHAINID;
        const deadline = MAX_UINT_AMOUNT;
        const nonce = (await aWETH._nonces(userAddress)).toNumber();
        const msgParams = buildPermitParams(
          chainId,
          aWETH.address,
          '1',
          await aWETH.name(),
          userAddress,
          autoRepay.address,
          nonce,
          deadline,
          liquidityToSwap.add(callerFee).toString()
        );
        const ownerPrivateKey = require('../../test-wallets.js').accounts[1].secretKey;
        if (!ownerPrivateKey) {
          throw new Error('INVALID_OWNER_PK');
        }
        const { v, r, s } = getSignatureFromTypedData(ownerPrivateKey, msgParams);
        await autoRepay.connect(caller).increaseHealthFactor(
          {
            user: userAddress,
            collateralAsset: weth.address,
            debtAsset: dai.address,
            collateralAmount: liquidityToSwap,
            debtRepayAmount: expectedDaiAmount,
            rateMode: 1,
            path: [weth.address, dai.address],
            useATokenAsFrom: false,
            useATokenAsTo: false,
            useFlashloan: false,
          },
          {
            amount: liquidityToSwap.add(callerFee).toString(),
            deadline: deadline,
            v: v,
            r: r,
            s: s,
          }
        );
        const adapterWethBalance = await weth.balanceOf(autoRepay.address);
        const adapterDaiBalance = await dai.balanceOf(autoRepay.address);
        const userDaiStableDebtAmount = await daiStableDebtContract.balanceOf(userAddress);
        const userAEthBalance = await aWETH.balanceOf(userAddress);
        const callerAEthBalance = await aWETH.balanceOf(callerAddress);
        expect(adapterWethBalance).to.be.eq(Zero);
        expect(adapterDaiBalance).to.be.eq(Zero);
        expect(userDaiStableDebtAmountBefore).to.be.gte(expectedDaiAmount);
        expect(userDaiStableDebtAmount).to.be.lt(expectedDaiAmount);
        expect(userAEthBalance).to.be.lt(userAEthBalanceBefore);
        expect(userAEthBalance).to.be.gte(
          userAEthBalanceBefore.sub(liquidityToSwap.add(callerFee))
        );
        expect(callerAEthBalance).to.be.eq(callerFee);
      });

      it('should revert if caller is not whitelisted', async () => {
        const { users, pool, weth, aWETH, oracle, dai, autoRepay } = testEnv;
        const user = users[0].signer;
        const userAddress = users[0].address;
        const caller = users[1].signer;
        const amountWETHtoSwap = await convertToCurrencyDecimals(weth.address, '10');
        const daiPrice = await oracle.getAssetPrice(dai.address);
        const expectedDaiAmount = await convertToCurrencyDecimals(
          dai.address,
          new BigNumber(amountWETHtoSwap.toString()).div(daiPrice.toString()).toFixed(0)
        );
        // Open user Debt
        await pool.connect(user).borrow(dai.address, expectedDaiAmount, 1, 0, userAddress);
        const liquidityToSwap = amountWETHtoSwap;
        const callerFee = liquidityToSwap
          .mul(await autoRepay.FEE())
          .div(await autoRepay.HUNDRED_PERCENT());
        const userData = await pool.getUserAccountData(userAddress);
        await autoRepay
          .connect(user)
          .setMinMaxHealthFactor(userData.healthFactor.add('1'), MAX_UINT_AMOUNT);
        await aWETH.connect(user).approve(autoRepay.address, liquidityToSwap.add(callerFee));
        await mockUniswapRouter.setAmountToSwap(weth.address, liquidityToSwap);
        await mockUniswapRouter.setDefaultMockValue(liquidityToSwap);
        await expect(
          autoRepay.connect(caller).increaseHealthFactor(
            {
              user: userAddress,
              collateralAsset: weth.address,
              debtAsset: dai.address,
              collateralAmount: liquidityToSwap,
              debtRepayAmount: expectedDaiAmount,
              rateMode: 1,
              path: [weth.address, dai.address],
              useATokenAsFrom: false,
              useATokenAsTo: false,
              useFlashloan: false,
            },
            zeroPermitSignature
          )
        ).to.be.revertedWith('Caller is not whitelisted');
      });

      it('should revert if user health factor is more or equal than minHealthFactor', async () => {
        const { users, pool, weth, aWETH, oracle, dai, autoRepay } = testEnv;
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
        const liquidityToSwap = amountWETHtoSwap;
        const callerFee = liquidityToSwap
          .mul(await autoRepay.FEE())
          .div(await autoRepay.HUNDRED_PERCENT());
        await autoRepay.whitelistAddress(callerAddress);
        const userData = await pool.getUserAccountData(userAddress);
        await autoRepay
          .connect(user)
          .setMinMaxHealthFactor(
            userData.healthFactor.sub(userData.healthFactor.div(10)),
            MAX_UINT_AMOUNT
          );
        await aWETH.connect(user).approve(autoRepay.address, liquidityToSwap.add(callerFee));
        await mockUniswapRouter.setAmountToSwap(weth.address, liquidityToSwap);
        await mockUniswapRouter.setDefaultMockValue(liquidityToSwap);
        await expect(
          autoRepay.connect(caller).increaseHealthFactor(
            {
              user: userAddress,
              collateralAsset: weth.address,
              debtAsset: dai.address,
              collateralAmount: liquidityToSwap,
              debtRepayAmount: expectedDaiAmount,
              rateMode: 1,
              path: [weth.address, dai.address],
              useATokenAsFrom: false,
              useATokenAsTo: false,
              useFlashloan: false,
            },
            zeroPermitSignature
          )
        ).to.be.revertedWith('User health factor must be less than minHealthFactor for user');
      });

      it(
        'should revert if after repay user health factor ' + 'is more  than maxHealthFactor',
        async () => {
          const { users, pool, weth, aWETH, oracle, dai, autoRepay } = testEnv;
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
          const liquidityToSwap = amountWETHtoSwap;
          const callerFee = liquidityToSwap
            .mul(await autoRepay.FEE())
            .div(await autoRepay.HUNDRED_PERCENT());
          await autoRepay.whitelistAddress(callerAddress);
          const userData = await pool.getUserAccountData(userAddress);
          await autoRepay
            .connect(user)
            .setMinMaxHealthFactor(userData.healthFactor.add(1), userData.healthFactor.add(100));
          await aWETH.connect(user).approve(autoRepay.address, liquidityToSwap.add(callerFee));
          await mockUniswapRouter.setAmountToSwap(weth.address, liquidityToSwap);
          await mockUniswapRouter.setDefaultMockValue(liquidityToSwap);
          await expect(
            autoRepay.connect(caller).increaseHealthFactor(
              {
                user: userAddress,
                collateralAsset: weth.address,
                debtAsset: dai.address,
                collateralAmount: liquidityToSwap,
                debtRepayAmount: expectedDaiAmount,
                rateMode: 1,
                path: [weth.address, dai.address],
                useATokenAsFrom: false,
                useATokenAsTo: false,
                useFlashloan: false,
              },
              zeroPermitSignature
            )
          ).to.be.revertedWith('User health factor was not increased or more than maxHealthFactor');
        }
      );

      it('should revert if there is not debt to repay', async () => {
        const { users, weth, aWETH, oracle, dai, autoRepay, pool } = testEnv;
        const user = users[0].signer;
        const userAddress = users[0].address;
        const caller = users[1].signer;
        const callerAddress = users[1].address;
        const amountWETHtoSwap = await convertToCurrencyDecimals(weth.address, '10');

        // borrow another token
        await pool.connect(user).borrow(weth.address, '1000000', 2, 0, userAddress);

        const daiPrice = await oracle.getAssetPrice(dai.address);
        const expectedDaiAmount = await convertToCurrencyDecimals(
          dai.address,
          new BigNumber(amountWETHtoSwap.toString()).div(daiPrice.toString()).toFixed(0)
        );
        const liquidityToSwap = amountWETHtoSwap;
        const callerFee = liquidityToSwap
          .mul(await autoRepay.FEE())
          .div(await autoRepay.HUNDRED_PERCENT());
        await autoRepay.whitelistAddress(callerAddress);
        const userData = await pool.getUserAccountData(userAddress);
        await autoRepay
          .connect(user)
          .setMinMaxHealthFactor(userData.healthFactor.add('1'), MAX_UINT_AMOUNT);
        await aWETH.connect(user).approve(autoRepay.address, liquidityToSwap.add(callerFee));
        await mockUniswapRouter.setAmountToSwap(weth.address, liquidityToSwap);
        await mockUniswapRouter.setDefaultMockValue(liquidityToSwap);
        await expect(
          autoRepay.connect(caller).increaseHealthFactor(
            {
              user: userAddress,
              collateralAsset: weth.address,
              debtAsset: dai.address,
              collateralAmount: liquidityToSwap,
              debtRepayAmount: expectedDaiAmount,
              rateMode: 2,
              path: [weth.address, dai.address],
              useATokenAsFrom: false,
              useATokenAsTo: false,
              useFlashloan: false,
            },
            zeroPermitSignature
          )
        ).to.be.reverted;
      });

      it('should revert when max amount allowed to swap is bigger than max slippage', async () => {
        const { users, pool, weth, aWETH, oracle, dai, autoRepay } = testEnv;
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
        const bigMaxAmountToSwap = amountWETHtoSwap.mul(2);
        const callerFee = bigMaxAmountToSwap
          .mul(await autoRepay.FEE())
          .div(await autoRepay.HUNDRED_PERCENT());
        await autoRepay.whitelistAddress(callerAddress);
        const userData = await pool.getUserAccountData(userAddress);
        await autoRepay
          .connect(user)
          .setMinMaxHealthFactor(userData.healthFactor.add('1'), MAX_UINT_AMOUNT);
        await aWETH.connect(user).approve(autoRepay.address, bigMaxAmountToSwap.add(callerFee));
        await mockUniswapRouter.connect(user).setAmountToSwap(weth.address, bigMaxAmountToSwap);
        await mockUniswapRouter.setDefaultMockValue(bigMaxAmountToSwap);
        await expect(
          autoRepay.connect(caller).increaseHealthFactor(
            {
              user: userAddress,
              collateralAsset: weth.address,
              debtAsset: dai.address,
              collateralAmount: bigMaxAmountToSwap,
              debtRepayAmount: expectedDaiAmount,
              rateMode: 1,
              path: [weth.address, dai.address],
              useATokenAsFrom: false,
              useATokenAsTo: false,
              useFlashloan: false,
            },
            zeroPermitSignature
          )
        ).to.be.revertedWith('maxAmountToSwap exceed max slippage');
      });

      it('should swap, repay debt and pull the needed ATokens leaving no leftovers', async () => {
        const { users, pool, weth, aWETH, oracle, dai, autoRepay, helpersContract } = testEnv;
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
        const daiStableDebtTokenAddress = (
          await helpersContract.getReserveTokensAddresses(dai.address)
        ).stableDebtTokenAddress;
        const daiStableDebtContract = await getContract<StableDebtToken>(
          eContractid.StableDebtToken,
          daiStableDebtTokenAddress
        );
        const userDaiStableDebtAmountBefore = await daiStableDebtContract.balanceOf(userAddress);
        const liquidityToSwap = amountWETHtoSwap;
        const callerFee = liquidityToSwap
          .mul(await autoRepay.FEE())
          .div(await autoRepay.HUNDRED_PERCENT());
        await autoRepay.whitelistAddress(callerAddress);
        const userData = await pool.getUserAccountData(userAddress);
        await autoRepay
          .connect(user)
          .setMinMaxHealthFactor(userData.healthFactor.add('1'), MAX_UINT_AMOUNT);
        await aWETH.connect(user).approve(autoRepay.address, liquidityToSwap.add(callerFee));
        const userAEthBalanceBefore = await aWETH.balanceOf(userAddress);
        const userWethBalanceBefore = await weth.balanceOf(userAddress);
        const actualWEthSwapped = new BigNumber(liquidityToSwap.toString())
          .multipliedBy(0.995)
          .toFixed(0);
        const actualCallerFee = ethers.BigNumber.from(actualWEthSwapped)
          .mul(await autoRepay.FEE())
          .div(await autoRepay.HUNDRED_PERCENT());
        await mockUniswapRouter.connect(user).setAmountToSwap(weth.address, actualWEthSwapped);
        await mockUniswapRouter.setDefaultMockValue(actualWEthSwapped);
        await autoRepay.connect(caller).increaseHealthFactor(
          {
            user: userAddress,
            collateralAsset: weth.address,
            debtAsset: dai.address,
            collateralAmount: liquidityToSwap,
            debtRepayAmount: expectedDaiAmount,
            rateMode: 1,
            path: [weth.address, dai.address],
            useATokenAsFrom: false,
            useATokenAsTo: false,
            useFlashloan: false,
          },
          zeroPermitSignature
        );
        const adapterWethBalance = await weth.balanceOf(autoRepay.address);
        const adapterDaiBalance = await dai.balanceOf(autoRepay.address);
        const userDaiStableDebtAmount = await daiStableDebtContract.balanceOf(userAddress);
        const userAEthBalance = await aWETH.balanceOf(userAddress);
        const adapterAEthBalance = await aWETH.balanceOf(autoRepay.address);
        const userWethBalance = await weth.balanceOf(userAddress);
        const callerAEthBalance = await aWETH.balanceOf(callerAddress);
        expect(adapterAEthBalance).to.be.eq(Zero);
        expect(adapterWethBalance).to.be.eq(Zero);
        expect(adapterDaiBalance).to.be.eq(Zero);
        expect(userDaiStableDebtAmountBefore).to.be.gte(expectedDaiAmount);
        expect(userDaiStableDebtAmount).to.be.lt(expectedDaiAmount);
        expect(userAEthBalance).to.be.lt(userAEthBalanceBefore);
        expect(userAEthBalance).to.be.eq(
          userAEthBalanceBefore.sub(actualCallerFee.add(actualWEthSwapped))
        );
        expect(userWethBalance).to.be.eq(userWethBalanceBefore);
        expect(callerAEthBalance).to.be.eq(actualCallerFee);
      });

      it('should correctly swap tokens and repay the whole stable debt', async () => {
        const { users, pool, weth, aWETH, oracle, dai, autoRepay, helpersContract } = testEnv;
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
        const daiStableDebtTokenAddress = (
          await helpersContract.getReserveTokensAddresses(dai.address)
        ).stableDebtTokenAddress;
        const daiStableDebtContract = await getContract<StableDebtToken>(
          eContractid.StableDebtToken,
          daiStableDebtTokenAddress
        );
        const userDaiStableDebtAmountBefore = await daiStableDebtContract.balanceOf(userAddress);
        // Add a % to repay on top of the debt
        const liquidityToSwap = ethers.BigNumber.from(
          new BigNumber(amountWETHtoSwap.toString()).multipliedBy(2).toFixed(0)
        );
        const callerFee = liquidityToSwap
          .mul(await autoRepay.FEE())
          .div(await autoRepay.HUNDRED_PERCENT());
        await autoRepay.whitelistAddress(callerAddress);
        const userData = await pool.getUserAccountData(userAddress);
        await autoRepay
          .connect(user)
          .setMinMaxHealthFactor(userData.healthFactor.add('1'), MAX_UINT_AMOUNT);
        await aWETH.connect(user).approve(autoRepay.address, liquidityToSwap.add(callerFee));
        const userAEthBalanceBefore = await aWETH.balanceOf(userAddress);
        // Add a % to repay on top of the debt
        const amountToRepay = new BigNumber(expectedDaiAmount.toString())
          .multipliedBy(2)
          .toFixed(0);
        await mockUniswapRouter.connect(user).setAmountToSwap(weth.address, amountWETHtoSwap);
        await mockUniswapRouter.setDefaultMockValue(amountWETHtoSwap);
        const actualCallerFee = amountWETHtoSwap
          .mul(await autoRepay.FEE())
          .div(await autoRepay.HUNDRED_PERCENT());
        await autoRepay.connect(caller).increaseHealthFactor(
          {
            user: userAddress,
            collateralAsset: weth.address,
            debtAsset: dai.address,
            collateralAmount: liquidityToSwap,
            debtRepayAmount: amountToRepay,
            rateMode: 1,
            path: [weth.address, dai.address],
            useATokenAsFrom: false,
            useATokenAsTo: false,
            useFlashloan: false,
          },
          zeroPermitSignature
        );
        const adapterWethBalance = await weth.balanceOf(autoRepay.address);
        const adapterDaiBalance = await dai.balanceOf(autoRepay.address);
        const userDaiStableDebtAmount = await daiStableDebtContract.balanceOf(userAddress);
        const userAEthBalance = await aWETH.balanceOf(userAddress);
        const adapterAEthBalance = await aWETH.balanceOf(autoRepay.address);
        const callerAEthBalance = await aWETH.balanceOf(callerAddress);
        expect(adapterAEthBalance).to.be.eq(Zero);
        expect(adapterWethBalance).to.be.eq(Zero);
        expect(adapterDaiBalance).to.be.eq(Zero);
        expect(userDaiStableDebtAmountBefore).to.be.gte(expectedDaiAmount);
        expect(userDaiStableDebtAmount).to.be.eq(Zero);
        expect(userAEthBalance).to.be.lt(userAEthBalanceBefore);
        expect(userAEthBalance).to.be.gte(userAEthBalanceBefore.sub(liquidityToSwap));
        expect(callerAEthBalance).to.be.eq(actualCallerFee);
      });

      it('should correctly swap tokens and repay the whole variable debt', async () => {
        const { users, pool, weth, aWETH, oracle, dai, autoRepay, helpersContract } = testEnv;
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
        await pool.connect(user).borrow(dai.address, expectedDaiAmount, 2, 0, userAddress);
        const daiStableVariableTokenAddress = (
          await helpersContract.getReserveTokensAddresses(dai.address)
        ).variableDebtTokenAddress;
        const daiVariableDebtContract = await getContract<StableDebtToken>(
          eContractid.VariableDebtToken,
          daiStableVariableTokenAddress
        );
        const userDaiVariableDebtAmountBefore = await daiVariableDebtContract.balanceOf(
          userAddress
        );
        // Add a % to repay on top of the debt
        const liquidityToSwap = ethers.BigNumber.from(
          new BigNumber(amountWETHtoSwap.toString()).multipliedBy(2).toFixed(0)
        );
        const callerFee = liquidityToSwap
          .mul(await autoRepay.FEE())
          .div(await autoRepay.HUNDRED_PERCENT());
        await autoRepay.whitelistAddress(callerAddress);
        const userData = await pool.getUserAccountData(userAddress);
        await autoRepay
          .connect(user)
          .setMinMaxHealthFactor(userData.healthFactor.add('1'), MAX_UINT_AMOUNT);
        await aWETH.connect(user).approve(autoRepay.address, liquidityToSwap.add(callerFee));
        const userAEthBalanceBefore = await aWETH.balanceOf(userAddress);
        // Add a % to repay on top of the debt
        const amountToRepay = new BigNumber(expectedDaiAmount.toString())
          .multipliedBy(2)
          .toFixed(0);
        await mockUniswapRouter.connect(user).setAmountToSwap(weth.address, amountWETHtoSwap);
        await mockUniswapRouter.setDefaultMockValue(amountWETHtoSwap);
        const actualCallerFee = amountWETHtoSwap
          .mul(await autoRepay.FEE())
          .div(await autoRepay.HUNDRED_PERCENT());
        await autoRepay.connect(caller).increaseHealthFactor(
          {
            user: userAddress,
            collateralAsset: weth.address,
            debtAsset: dai.address,
            collateralAmount: liquidityToSwap,
            debtRepayAmount: amountToRepay,
            rateMode: 2,
            path: [weth.address, dai.address],
            useATokenAsFrom: false,
            useATokenAsTo: false,
            useFlashloan: false,
          },
          zeroPermitSignature
        );
        const adapterWethBalance = await weth.balanceOf(autoRepay.address);
        const adapterDaiBalance = await dai.balanceOf(autoRepay.address);
        const userDaiVariableDebtAmount = await daiVariableDebtContract.balanceOf(userAddress);
        const userAEthBalance = await aWETH.balanceOf(userAddress);
        const adapterAEthBalance = await aWETH.balanceOf(autoRepay.address);
        const callerAEthBalance = await aWETH.balanceOf(callerAddress);
        expect(adapterAEthBalance).to.be.eq(Zero);
        expect(adapterWethBalance).to.be.eq(Zero);
        expect(adapterDaiBalance).to.be.eq(Zero);
        expect(userDaiVariableDebtAmountBefore).to.be.gte(expectedDaiAmount);
        expect(userDaiVariableDebtAmount).to.be.eq(Zero);
        expect(userAEthBalance).to.be.lt(userAEthBalanceBefore);
        expect(userAEthBalance).to.be.gte(userAEthBalanceBefore.sub(liquidityToSwap));
        expect(callerAEthBalance).to.be.eq(actualCallerFee);
      });

      it('should correctly repay debt using the same asset as collateral', async () => {
        const { users, pool, dai, autoRepay, helpersContract, aDai } = testEnv;
        const user = users[0].signer;
        const userAddress = users[0].address;
        const caller = users[1].signer;
        const callerAddress = users[1].address;
        // Add deposit for user
        await dai.mint(parseEther('30'));
        await dai.approve(pool.address, parseEther('30'));
        await pool.deposit(dai.address, parseEther('30'), userAddress, 0);
        const amountCollateralToSwap = parseEther('4');
        const debtAmount = parseEther('3');
        // Open user Debt
        await pool.connect(user).borrow(dai.address, debtAmount, 2, 0, userAddress);
        const daiVariableDebtTokenAddress = (
          await helpersContract.getReserveTokensAddresses(dai.address)
        ).variableDebtTokenAddress;
        const daiVariableDebtContract = await getContract<StableDebtToken>(
          eContractid.StableDebtToken,
          daiVariableDebtTokenAddress
        );
        const userDaiVariableDebtAmountBefore = await daiVariableDebtContract.balanceOf(
          userAddress
        );
        const callerFee = amountCollateralToSwap
          .mul(await autoRepay.FEE())
          .div(await autoRepay.HUNDRED_PERCENT());
        await autoRepay.whitelistAddress(callerAddress);
        const userData = await pool.getUserAccountData(userAddress);
        await autoRepay
          .connect(user)
          .setMinMaxHealthFactor(userData.healthFactor.add('1'), MAX_UINT_AMOUNT);
        await aDai.connect(user).approve(autoRepay.address, amountCollateralToSwap.add(callerFee));
        const userADaiBalanceBefore = await aDai.balanceOf(userAddress);
        const userDaiBalanceBefore = await dai.balanceOf(userAddress);
        await autoRepay.connect(caller).increaseHealthFactor(
          {
            user: userAddress,
            collateralAsset: dai.address,
            debtAsset: dai.address,
            collateralAmount: amountCollateralToSwap,
            debtRepayAmount: amountCollateralToSwap,
            rateMode: 2,
            path: [dai.address, dai.address],
            useATokenAsFrom: false,
            useATokenAsTo: false,
            useFlashloan: false,
          },
          zeroPermitSignature
        );
        const adapterDaiBalance = await dai.balanceOf(autoRepay.address);
        const userDaiVariableDebtAmount = await daiVariableDebtContract.balanceOf(userAddress);
        const userADaiBalance = await aDai.balanceOf(userAddress);
        const adapterADaiBalance = await aDai.balanceOf(autoRepay.address);
        const userDaiBalance = await dai.balanceOf(userAddress);
        expect(adapterADaiBalance).to.be.eq(Zero, 'adapter aADAI should be zero');
        expect(adapterDaiBalance).to.be.eq(Zero, 'adapter DAI should be zero');
        expect(userDaiVariableDebtAmountBefore).to.be.gte(
          debtAmount,
          'user dai variable debt before should be gte debtAmount'
        );
        expect(userDaiVariableDebtAmount).to.be.lt(
          debtAmount,
          'current user dai variable debt amount should be less than debtAmount'
        );
        expect(userADaiBalance).to.be.lt(
          userADaiBalanceBefore,
          'current user aDAI balance should be less than prior balance'
        );
        expect(userADaiBalance).to.be.gte(
          userADaiBalanceBefore.sub(amountCollateralToSwap),
          'current user aDAI balance should be gte user balance sub swapped collateral'
        );
        expect(userDaiBalance).to.be.eq(
          userDaiBalanceBefore,
          'user DAI balance should remain equal'
        );
      });
    });
  });
});
