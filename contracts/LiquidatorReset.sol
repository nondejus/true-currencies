pragma solidity ^0.5.13;

import "@trusttoken/trusttokens/contracts/Liquidator.sol";

contract LiquidatorReset is Liquidator {
    function resetUniswap() external {
        stakeUniswap_ = UniswapV1(0x8E047A3d6b49B92c648669943eEF3AB3009cBdB9);
        stakeToken().approve(address(stakeUniswapV1()), MAX_UINT);
    }
}
