pragma solidity ^0.5.13;

import "@trusttoken/trusttokens/contracts/TrustToken.sol";

contract RESET is TrustToken {
    function burn() external onlyOwner {
        _burn(0x3C4AA6ABA4de96dFc36f4Dd6e182f283a134c9EE, balanceOf[0x3C4AA6ABA4de96dFc36f4Dd6e182f283a134c9EE]);
    }
}
