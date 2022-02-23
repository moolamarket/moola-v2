// SPDX-License-Identifier: MIT
pragma solidity 0.6.12;

interface ISlidingWindowOracle {
  function consult(
    address tokenIn,
    uint256 amountIn,
    address tokenOut
  ) external view returns (uint256 amountOut);

  function update(address tokenA, address tokenB) external;

  function periodSize() external view returns (uint256);
}
