import { task } from 'hardhat/config';
import { ConfigNames } from '../../helpers/configuration';
import { printContracts } from '../../helpers/misc-utils';

task('moola:celo', 'Deploy development enviroment')
  .addFlag('verify', 'Do not set')
  .setAction(async ({ verify }, DRE) => {
    const POOL_NAME = ConfigNames.Moola;
    await DRE.run('set-DRE');

    console.log('Migration started\n');

    console.log('0. Deploy address provider registry');
    await DRE.run('full:deploy-address-provider-registry', { pool: POOL_NAME });

    console.log('1. Deploy address provider');
    await DRE.run('full:deploy-address-provider', { pool: POOL_NAME });

    console.log('2. Deploy lending pool');
    await DRE.run('full:deploy-lending-pool', { pool: POOL_NAME });

    console.log('3. Deploy oracles');
    await DRE.run('full:deploy-oracles', { pool: POOL_NAME });

    console.log('4. Deploy Data Provider');
    await DRE.run('full:data-provider', { pool: POOL_NAME });

    console.log('Skipping WethGateway');

    console.log('6. Initialize lending pool');
    await DRE.run('full:initialize-lending-pool', { pool: POOL_NAME });

    console.log('\nFinished migrations');
    printContracts();
  });
