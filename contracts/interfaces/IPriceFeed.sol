pragma solidity 0.6.12;

/************
@title IPriceFeed interface
@notice Interface for the Aave price oracle.*/
interface IPriceFeed {

    // note this will always return 0 before update has been called successfully for the first time.
    function consult() external view returns (uint);

}