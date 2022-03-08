const hre = require('hardhat');

const contractFactoryName = 'MOOConfiguratorAlfajores';

async function deployContract() {
  const ContractFactory = await hre.ethers.getContractFactory(contractFactoryName);
  const contract = await ContractFactory.deploy();

  await contract.deployed();

  console.log('Deployed to:', contract.address);
}

deployContract()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
