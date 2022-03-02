const hre = require('hardhat');

async function deploy() {
  const RepaymentHelper = await hre.ethers.getContractFactory('RepaymentHelper');
  const helperContract = await RepaymentHelper.deploy('0xb3072f5F0d5e8B9036aEC29F37baB70E86EA0018');

  await helperContract.deployed();

  console.log('RepaymentHelper deployed to:', helperContract.address);
}

deploy()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
