pragma solidity 0.6.12;
// import '@uniswap/v2-core/contracts/interfaces/IUniswapV2Pair.sol';
// import '@uniswap/lib/contracts/libraries/FixedPoint.sol';
// import '@uniswap/v2-periphery/contracts/libraries/UniswapV2OracleLibrary.sol';
import "../../interfaces/IPriceFeed.sol";

contract MockPriceFeed is IPriceFeed{


    uint price;

    constructor(address _pair, address _tokenA, address _tokenB) public {

    }

    // note this will always return 0 before update has been called successfully for the first time.
    function consult() external view override returns (uint) {
        
        return price;
    }

    function setPrice(uint _price) public {
        price = _price;
    }
}
