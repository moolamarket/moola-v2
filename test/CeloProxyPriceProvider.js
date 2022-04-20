const Ganache = require("./helpers/ganache");
const { expect, assert, util } = require("chai");
const { BigNumber, utils, providers } = require("ethers");
const { ethers } = require("hardhat");

describe("CeloProxyPriceProvider", function () {
    const ganache = new Ganache();

    let owner;
    let user;
    let liquidityDistributor;

    let token1;
    let token2;
    let token3;

    let priceFeed1;
    let priceFeed2;

    let celoProxyPriceProvider;

    before("setup", async () => {
        let accounts = await ethers.getSigners();

        owner = accounts[0];
        user = accounts[1];
        liquidityDistributor = accounts[3];

        const Token = await ethers.getContractFactory("MintableERC20");

        token1 = await Token.deploy("", "", 18);
        await token1.deployed();

        token2 = await Token.deploy("", "", 0);
        await token2.deployed();

        token3 = await Token.deploy("", "", 0);
        await token3.deployed();

        const PriceFeed = await ethers.getContractFactory("MockPriceFeed");
        const emptyAddress = ethers.utils.getAddress("0x0000000000000000000000000000000000000000");
        priceFeed1 = await PriceFeed.deploy(emptyAddress, token1.address, token2.address);
        await priceFeed1.deployed();
        await priceFeed1.setPrice(ethers.constants.WeiPerEther);

        priceFeed2 = await PriceFeed.deploy(emptyAddress, token1.address, token2.address);
        await priceFeed2.deployed();
        await priceFeed2.setPrice(ethers.constants.WeiPerEther.div(2));

        const Registry = await ethers.getContractFactory("MockRegistry");
        const goldTockenAddress = ethers.utils.getAddress("0x34d6a0f5c2f5d0082141fe73d93b9dd00ca7ce11");
        const registry = await Registry.deploy(goldTockenAddress);
        await registry.deployed();

        const CeloProxyPriceProvider = await ethers.getContractFactory("CeloProxyPriceProvider");
        celoProxyPriceProvider = await CeloProxyPriceProvider.deploy([token1.address, token2.address], [priceFeed1.address, priceFeed2.address], registry.address);
        await celoProxyPriceProvider.deployed();

        await ganache.snapshot();
    });

    afterEach("revert", function () {
        return ganache.revert();
    });

    //positive tests

    it("should check updateAssets", async () => {
        await celoProxyPriceProvider.connect(owner).updateAssets([token1.address, token2.address], [priceFeed2.address, priceFeed1.address]);

        const asset1Price = await celoProxyPriceProvider.getAssetPrice(token1.address);
        const asset2Price = await celoProxyPriceProvider.getAssetPrice(token2.address);

        expect(asset1Price).to.equal(ethers.constants.WeiPerEther.div(2));
        expect(asset2Price).to.equal(ethers.constants.WeiPerEther);
    });

    it("should check getAssetPrice", async () => {
        const asset1Price = await celoProxyPriceProvider.getAssetPrice(token1.address);
        const asset2Price = await celoProxyPriceProvider.getAssetPrice(token2.address);

        expect(asset1Price).to.equal(ethers.constants.WeiPerEther);
        expect(asset2Price).to.equal(ethers.constants.WeiPerEther.div(2));
    });

    it("should check getAssetsPrices", async () => {
        const assetsPrice = await celoProxyPriceProvider.getAssetsPrices([token1.address, token2.address]);

        expect(assetsPrice[0]).to.equal(ethers.constants.WeiPerEther);
        expect(assetsPrice[1]).to.equal(ethers.constants.WeiPerEther.div(2));
    });

    it("should check getPriceFeed", async () => {
        const priceFeed1Address = await celoProxyPriceProvider.getPriceFeed(token1.address);
        const priceFeed2Address = await celoProxyPriceProvider.getPriceFeed(token2.address);

        expect(priceFeed1Address).to.equal(priceFeed1.address);
        expect(priceFeed2Address).to.equal(priceFeed2.address);
    });

    //negative tests

    it("should not allow return unknown assets price", async () => {
        await expect(
            celoProxyPriceProvider.getAssetPrice(token3.address)
          ).to.be.revertedWith("Transaction reverted: function call to a non-contract account");
    });
});
