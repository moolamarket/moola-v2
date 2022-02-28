pragma solidity 0.6.12;

import {Ownable} from '../dependencies/openzeppelin/contracts/Ownable.sol';
import {IUbeswapPriceFeed} from '../interfaces/IUbeswapPriceFeed.sol';

/// @title UbeswapPriceProvider
/// @author Moola
/// @notice A contract that maps asset to its Ubeswap price feed and provide a function to get aset price
contract UbeswapPriceProvider is IPriceOracleGetter, Ownable {
  mapping(address => IUbeswapPriceFeed) priceFeeds;

  event PriceFeedAdded(address asset, address priceFeed);
  event PriceFeedUpdated(address asset, address newPriceFeed);

  constructor() public {}

  function getAssetPrice(address _asset) external {}

  function addPriceFeed(address _asset, address _priceFeed) external onlyOwner {}

  function updatePriceFeed(address _asset, address _newPriceFeed) external onlyOwner {}
}
