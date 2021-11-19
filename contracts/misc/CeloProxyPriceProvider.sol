pragma solidity 0.6.12;

import "@openzeppelin/contracts/math/SafeMath.sol";
import "../dependencies/openzeppelin/contracts/Ownable.sol";

import "../interfaces/IPriceOracleGetter.sol";
import "../interfaces/IPriceFeed.sol";

/// @title CeloProxyPriceProvider
/// @author Moola
/// @notice Proxy smart contract to get the price of an asset from a price source, with Celo SortedOracles
///         smart contracts as primary option
/// - If the returned price by a SortedOracles is <= 0, the call is forwarded to a fallbackOracle
/// - Owned by the Aave governance system, allowed to add sources for assets, replace them
///   and change the fallbackOracle
contract CeloProxyPriceProvider is IPriceOracleGetter, Ownable {
    using SafeMath for uint256;

    mapping(address => address) internal priceFeeds;

    constructor(address[] memory _assets, address[] memory _priceFeeds) public {
        updateAssets(_assets, _priceFeeds);
    }

    function updateAssets(address[] memory _assets, address[] memory _priceFeeds) public onlyOwner {

        require(
            _assets.length == _priceFeeds.length,
            "the quantity does not match"
        );

        for (uint256 i = 0; i < _assets.length; i++) {
            priceFeeds[_assets[i]] = _priceFeeds[i];
        }
    }

    /// @notice Gets an asset price by address
    /// @param _asset The asset address
    function getAssetPrice(address _asset) public view override returns (uint256) {
        if (_asset == 0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE) {
            return 1 ether;
        }

        return (IPriceFeed(priceFeeds[_asset]).consult());
    }

    /// @notice Gets a list of prices from a list of assets addresses
    /// @param _assets The list of assets addresses
    function getAssetsPrices(address[] memory _assets)
        public
        view
        returns (uint256[] memory)
    {
        uint256[] memory prices = new uint256[](_assets.length);
        for (uint256 i = 0; i < _assets.length; i++) {
            prices[i] = getAssetPrice(_assets[i]);
        }

        return prices;
    }

    /// @notice Gets the address of the fallback oracle
    /// @return address The addres of the fallback oracle
    function getPriceFeed(address _asset) public view returns (address) {
        return (priceFeeds[_asset]);
    }
}
