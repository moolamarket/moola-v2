const hre = require('hardhat');

// async function deployMockPriceOracle() {
//   const PriceOracle = await hre.ethers.getContractFactory('PriceOracle');
//   const oracle = await PriceOracle.deploy();

//   await oracle.deployed();

//   console.log('oracle deployed to:', oracle.address);
// }

// deployMockPriceOracle()
//   .then(() => process.exit(0))
//   .catch((error) => {
//     console.error(error);
//     process.exit(1); // 0x53fae7b3Be8d00bDa988324B80354AA306D3c65D
//   });

// async function deployMoolaOracle() {
//   const MoolaOracle = await hre.ethers.getContractFactory('MoolaOracle');
//   const mOracle = await MoolaOracle.deploy(
//     ['0x17700282592D6917F6A73D0bF8AcCf4D578c131e'],
//     ['0x53fae7b3Be8d00bDa988324B80354AA306D3c65D'],
//     '0x0000000000000000000000000000000000000000',
//     '0xF194afDf50B03e69Bd7D057c1Aa9e10c9954E4C9'
//   );

//   await mOracle.deployed();

//   console.log('MoolaOracle deployed to:', mOracle.address);
// }

// deployMoolaOracle()
//   .then(() => process.exit(0))
//   .catch((error) => {
//     console.error(error);
//     process.exit(1);
//   });

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
