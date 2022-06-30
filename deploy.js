const hre = require('hardhat');

const contractFactoryName = 'UniswapRepayAdapter';

async function deployContract() {
  const ContractFactory = await hre.ethers.getContractFactory(contractFactoryName);
  const addressesProvider = '0xd1088091a174d33412a968fa34cb67131188b332';
  const uniswapRouter = '0xe3d8bd6aed4f159bc8000a9cd47cffdb95f96121';
  const wethAddress = '0x471ece3750da237f93b8e339c536989b8978a438';
  const contract = await ContractFactory.deploy(addressesProvider, uniswapRouter, wethAddress);

  /**
   *     ILendingPoolAddressesProvider addressesProvider,
    IUniswapV2Router02 uniswapRouter,
    address wethAddress
   */

  await contract.deployed();

  console.log('Deployed to:', contract.address);
}

deployContract()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });

// npx hardhat run deploy.js --network celo
