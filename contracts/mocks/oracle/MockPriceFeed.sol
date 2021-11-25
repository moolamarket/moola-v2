pragma solidity 0.6.12;
import "../../interfaces/IPriceFeed.sol";

contract MockPriceFeed is IPriceFeed{
    uint price;

    constructor(address _pair, address _tokenA, address _tokenB) public {}

    function consult() external view override returns (uint) {
        
        return price;
    }

    function setPrice(uint _price) public {
        price = _price;
    }
}
