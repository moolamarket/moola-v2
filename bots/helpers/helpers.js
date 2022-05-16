const BigNumber = require('bignumber.js');

module.exports = class SwapPath {
    constructor(ubeswap, CELO, mceloAddress, cUSD, mcusdAddress, cEUR, mceurAddress, cREAL, MOO) {
      this.ubeswap = ubeswap;
      this.CELO = CELO;
      this.mceloAddress = mceloAddress;
      this.cUSD = cUSD;
      this.mcusdAddress = mcusdAddress;
      this.cEUR = cEUR;
      this.mceurAddress = mceurAddress;
      this.cREAL = cREAL;
      this.MOO = MOO;
    }

    BN(num) {
      return new BigNumber(num);
    }

    async getBestSwapPath(amountOut, collateralAddress, reserveCollateralTokenAddress, borrowAddress, reserveBorrowTokenAddress) {
      const paths = this.buildPaths(collateralAddress, reserveCollateralTokenAddress, borrowAddress, reserveBorrowTokenAddress);
      const validPaths = []
      for (let i = 0; i < paths.length; i++) {
        const path = paths[i];
        try {
            const amounts = await this.ubeswap.methods
            .getAmountsIn(amountOut, path.path)
            .call();
            validPaths.push({ amount: this.BN(amounts[0]), ...path })
        } catch (error) {
            // not valid path
        }
      }

      const bestPath = validPaths.sort(({ amount: amount1 }, { amount: amount2 }) =>
      this.BN(amount1).comparedTo(this.BN(amount2))
      )[0];
      return bestPath;
    }

    buildPaths(collateralAddress, reserveCollateralTokenAddress, borrowAddress, reserveBorrowTokenAddress) {
      // Get mTokenAddresses
      let paths = [];
      //collateral - borrow
      paths.push({ path: [collateralAddress, borrowAddress], useATokenAsFrom: false, useATokenAsTo: false });
      //MtokenCollateral - borrow
      paths.push({ path: [reserveCollateralTokenAddress, borrowAddress], useATokenAsFrom: true, useATokenAsTo: false });
      //collateral - mBorrow
      paths.push({ path: [collateralAddress, reserveBorrowTokenAddress], useATokenAsFrom: false, useATokenAsTo: true });
      //MtokenCollateral - mBorrow
      paths.push({ path: [reserveCollateralTokenAddress, reserveBorrowTokenAddress], useATokenAsFrom: true, useATokenAsTo: true });
      // with celo
      paths.push({ path: [collateralAddress, this.CELO.options.address, borrowAddress], useATokenAsFrom: false, useATokenAsTo: false });
      paths.push({ path: [reserveCollateralTokenAddress, this.CELO.options.address, borrowAddress], useATokenAsFrom: true, useATokenAsTo: false });
      paths.push({ path: [collateralAddress, this.CELO.options.address, reserveBorrowTokenAddress], useATokenAsFrom: false, useATokenAsTo: true });
      paths.push({ path: [reserveCollateralTokenAddress, this.CELO.options.address, reserveBorrowTokenAddress], useATokenAsFrom: true, useATokenAsTo: true });
      // with mcelo
      paths.push({ path: [collateralAddress, this.mceloAddress, borrowAddress], useATokenAsFrom: false, useATokenAsTo: false });
      paths.push({ path: [reserveCollateralTokenAddress, this.mceloAddress, borrowAddress], useATokenAsFrom: true, useATokenAsTo: false });
      paths.push({ path: [collateralAddress, this.mceloAddress, reserveBorrowTokenAddress], useATokenAsFrom: false, useATokenAsTo: true });
      paths.push({ path: [reserveCollateralTokenAddress, this.mceloAddress, reserveBorrowTokenAddress], useATokenAsFrom: true, useATokenAsTo: true });
      // with cusd
      paths.push({ path: [collateralAddress, this.cUSD.options.address, borrowAddress], useATokenAsFrom: false, useATokenAsTo: false });
      paths.push({ path: [reserveCollateralTokenAddress, this.cUSD.options.address, borrowAddress], useATokenAsFrom: true, useATokenAsTo: false });
      paths.push({ path: [collateralAddress, this.cUSD.options.address, reserveBorrowTokenAddress], useATokenAsFrom: false, useATokenAsTo: true });
      paths.push({ path: [reserveCollateralTokenAddress, this.cUSD.options.address, reserveBorrowTokenAddress], useATokenAsFrom: true, useATokenAsTo: true });
      // with mcusd
      paths.push({ path: [collateralAddress, this.mcusdAddress, borrowAddress], useATokenAsFrom: false, useATokenAsTo: false });
      paths.push({ path: [reserveCollateralTokenAddress, this.mcusdAddress, borrowAddress], useATokenAsFrom: true, useATokenAsTo: false });
      paths.push({ path: [collateralAddress, this.mcusdAddress, reserveBorrowTokenAddress], useATokenAsFrom: false, useATokenAsTo: true });
      paths.push({ path: [reserveCollateralTokenAddress, this.mcusdAddress, reserveBorrowTokenAddress], useATokenAsFrom: true, useATokenAsTo: true });
      // with ceur
      paths.push({ path: [collateralAddress, this.cEUR.options.address, borrowAddress], useATokenAsFrom: false, useATokenAsTo: false });
      paths.push({ path: [reserveCollateralTokenAddress, this.cEUR.options.address, borrowAddress], useATokenAsFrom: true, useATokenAsTo: false });
      paths.push({ path: [collateralAddress, this.cEUR.options.address, reserveBorrowTokenAddress], useATokenAsFrom: false, useATokenAsTo: true });
      paths.push({ path: [reserveCollateralTokenAddress, this.cEUR.options.address, reserveBorrowTokenAddress], useATokenAsFrom: true, useATokenAsTo: true });
      // with mceur
      paths.push({ path: [collateralAddress, this.mceurAddress, borrowAddress], useATokenAsFrom: false, useATokenAsTo: false });
      paths.push({ path: [reserveCollateralTokenAddress, this.mceurAddress, borrowAddress], useATokenAsFrom: true, useATokenAsTo: false });
      paths.push({ path: [collateralAddress, this.mceurAddress, reserveBorrowTokenAddress], useATokenAsFrom: false, useATokenAsTo: true });
      paths.push({ path: [reserveCollateralTokenAddress, this.mceurAddress, reserveBorrowTokenAddress], useATokenAsFrom: true, useATokenAsTo: true });
      // Add custom paths
      const ceur_creal = [this.cEUR.options.address, this.CELO.options.address, this.cUSD.options.address, this.cREAL.options.address]; // ceur-celo, celo-cusd, cusd-creal - only 3k usd in pools
      if (collateralAddress.toLowerCase() == this.cEUR.options.address.toLowerCase() && borrowAddress.toLowerCase() == this.cREAL.options.address.toLowerCase()) {
        paths = [{ path: ceur_creal, useATokenAsFrom: false, useATokenAsTo: false }];
      }
      if (collateralAddress.toLowerCase() == this.cREAL.options.address.toLowerCase() && borrowAddress.toLowerCase() == this.cEUR.options.address.toLowerCase()) {
        paths = [{ path: [...ceur_creal].reverse(), useATokenAsFrom: false, useATokenAsTo: false }]
      }

      const creal_moo = [this.cREAL.options.address, this.cUSD.options.address, this.CELO.options.address, this.MOO.options.address]; // creal-cusd, cusd-celo, celo-moo
      if (collateralAddress.toLowerCase() == this.cREAL.options.address.toLowerCase() && borrowAddress.toLowerCase() == this.MOO.options.address.toLowerCase()) {
        paths = [{ path: creal_moo, useATokenAsFrom: false, useATokenAsTo: true }];
      }
      if (collateralAddress.toLowerCase() == this.MOO.options.address.toLowerCase() && borrowAddress.toLowerCase() == this.cREAL.options.address.toLowerCase()) {
        paths = [{ path: [...creal_moo].reverse(), useATokenAsFrom: true, useATokenAsTo: false }];
      }

      return paths;
    }
};