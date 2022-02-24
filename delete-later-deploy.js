const hre = require('hardhat');

async function deployConfigurator() {
  const MOOConfigurator = await hre.ethers.getContractFactory('MOOConfiguratorAlfajores');
  const configurator = await MOOConfigurator.deploy();

  await configurator.deployed();

  console.log('MOOConfiguratorAlfajores deployed to:', configurator.address);
}

deployConfigurator()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
