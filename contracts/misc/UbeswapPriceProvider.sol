pragma solidity 0.6.12;

import {Ownable} from '../dependencies/openzeppelin/contracts/Ownable.sol';
import {IUbeswapPriceFeed} from '../interfaces/IUbeswapPriceFeed.sol';
import {IPriceOracleGetter} from '../interfaces/IPriceOracleGetter.sol';

/// @title UbeswapPriceProvider
/// @author Moola
/// @notice A contract that maps asset to its Ubeswap price feed and provide a function to get aset price
contract UbeswapPriceProvider is IPriceOracleGetter, Ownable {
  mapping(address => IUbeswapPriceFeed) private priceFeeds;

  event PriceFeedUpdated(address asset, address priceFeed);

  /// @notice Sets the price feed for an asset
  /// @param _asset The address of the asset
  /// @param _priceFeed The address of the price feed
  function updatePriceFeed(address _asset, address _priceFeed) external onlyOwner {
    priceFeeds[_asset] = IUbeswapPriceFeed(_priceFeed);
    emit PriceFeedUpdated(_asset, _priceFeed);
  }

  /// @notice Gets the address of the price feed for an asset address
  /// @param _asset The address of the asset
  /// @return address The address of the price feed
  function getPriceFeed(address _asset) external view returns (address) {
    return address(priceFeeds[_asset]);
  }

  /// @notice Gets an asset price by address
  /// @param _asset The address of the asset
  /// @return The price of the asset
  function getAssetPrice(address _asset) public view override returns (uint256) {
    return IUbeswapPriceFeed(priceFeeds[_asset]).consult();
  }
}
