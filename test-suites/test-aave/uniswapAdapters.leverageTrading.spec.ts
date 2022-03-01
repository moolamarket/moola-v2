import { makeSuite, TestEnv } from './helpers/make-suite';
import {
  convertToCurrencyDecimals,
  getContract,
  buildLeverageTradingParams,
} from '../../helpers/contracts-helpers';
import { getMockUniswapRouter } from '../../helpers/contracts-getters';
import { deployLeverageTrading } from '../../helpers/contracts-deployments';
import { MockUniswapV2Router02 } from '../../types/MockUniswapV2Router02';
import { Zero } from '@ethersproject/constants';
import { evmRevert, evmSnapshot } from '../../helpers/misc-utils';
import { ethers } from 'ethers';
import { eContractid } from '../../helpers/types';
import { StableDebtToken } from '../../types/StableDebtToken';
import { VariableDebtToken } from '../../types/VariableDebtToken';
const { parseEther } = ethers.utils;

const { expect } = require('chai');

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

  describe('Leverage Trading', () => {
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
        await deployLeverageTrading([
          addressesProvider.address,
          mockUniswapRouter.address,
          weth.address,
        ]);
      });

      it('should revert if not valid addresses provider', async () => {
        const { weth } = testEnv;
        expect(
          deployLeverageTrading([
            mockUniswapRouter.address,
            mockUniswapRouter.address,
            weth.address,
          ])
        ).to.be.reverted;
      });
    });

    describe('executeOperation', () => {
      const ten = ethers.BigNumber.from(10);

      it('should correctly swap token and deposit weth', async () => {
        const { users, pool, weth, aWETH, dai, oracle, leverageTrading, helpersContract } = testEnv;
        const user = users[0].signer;
        const userAddress = users[0].address;

        const amountDaiToSwap = await convertToCurrencyDecimals(dai.address, '100');

        const daiPrice = await oracle.getAssetPrice(dai.address);
        const daiDecimals = await dai.decimals();
        const expectedWETHAmount = amountDaiToSwap.mul(daiPrice).div(ten.pow(daiDecimals));

        const daiStableDebtTokenAddress = (
          await helpersContract.getReserveTokensAddresses(dai.address)
        ).stableDebtTokenAddress;

        const daiStableDebtContract = await getContract<StableDebtToken>(
          eContractid.StableDebtToken,
          daiStableDebtTokenAddress
        );

        const userDaiStableDebtAmountBefore = await daiStableDebtContract.balanceOf(userAddress);

        const liquidityToSwap = expectedWETHAmount;
        const userAEthBalanceBefore = await aWETH.balanceOf(userAddress);

        await mockUniswapRouter.connect(user).setAmountToReturn(dai.address, liquidityToSwap);

        const params = buildLeverageTradingParams([false]);

        await expect(
          pool
            .connect(user)
            .flashLoan(
              leverageTrading.address,
              [dai.address],
              [amountDaiToSwap],
              [1],
              userAddress,
              params,
              0
            )
        )
          .to.emit(leverageTrading, 'Swapped')
          .withArgs(dai.address, weth.address, amountDaiToSwap, expectedWETHAmount);

        const leverageWethBalance = await weth.balanceOf(leverageTrading.address);
        const leverageDaiBalance = await dai.balanceOf(leverageTrading.address);
        const userDaiStableDebtAmount = await daiStableDebtContract.balanceOf(userAddress);
        const userAEthBalance = await aWETH.balanceOf(userAddress);

        expect(leverageWethBalance).to.be.eq(Zero);
        expect(leverageDaiBalance).to.be.eq(Zero);
        expect(userDaiStableDebtAmountBefore.add(amountDaiToSwap)).to.be.eq(
          userDaiStableDebtAmount
        );
        expect(userAEthBalanceBefore.add(expectedWETHAmount)).to.be.eq(userAEthBalance);
      });

      it('should correctly swap tokens(2 or more) and deposit weth', async () => {
        const { users, pool, weth, aWETH, dai, oracle, leverageTrading, helpersContract } = testEnv;
        const user = users[0].signer;
        const userAddress = users[0].address;

        const amountDaiToSwap = await convertToCurrencyDecimals(dai.address, '100');

        const daiPrice = await oracle.getAssetPrice(dai.address);
        const daiDecimals = await dai.decimals();
        const expectedWETHAmount = amountDaiToSwap.mul(daiPrice).div(ten.pow(daiDecimals));

        const daiStableDebtTokenAddress = (
          await helpersContract.getReserveTokensAddresses(dai.address)
        ).stableDebtTokenAddress;

        const daiStableDebtContract = await getContract<StableDebtToken>(
          eContractid.StableDebtToken,
          daiStableDebtTokenAddress
        );

        const userDaiStableDebtAmountBefore = await daiStableDebtContract.balanceOf(userAddress);

        const liquidityToSwap = expectedWETHAmount;
        const userAEthBalanceBefore = await aWETH.balanceOf(userAddress);

        await mockUniswapRouter.connect(user).setAmountToReturn(dai.address, liquidityToSwap);

        const params = buildLeverageTradingParams([false, false]);

        await pool
          .connect(user)
          .flashLoan(
            leverageTrading.address,
            [dai.address, dai.address],
            [amountDaiToSwap, amountDaiToSwap],
            [1, 1],
            userAddress,
            params,
            0
          );

        const leverageWethBalance = await weth.balanceOf(leverageTrading.address);
        const leverageDaiBalance = await dai.balanceOf(leverageTrading.address);
        const userDaiStableDebtAmount = await daiStableDebtContract.balanceOf(userAddress);
        const userAEthBalance = await aWETH.balanceOf(userAddress);

        expect(leverageWethBalance).to.be.eq(Zero);
        expect(leverageDaiBalance).to.be.eq(Zero);
        expect(userDaiStableDebtAmountBefore.add(amountDaiToSwap.mul(2))).to.be.eq(
          userDaiStableDebtAmount
        );
        expect(userAEthBalanceBefore.add(expectedWETHAmount.mul(2))).to.be.eq(userAEthBalance);
      });

      it('should correctly swap token and deposit weth with variable mode', async () => {
        const { users, pool, weth, aWETH, dai, oracle, leverageTrading, helpersContract } = testEnv;
        const user = users[0].signer;
        const userAddress = users[0].address;

        const amountDaiToSwap = await convertToCurrencyDecimals(dai.address, '100');

        const daiPrice = await oracle.getAssetPrice(dai.address);
        const daiDecimals = await dai.decimals();
        const expectedWETHAmount = amountDaiToSwap.mul(daiPrice).div(ten.pow(daiDecimals));

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

        const liquidityToSwap = expectedWETHAmount;
        const userAEthBalanceBefore = await aWETH.balanceOf(userAddress);

        await mockUniswapRouter.connect(user).setAmountToReturn(dai.address, liquidityToSwap);

        const params = buildLeverageTradingParams([false]);

        await expect(
          pool
            .connect(user)
            .flashLoan(
              leverageTrading.address,
              [dai.address],
              [amountDaiToSwap],
              [2],
              userAddress,
              params,
              0
            )
        )
          .to.emit(leverageTrading, 'Swapped')
          .withArgs(dai.address, weth.address, amountDaiToSwap, expectedWETHAmount);

        const leverageWethBalance = await weth.balanceOf(leverageTrading.address);
        const leverageDaiBalance = await dai.balanceOf(leverageTrading.address);
        const userDaiVariableDebtAmount = await daiVariableDebtContract.balanceOf(userAddress);
        const userAEthBalance = await aWETH.balanceOf(userAddress);

        expect(leverageWethBalance).to.be.eq(Zero);
        expect(leverageDaiBalance).to.be.eq(Zero);
        expect(userDaiVariableDebtAmountBefore.add(amountDaiToSwap)).to.be.eq(
          userDaiVariableDebtAmount
        );
        expect(userAEthBalanceBefore.add(expectedWETHAmount)).to.be.eq(userAEthBalance);
      });

      it('should revert if caller not lending pool', async () => {
        const { users, dai, oracle, leverageTrading } = testEnv;
        const user = users[0].signer;
        const userAddress = users[0].address;

        const amountDaiToSwap = await convertToCurrencyDecimals(dai.address, '100');

        const daiPrice = await oracle.getAssetPrice(dai.address);
        const daiDecimals = await dai.decimals();
        const expectedWETHAmount = amountDaiToSwap.mul(daiPrice).div(ten.pow(daiDecimals));

        const liquidityToSwap = expectedWETHAmount;

        await mockUniswapRouter.connect(user).setAmountToReturn(dai.address, liquidityToSwap);

        const params = buildLeverageTradingParams([false]);

        await expect(
          leverageTrading
            .connect(user)
            .executeOperation([dai.address], [amountDaiToSwap], [1], userAddress, params)
        ).to.be.revertedWith('CALLER_MUST_BE_LENDING_POOL');
      });

      it(
        'should revert if useATokensAsFrom(decoded params) length is' +
          'more or less than borrowed assets length',
        async () => {
          const { users, dai, oracle, leverageTrading, pool } = testEnv;
          const user = users[0].signer;
          const userAddress = users[0].address;

          const amountDaiToSwap = await convertToCurrencyDecimals(dai.address, '100');

          const daiPrice = await oracle.getAssetPrice(dai.address);
          const daiDecimals = await dai.decimals();
          const expectedWETHAmount = amountDaiToSwap.mul(daiPrice).div(ten.pow(daiDecimals));

          const liquidityToSwap = expectedWETHAmount;

          await mockUniswapRouter.connect(user).setAmountToReturn(dai.address, liquidityToSwap);

          // less
          let params = buildLeverageTradingParams([]);
          await expect(
            pool
              .connect(user)
              .flashLoan(
                leverageTrading.address,
                [dai.address],
                [amountDaiToSwap],
                [1],
                userAddress,
                params,
                0
              )
          ).to.be.revertedWith('useATokensAsFrom length does not match to assets length');
          // more
          params = buildLeverageTradingParams([false, false]);
          await expect(
            pool
              .connect(user)
              .flashLoan(
                leverageTrading.address,
                [dai.address],
                [amountDaiToSwap],
                [1],
                userAddress,
                params,
                0
              )
          ).to.be.revertedWith('useATokensAsFrom length does not match to assets length');
        }
      );

      it('should revert if debt price is more than user totalCollateralPrice', async () => {
        const { users, pool, dai, oracle, leverageTrading } = testEnv;
        const anotherUser = users[1].signer;
        const anotherUserAddress = users[1].address;

        const amountDaiToSwap = await convertToCurrencyDecimals(dai.address, '100');

        const daiPrice = await oracle.getAssetPrice(dai.address);
        const daiDecimals = await dai.decimals();
        const expectedWETHAmount = amountDaiToSwap.mul(daiPrice).div(ten.pow(daiDecimals));

        const liquidityToSwap = expectedWETHAmount;

        await mockUniswapRouter
          .connect(anotherUser)
          .setAmountToReturn(dai.address, liquidityToSwap);

        const params = buildLeverageTradingParams([false]);

        await expect(
          pool
            .connect(anotherUser)
            .flashLoan(
              leverageTrading.address,
              [dai.address],
              [amountDaiToSwap],
              [1],
              anotherUserAddress,
              params,
              0
            )
        ).to.be.revertedWith('11'); // see Errors.sol -> VL_COLLATERAL_CANNOT_COVER_NEW_BORROW
      });
    });
  });
});
