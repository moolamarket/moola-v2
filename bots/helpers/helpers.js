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

    async getBestSwapPathRepay(amountOut, fromTokenAddress, reserveFromTokenAddress, toTokenAddress, reserveToTokenAddress) {
      const paths = this.buildPaths(fromTokenAddress, reserveFromTokenAddress, toTokenAddress, reserveToTokenAddress);
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

    async getBestSwapPathBorrow(amountIn, fromTokenAddress, reserveFromTokenAddress, toTokenAddress, reserveToTokenAddress) {
      const paths = this.buildPaths(fromTokenAddress, reserveFromTokenAddress, toTokenAddress, reserveToTokenAddress);
      const validPaths = []
      for (let i = 0; i < paths.length; i++) {
        const path = paths[i];
        try {
            const amounts = await this.ubeswap.methods
            .getAmountsOut(amountIn, path.path)
            .call();
            validPaths.push({ amount: this.BN(amounts[amounts.length - 1]), ...path })
        } catch (error) {
            // not valid path
        }
      }

      const bestPath = validPaths.sort(({ amount: amount1 }, { amount: amount2 }) =>
      this.BN(amount2).comparedTo(this.BN(amount1))
      )[0];
      return bestPath;
    }

    buildPaths(fromTokenAddress, reserveFromTokenAddress, toTokenAddress, reserveToTokenAddress) {
      // Get mTokenAddresses
      let paths = [];
      //collateral - borrow
      paths.push({ path: [fromTokenAddress, toTokenAddress], useATokenAsFrom: false, useATokenAsTo: false });
      //MtokenCollateral - borrow
      paths.push({ path: [reserveFromTokenAddress, toTokenAddress], useATokenAsFrom: true, useATokenAsTo: false });
      //collateral - mBorrow
      paths.push({ path: [fromTokenAddress, reserveToTokenAddress], useATokenAsFrom: false, useATokenAsTo: true });
      //MtokenCollateral - mBorrow
      paths.push({ path: [reserveFromTokenAddress, reserveToTokenAddress], useATokenAsFrom: true, useATokenAsTo: true });
      // with celo
      paths.push({ path: [fromTokenAddress, this.CELO.options.address, toTokenAddress], useATokenAsFrom: false, useATokenAsTo: false });
      paths.push({ path: [reserveFromTokenAddress, this.CELO.options.address, toTokenAddress], useATokenAsFrom: true, useATokenAsTo: false });
      paths.push({ path: [fromTokenAddress, this.CELO.options.address, reserveToTokenAddress], useATokenAsFrom: false, useATokenAsTo: true });
      paths.push({ path: [reserveFromTokenAddress, this.CELO.options.address, reserveToTokenAddress], useATokenAsFrom: true, useATokenAsTo: true });
      // with mcelo
      paths.push({ path: [fromTokenAddress, this.mceloAddress, toTokenAddress], useATokenAsFrom: false, useATokenAsTo: false });
      paths.push({ path: [reserveFromTokenAddress, this.mceloAddress, toTokenAddress], useATokenAsFrom: true, useATokenAsTo: false });
      paths.push({ path: [fromTokenAddress, this.mceloAddress, reserveToTokenAddress], useATokenAsFrom: false, useATokenAsTo: true });
      paths.push({ path: [reserveFromTokenAddress, this.mceloAddress, reserveToTokenAddress], useATokenAsFrom: true, useATokenAsTo: true });
      // with cusd
      paths.push({ path: [fromTokenAddress, this.cUSD.options.address, toTokenAddress], useATokenAsFrom: false, useATokenAsTo: false });
      paths.push({ path: [reserveFromTokenAddress, this.cUSD.options.address, toTokenAddress], useATokenAsFrom: true, useATokenAsTo: false });
      paths.push({ path: [fromTokenAddress, this.cUSD.options.address, reserveToTokenAddress], useATokenAsFrom: false, useATokenAsTo: true });
      paths.push({ path: [reserveFromTokenAddress, this.cUSD.options.address, reserveToTokenAddress], useATokenAsFrom: true, useATokenAsTo: true });
      // with mcusd
      paths.push({ path: [fromTokenAddress, this.mcusdAddress, toTokenAddress], useATokenAsFrom: false, useATokenAsTo: false });
      paths.push({ path: [reserveFromTokenAddress, this.mcusdAddress, toTokenAddress], useATokenAsFrom: true, useATokenAsTo: false });
      paths.push({ path: [fromTokenAddress, this.mcusdAddress, reserveToTokenAddress], useATokenAsFrom: false, useATokenAsTo: true });
      paths.push({ path: [reserveFromTokenAddress, this.mcusdAddress, reserveToTokenAddress], useATokenAsFrom: true, useATokenAsTo: true });
      // with ceur
      paths.push({ path: [fromTokenAddress, this.cEUR.options.address, toTokenAddress], useATokenAsFrom: false, useATokenAsTo: false });
      paths.push({ path: [reserveFromTokenAddress, this.cEUR.options.address, toTokenAddress], useATokenAsFrom: true, useATokenAsTo: false });
      paths.push({ path: [fromTokenAddress, this.cEUR.options.address, reserveToTokenAddress], useATokenAsFrom: false, useATokenAsTo: true });
      paths.push({ path: [reserveFromTokenAddress, this.cEUR.options.address, reserveToTokenAddress], useATokenAsFrom: true, useATokenAsTo: true });
      // with mceur
      paths.push({ path: [fromTokenAddress, this.mceurAddress, toTokenAddress], useATokenAsFrom: false, useATokenAsTo: false });
      paths.push({ path: [reserveFromTokenAddress, this.mceurAddress, toTokenAddress], useATokenAsFrom: true, useATokenAsTo: false });
      paths.push({ path: [fromTokenAddress, this.mceurAddress, reserveToTokenAddress], useATokenAsFrom: false, useATokenAsTo: true });
      paths.push({ path: [reserveFromTokenAddress, this.mceurAddress, reserveToTokenAddress], useATokenAsFrom: true, useATokenAsTo: true });
      // Add custom paths
      const ceur_creal = [this.cEUR.options.address, this.CELO.options.address, this.cUSD.options.address, this.cREAL.options.address]; // ceur-celo, celo-cusd, cusd-creal - only 3k usd in pools
      if (fromTokenAddress.toLowerCase() == this.cEUR.options.address.toLowerCase() && toTokenAddress.toLowerCase() == this.cREAL.options.address.toLowerCase()) {
        paths = [{ path: ceur_creal, useATokenAsFrom: false, useATokenAsTo: false }];
      }
      if (fromTokenAddress.toLowerCase() == this.cREAL.options.address.toLowerCase() && toTokenAddress.toLowerCase() == this.cEUR.options.address.toLowerCase()) {
        paths = [{ path: [...ceur_creal].reverse(), useATokenAsFrom: false, useATokenAsTo: false }]
      }

      const creal_moo = [this.cREAL.options.address, this.cUSD.options.address, this.CELO.options.address, this.MOO.options.address]; // creal-cusd, cusd-celo, celo-moo
      if (fromTokenAddress.toLowerCase() == this.cREAL.options.address.toLowerCase() && toTokenAddress.toLowerCase() == this.MOO.options.address.toLowerCase()) {
        paths = [{ path: creal_moo, useATokenAsFrom: false, useATokenAsTo: true }];
      }
      if (fromTokenAddress.toLowerCase() == this.MOO.options.address.toLowerCase() && toTokenAddress.toLowerCase() == this.cREAL.options.address.toLowerCase()) {
        paths = [{ path: [...creal_moo].reverse(), useATokenAsFrom: true, useATokenAsTo: false }];
      }

      return paths;
    }
};