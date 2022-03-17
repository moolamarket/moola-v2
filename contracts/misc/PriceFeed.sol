pragma solidity 0.6.12;

import '@openzeppelin/contracts/math/SafeMath.sol';
import '../interfaces/IPriceOracleGetter.sol';
import '../interfaces/IRegistry.sol';
import '../interfaces/ISortedOracles.sol';

contract PriceFeed {
  using SafeMath for uint256;

  address private immutable asset;
  IRegistry public immutable registry;
  bytes32 constant SORTED_ORACLES_REGISTRY_ID = keccak256(abi.encodePacked('SortedOracles'));

  constructor(address _asset, address _registry) public {
    asset = _asset;
    registry = IRegistry(_registry);
  }

  function consult() external view returns (uint256) {
    uint256 _price;
    uint256 _divisor;
    bool _expired;
    ISortedOracles _oracles = getSortedOracles();
    (_price, _divisor) = _oracles.medianRate(asset);
    require(_price > 0, 'Reported price is 0');

    (_expired, ) = _oracles.isOldestReportExpired(asset);
    if (_expired) {
      // return 0 to trigger fallback
      return 0;
    }
    return _divisor.mul(1 ether).div(_price);
  }

  function getSortedOracles() internal view returns (ISortedOracles) {
    return ISortedOracles(registry.getAddressForOrDie(SORTED_ORACLES_REGISTRY_ID));
  }
}
