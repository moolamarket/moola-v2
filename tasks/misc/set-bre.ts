import { task } from 'hardhat/config';
import { DRE, setDRE } from '../../helpers/misc-utils';
import { EthereumNetworkNames } from '../../helpers/types';
import { usingTenderly } from '../../helpers/tenderly-utils';
import { HardhatRuntimeEnvironment } from 'hardhat/types';
import { getFirstSigner } from '../../helpers/contracts-getters';
import { formatEther } from 'ethers/lib/utils';

task(`set-DRE`, `Inits the DRE, to have access to all the plugins' objects`).setAction(
  async (_, _DRE: HardhatRuntimeEnvironment) => {
    if (DRE) {
      return;
    }
    if (
      _DRE.network.name.includes('tenderly') ||
      process.env.TENDERLY === 'true'
    ) {
      const tDRE: any = _DRE;
      console.log('- Setting up Tenderly provider');
      if (process.env.TENDERLY_FORK_ID && process.env.TENDERLY_HEAD_ID) {
        console.log('- Connecting to a Tenderly Fork');
        tDRE.tenderlyRPC.setFork(process.env.TENDERLY_FORK_ID);
        tDRE.tenderlyRPC.setHead(process.env.TENDERLY_HEAD_ID);
      } else {
        console.log('- Creating a new Tenderly Fork');
        await tDRE.tenderlyRPC.initializeFork();
      }
      const provider = new _DRE.ethers.providers.Web3Provider(tDRE.tenderlyRPC as any);
      _DRE.ethers.provider = provider;
      console.log('- Initialized Tenderly fork:');
      console.log('  - Fork: ', tDRE.tenderlyRPC.getFork());
      console.log('  - Head: ', tDRE.tenderlyRPC.getHead());
      console.log('  - First account:', await (await _DRE.ethers.getSigners())[0].getAddress());
      console.log(
        '  - Balance:',
        formatEther(await (await _DRE.ethers.getSigners())[0].getBalance())
      );
    }

    setDRE(_DRE);
    return _DRE;
  }
);
