pragma solidity ^0.5.13;

import "./AssuredFinancialOpportunity.sol";

contract AssuredFinancialOpportunityReset is AssuredFinancialOpportunity {
    function reset() external onlyOwner {
        minTokenValue = 0;
    }
}
