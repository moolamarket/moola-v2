import BigNumber from 'bignumber.js';
import { oneEther, oneRay, RAY, ZERO_ADDRESS, MOCK_CHAINLINK_AGGREGATORS_PRICES } from '../../helpers/constants';
import { ICommonConfiguration, eEthereumNetwork, eCeloNetwork } from '../../helpers/types';

// ----------------
// PROTOCOL GLOBAL PARAMS
// ----------------

export const CommonsConfig: ICommonConfiguration = {
  MarketId: 'Commons',
  ATokenNamePrefix: 'Moola interest bearing',
  StableDebtTokenNamePrefix: 'Moola stable debt bearing',
  VariableDebtTokenNamePrefix: 'Moola variable debt bearing',
  SymbolPrefix: 'm',
  ProviderId: 0, // Overriden in index.ts
  ProtocolGlobalParams: {
    TokenDistributorPercentageBase: '10000',
    MockUsdPriceInWei: '223522000000000000',
    UsdAddress: '0x10F7Fc1F91Ba351f9C629c5947AD69bD03C05b96',
    NilAddress: '0x0000000000000000000000000000000000000000',
    OneAddress: '0x0000000000000000000000000000000000000001',
    AaveReferral: '0',
  },

  // ----------------
  // COMMON PROTOCOL PARAMS ACROSS POOLS AND NETWORKS
  // ----------------

  Mocks: {
    AllAssetsInitialPrices: {
      ...MOCK_CHAINLINK_AGGREGATORS_PRICES,
    },
  },
  // TODO: reorg alphabetically, checking the reason of tests failing
  LendingRateOracleRatesCommon: {
    CELO: {
      borrowRate: oneRay.multipliedBy(0.03).toFixed(),
    },
    CUSD: {
      borrowRate: oneRay.multipliedBy(0.039).toFixed(),
    },
    CEUR: {
      borrowRate: oneRay.multipliedBy(0.039).toFixed(),
    },
    MOO: {
      borrowRate: oneRay.multipliedBy(0.03).toFixed(),
    },
    UBE: {
      borrowRate: oneRay.multipliedBy(0.03).toFixed(),
    },
  },
  // ----------------
  // COMMON PROTOCOL ADDRESSES ACROSS POOLS
  // ----------------

  // If PoolAdmin/emergencyAdmin is set, will take priority over PoolAdminIndex/emergencyAdminIndex
  PoolAdmin: {
    [eCeloNetwork.celo]: undefined,
    [eCeloNetwork.alfajores]: undefined,
  },
  PoolAdminIndex: 0,
  EmergencyAdmin: {
    [eCeloNetwork.celo]: undefined,
    [eCeloNetwork.alfajores]: undefined,
  },
  EmergencyAdminIndex: 1,
  ProviderRegistry: {
    [eCeloNetwork.celo]: '',
    [eCeloNetwork.alfajores]: '',
  },
  ProviderRegistryOwner: {
    [eCeloNetwork.celo]: '0x643C574128c7C56A1835e021Ad0EcC2592E72624',
    [eCeloNetwork.alfajores]: '0x643C574128c7C56A1835e021Ad0EcC2592E72624',
  },
  LendingRateOracle: {
    [eCeloNetwork.celo]: '',
    [eCeloNetwork.alfajores]: '',
  },  
  LendingPoolCollateralManager: {
    [eCeloNetwork.celo]: '',
    [eCeloNetwork.alfajores]: '',
  },
  LendingPoolConfigurator: {
    [eCeloNetwork.celo]: '',
    [eCeloNetwork.alfajores]: '',
  },
  LendingPool: {
    [eCeloNetwork.celo]: '',
    [eCeloNetwork.alfajores]: '',
  },
  WethGateway: {
    [eCeloNetwork.celo]: '',
    [eCeloNetwork.alfajores]: '',
  },
  TokenDistributor: {
    [eCeloNetwork.celo]: '0x313bc86D3D6e86ba164B2B451cB0D9CfA7943e5c',
    [eCeloNetwork.alfajores]: '0x643C574128c7C56A1835e021Ad0EcC2592E72624',
  },
  AaveOracle: {
    [eCeloNetwork.celo]: '0x568547688121AA69bDEB8aEB662C321c5D7B98D0',
    [eCeloNetwork.alfajores]: '0x88A4a87eF224D8b1F463708D0CD62b17De593DAd',
  },
  FallbackOracle: {
    [eCeloNetwork.celo]: ZERO_ADDRESS,
    [eCeloNetwork.alfajores]: ZERO_ADDRESS,
  },
  ChainlinkAggregator: {
    [eCeloNetwork.celo]: {},
    [eCeloNetwork.alfajores]: {},
  },
  ReserveAssets: {
    [eCeloNetwork.celo]: {},
    [eCeloNetwork.alfajores]: {},
  },
  ReservesConfig: {},
  ATokenDomainSeparator: {
    [eCeloNetwork.celo]: '',
    [eCeloNetwork.alfajores]: '',
  },
  WETH: {
    [eCeloNetwork.celo]: '',
    [eCeloNetwork.alfajores]: '',
  },
  ReserveFactorTreasuryAddress: {
    [eCeloNetwork.celo]: '0x313bc86D3D6e86ba164B2B451cB0D9CfA7943e5c',
    [eCeloNetwork.alfajores]: '0x643C574128c7C56A1835e021Ad0EcC2592E72624',
  },
};
