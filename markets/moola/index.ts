import { oneRay, ZERO_ADDRESS } from '../../helpers/constants';
import { IMoolaConfiguration, eCeloNetwork } from '../../helpers/types';

import { CommonsConfig } from './commons';
import {
  strategyCELO,
  strategyCUSD,
  strategyCEUR,
  strategyCREAL,
  strategyMOO,
} from './reservesConfigs';

// ----------------
// POOL--SPECIFIC PARAMS
// ----------------

export const MoolaConfig: IMoolaConfiguration = {
  ...CommonsConfig,
  MarketId: 'Moola genesis market',
  ProviderId: 1,
  ReservesConfig: {
    CELO: strategyCELO,
    CUSD: strategyCUSD,
    CEUR: strategyCEUR,
    CREAL: strategyCREAL,
    MOO: strategyMOO,
  },
  ReserveAssets: {
    [eCeloNetwork.celo]: {
      CELO: '0x471EcE3750Da237f93B8E339c536989b8978a438',
      CUSD: '0x765DE816845861e75A25fCA122bb6898B8B1282a',
      CEUR: '0xD8763CBa276a3738E6DE85b4b3bF5FDed6D6cA73',
      CREAL: '0xe8537a3d056DA446677B9E9d6c5dB704EaAb4787',
      MOO: '0x17700282592D6917F6A73D0bF8AcCf4D578c131e',
    },
    [eCeloNetwork.alfajores]: {
      CELO: '0xF194afDf50B03e69Bd7D057c1Aa9e10c9954E4C9',
      CUSD: '0x874069Fa1Eb16D44d622F2e0Ca25eeA172369bC1',
      CEUR: '0x10c892A6EC43a53E45D0B916B4b7D383B1b78C0F',
      CREAL: '0xE4D517785D091D3c54818832dB6094bcc2744545',
      MOO: '0x17700282592D6917F6A73D0bF8AcCf4D578c131e',
    },
  },
};

export default MoolaConfig;
