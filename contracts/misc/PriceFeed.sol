pragma solidity 0.6.12;

import '@openzeppelin/contracts/math/SafeMath.sol';
import '../interfaces/IPriceOracleGetter.sol';

interface ISortedOracles {
  function medianRate(address) external view returns (uint256, uint256);

  function medianTimestamp(address) external view returns (uint256);
}

interface IRegistry {
  function getAddressForOrDie(bytes32) external view returns (address);
}

contract PriceFeed {
  using SafeMath for uint256;

  IPriceOracleGetter private fallbackOracle;
  address private asset;
  IRegistry public constant registry = IRegistry(0x000000000000000000000000000000000000ce10);
  bytes32 constant SORTED_ORACLES_REGISTRY_ID = keccak256(abi.encodePacked('SortedOracles'));

  event FallbackOracleUpdated(address indexed fallbackOracle);

  constructor(address _asset, address _fallbackOracle) public {
    internalSetFallbackOracle(_fallbackOracle);
    asset = _asset;
  }

  function update() external returns (uint256) {
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

  function consult() external returns (uint256) {
    return this.update();
  }

  function internalSetFallbackOracle(address _fallbackOracle) internal {
    fallbackOracle = IPriceOracleGetter(_fallbackOracle);
    emit FallbackOracleUpdated(_fallbackOracle);
  }

  function getSortedOracles() internal view returns (ISortedOracles) {
    return ISortedOracles(registry.getAddressForOrDie(SORTED_ORACLES_REGISTRY_ID));
  }
}
