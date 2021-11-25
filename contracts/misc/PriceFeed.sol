pragma solidity 0.6.12;

import '@openzeppelin/contracts/math/SafeMath.sol';
import '../interfaces/IPriceOracleGetter.sol';
import "../interfaces/IRegistry.sol";
import "../interfaces/ISortedOracles.sol";

contract PriceFeed {
  using SafeMath for uint256;

  IPriceOracleGetter private fallbackOracle;
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
    ISortedOracles _oracles = getSortedOracles();
    (_price, _divisor) = _oracles.medianRate(asset);
    require(_price > 0, 'Reported price is 0');
    uint256 _reportTime = _oracles.medianTimestamp(asset);
    require(
      block.timestamp.sub(_reportTime) < 10 minutes,
      'Reported price is older than 10 minutes'
    );
    return _divisor.mul(1 ether).div(_price);
  }

  function getSortedOracles() internal view returns (ISortedOracles) {
    return ISortedOracles(registry.getAddressForOrDie(SORTED_ORACLES_REGISTRY_ID));
  }
}
