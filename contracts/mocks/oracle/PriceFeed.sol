pragma solidity 0.6.12;
// import '@uniswap/v2-core/contracts/interfaces/IUniswapV2Pair.sol';
// import '@uniswap/lib/contracts/libraries/FixedPoint.sol';
// import '@uniswap/v2-periphery/contracts/libraries/UniswapV2OracleLibrary.sol';
import "../../interfaces/IPriceFeed.sol";

contract PriceFeed is IPriceFeed{
    //using FixedPoint for *;
    // address public pair;
    // uint public multiplier;
    // uint private priceLast;
    // uint public priceCumulativeLast;
    // uint32 public blockTimestampLast;

    // address public tokenA;
    // address public tokenB;
    // address public token0;

    uint price;

    constructor(address _pair, address _tokenA, address _tokenB) public {
        // pair = _pair;
        // tokenA = _tokenA;
        // tokenB = _tokenB;
        // (token0, ) = _tokenA < _tokenB
        //     ? (_tokenA, _tokenB)
        //     : (_tokenB, _tokenA);
    }

    function update() public returns(uint) {
        
        return price;
    }

    // note this will always return 0 before update has been called successfully for the first time.
    function consult() external view override returns (uint) {
        
        return price;
    }

    function setPrice(uint _price) public {
        price = _price;
    }
}
