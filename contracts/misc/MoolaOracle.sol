// SPDX-License-Identifier: MIT
pragma solidity 0.6.12;

import {Ownable} from '../dependencies/openzeppelin/contracts/Ownable.sol';
import {IERC20} from '../dependencies/openzeppelin/contracts/IERC20.sol';

import {ISlidingWindowOracle} from '../interfaces/ISlidingWindowOracle.sol';
import {IPriceOracleGetter} from '../interfaces/IPriceOracleGetter.sol';
import {SafeERC20} from '../dependencies/openzeppelin/contracts/SafeERC20.sol';

/// @title MoolaOracle
/// @author Moola
/// @notice Proxy smart contract to get the price of an asset from a price source, with UbeswapPriceFeed
///         and CeloProxyPriceProvider as options
/// - CeloProxyPriceProvider is used to provide CELO prices for cUSD, cEUR, cREAL.
/// - Other tokens are using UbeswapPriceFeed.
/// - If the returned price by the source is <= 0, the call is forwarded to a fallbackOracle
/// - Owned by the Moola governance system, allowed to add sources for assets, replace them
///   and change the fallbackOracle
contract MoolaOracle is IPriceOracleGetter, Ownable {
  using SafeERC20 for IERC20;

  event WethSet(address indexed weth);
  event CeloSet(address indexed celo);
  event AssetSourceUpdated(address indexed asset, address indexed source);
  event FallbackOracleUpdated(address indexed fallbackOracle);
  event CeloProxyAddressUpdated(address indexed celoProxyPriceProvider);

  mapping(address => address) private assetsSources;

  IPriceOracleGetter private fallbackOracle;
  IPriceOracleGetter private celoProxyPriceProvider;

  address public immutable WETH;
  address public immutable CELO;

  /// @notice Constructor
  /// @param _assets The addresses of the assets
  /// @param _sources The address of the source of each asset
  /// @param _celoProxyPriceProvider The address of the celo proxy price provider
  /// @param _fallbackOracle The address of the fallback oracle to use if the data of an aggregator is not consistent
  constructor(
    address[] memory _assets,
    address[] memory _sources,
    address _celoProxyPriceProvider,
    address _fallbackOracle,
    address _weth,
    address _celo
  ) public {
    internalSetCeloProxyPriceProvider(_celoProxyPriceProvider);
    internalSetFallbackOracle(_fallbackOracle);
    setAssetsSources(_assets, _sources);

    WETH = _weth;
    CELO = _celo;

    emit WethSet(_weth);
    emit CeloSet(_celo);
  }

  /// @notice External function called by the Moola governance to set or replace sources of assets
  /// @param _assets The addresses of the assets
  /// @param _sources The address of the source of each asset
  function setAssetSources(address[] calldata _assets, address[] calldata _sources)
    external
    onlyOwner
  {
    setAssetsSources(_assets, _sources);
  }

  /// @notice Sets the fallbackOracle
  /// - Callable only by the Moola governance
  /// @param _fallbackOracle The address of the fallbackOracle
  function setFallbackOracle(address _fallbackOracle) external onlyOwner {
    internalSetFallbackOracle(_fallbackOracle);
  }

  /// @notice Sets the celoProxyPriceProvider
  /// - Callable only by the Moola governance
  /// @param _celoProxyPriceProvider The address of the celoProxyPriceProvider
  function setCeloProxyPriceProvider(address _celoProxyPriceProvider) external onlyOwner {
    internalSetCeloProxyPriceProvider(_celoProxyPriceProvider);
  }

  /// @notice Internal function to set the sources for each asset
  /// @param _assets The addresses of the assets
  /// @param _sources The address of the source of each asset
  function setAssetsSources(address[] memory _assets, address[] memory _sources) internal {
    require(_assets.length == _sources.length, 'INCONSISTENT_PARAMS_LENGTH');
    for (uint256 i = 0; i < _assets.length; i++) {
      assetsSources[_assets[i]] = _sources[i];
      emit AssetSourceUpdated(_assets[i], _sources[i]);
    }
  }

  /// @notice Internal function to set the fallbackOracle
  /// @param _fallbackOracle The address of the fallbackOracle
  function internalSetFallbackOracle(address _fallbackOracle) internal {
    fallbackOracle = IPriceOracleGetter(_fallbackOracle);
    emit FallbackOracleUpdated(_fallbackOracle);
  }

  /// @notice Internal function to set the celoProxyPriceProvider
  /// @param _celoProxyPriceProvider The address of the celoProxyPriceProvider
  function internalSetCeloProxyPriceProvider(address _celoProxyPriceProvider) internal {
    celoProxyPriceProvider = IPriceOracleGetter(_celoProxyPriceProvider);
    emit CeloProxyAddressUpdated(_celoProxyPriceProvider);
  }

  /// @notice Gets an asset price by address
  /// @param _asset The asset address
  function getAssetPrice(address _asset) public view override returns (uint256) {
    if (_asset == WETH || _asset == CELO) {
      return 1 ether;
    }

    address source = assetsSources[_asset];

    if (source == address(0)) {
      return fallbackOracle.getAssetPrice(_asset);
    }

    if (source == address(celoProxyPriceProvider)) {
      return celoProxyPriceProvider.getAssetPrice(_asset);
    }

    uint256 price = ISlidingWindowOracle(source).consult(_asset, 1, CELO);

    if (price > 0) {
      return price;
    }

    return fallbackOracle.getAssetPrice(_asset);
  }

  /// @notice Gets a list of prices from a list of assets addresses
  /// @param _assets The list of assets addresses
  function getAssetsPrices(address[] calldata _assets) external view returns (uint256[] memory) {
    uint256[] memory prices = new uint256[](_assets.length);
    for (uint256 i = 0; i < _assets.length; i++) {
      prices[i] = getAssetPrice(_assets[i]);
    }
    return prices;
  }

  /// @notice Gets the address of the source for an asset address
  /// @param _assets The address of the asset
  /// @return address The address of the source
  function getSourceOfAsset(address _assets) external view returns (address) {
    return address(assetsSources[_assets]);
  }

  /// @notice Gets the address of the fallback oracle
  /// @return address The addres of the fallback oracle
  function getFallbackOracle() external view returns (address) {
    return address(fallbackOracle);
  }

  /// @notice Gets the address of the celo proxy price provider
  /// @return address The addres of the celo proxy price provider
  function getCeloProxyPriceProvider() external view returns (address) {
    return address(celoProxyPriceProvider);
  }
}
