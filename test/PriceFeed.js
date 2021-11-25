const Ganache = require("./helpers/ganache");
const { expect, assert, util } = require("chai");
const { BigNumber, utils, providers } = require("ethers");
const { ethers } = require("hardhat");

describe("PriceFeed", function () {
    const ganache = new Ganache();

    let owner;
    let user;

    let priceFeed;

    before("setup", async () => {
        let accounts = await ethers.getSigners();

        owner = accounts[0];
        user = accounts[1];

        const PriceFeed = await ethers.getContractFactory("PriceFeed");
        const emptyAddress = ethers.utils.getAddress("0x0000000000000000000000000000000000000000");

        const SortedOracles = await ethers.getContractFactory("MockSortedOracles");
        const sortedOracles = await SortedOracles.deploy();
        await sortedOracles.deployed();

        const Registry = await ethers.getContractFactory("MockRegistry");
        const registry = await Registry.deploy(sortedOracles.address);
        await registry.deployed();

        priceFeed = await PriceFeed.deploy(emptyAddress, emptyAddress, registry.address);
        await priceFeed.deployed();

        await ganache.snapshot();
    });

    afterEach("revert", function () {
        return ganache.revert();
    });

    //positive tests

    it("should check consult", async () => {
        const result = await priceFeed.connect(user).consult();

        expect(result).to.equal("1000000000000000000");
    });
});