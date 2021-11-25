pragma solidity 0.6.12;

import "../../interfaces/IRegistry.sol";

contract MockRegistry is IRegistry{


    address _address;

    constructor(address __address) public {
        _address = __address;
    }

    function getAddressForOrDie(bytes32) external view override returns (address) {
        return _address;
    }
}