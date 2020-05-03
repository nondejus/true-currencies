pragma solidity ^0.5.13;

import "openzeppelin-solidity/contracts/math/SafeMath.sol";
import "@trusttoken/registry/contracts/Registry.sol";
import "../HasOwner.sol";
import "../CompliantDepositTokenWithHook.sol";
import "../Proxy/OwnedUpgradeabilityProxy.sol";
import "../TrueRewardBackedToken.sol";
import "../TrueUSD.sol";

/** @title TokenController
@dev This contract allows us to split ownership of the TrueUSD contract
into two addresses. One, called the "owner" address, has unfettered control of the TrueUSD contract -
it can mint new tokens, transfer ownership of the contract, etc. However to make
extra sure that TrueUSD is never compromised, this owner key will not be used in
day-to-day operations, allowing it to be stored at a heightened level of security.
Instead, the owner appoints an various "admin" address.
There are 3 different types of admin addresses;  MintKey, MintRatifier, and MintPauser.
MintKey can request and revoke mints one at a time.
MintPausers can pause individual mints or pause all mints.
MintRatifiers can approve and finalize mints with enough approval.

There are three levels of mints: instant mint, ratified mint, and multiSig mint. Each have a different threshold
and deduct from a different pool.
Instant mint has the lowest threshold and finalizes instantly without any ratifiers. Deduct from instant mint pool,
which can be refilled by one ratifier.
Ratify mint has the second lowest threshold and finalizes with one ratifier approval. Deduct from ratify mint pool,
which can be refilled by three ratifiers.
MultiSig mint has the highest threshold and finalizes with three ratifier approvals. Deduct from multiSig mint pool,
which can only be refilled by the owner.
*/

contract TokenController {
    using SafeMath for uint256;

    struct MintOperation {
        address to;
        uint256 value;
        uint256 requestedBlock;
        uint256 numberOfApproval;
        bool paused;
        mapping(address => bool) approved;
    }

    address payable public owner;
    address payable public pendingOwner;

    bool public initialized;

    uint256 public instantMintThreshold;
    uint256 public ratifiedMintThreshold;
    uint256 public multiSigMintThreshold;


    uint256 public instantMintLimit;
    uint256 public ratifiedMintLimit;
    uint256 public multiSigMintLimit;

    uint256 public instantMintPool;
    uint256 public ratifiedMintPool;
    uint256 public multiSigMintPool;
    address[2] public ratifiedPoolRefillApprovals;

    uint8 constant public RATIFY_MINT_SIGS = 1; //number of approvals needed to finalize a Ratified Mint
    uint8 constant public MULTISIG_MINT_SIGS = 3; //number of approvals needed to finalize a MultiSig Mint

    bool public mintPaused;
    uint256 public mintReqInvalidBeforeThisBlock; //all mint request before this block are invalid
    address public mintKey;
    MintOperation[] public mintOperations; //list of a mint requests

    TrueRewardBackedToken public token;
    Registry public registry;
    address public fastPause;
    address public trueRewardManager;

    bytes32 constant public IS_MINT_PAUSER = "isTUSDMintPausers";
    bytes32 constant public IS_MINT_RATIFIER = "isTUSDMintRatifier";
    bytes32 constant public IS_REDEMPTION_ADMIN = "isTUSDRedemptionAdmin";

    address constant public PAUSED_IMPLEMENTATION = address(1); // ***To be changed the paused version of TrueUSD in Production

    modifier onlyFastPauseOrOwner() {
        require(msg.sender == fastPause || msg.sender == owner, "must be pauser or owner");
        _;
    }

    modifier onlyMintKeyOrOwner() {
        require(msg.sender == mintKey || msg.sender == owner, "must be mintKey or owner");
        _;
    }

    modifier onlyMintPauserOrOwner() {
        require(registry.hasAttribute(msg.sender, IS_MINT_PAUSER) || msg.sender == owner, "must be pauser or owner");
        _;
    }

    modifier onlyMintRatifierOrOwner() {
        require(registry.hasAttribute(msg.sender, IS_MINT_RATIFIER) || msg.sender == owner, "must be ratifier or owner");
        _;
    }

    modifier onlyOwnerOrRedemptionAdmin() {
        require(registry.hasAttribute(msg.sender, IS_REDEMPTION_ADMIN) || msg.sender == owner, "must be Redemption admin or owner");
        _;
    }

    modifier onlyTrueRewardManager() {
        require(msg.sender == trueRewardManager, "must be trueRewardManager");
        _;
    }


    //mint operations by the mintkey cannot be processed on when mints are paused
    modifier mintNotPaused() {
        if (msg.sender != owner) {
            require(!mintPaused, "minting is paused");
        }
        _;
    }
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event NewOwnerPending(address indexed currentOwner, address indexed pendingOwner);
    event SetRegistry(address indexed registry);
    event TransferChild(address indexed child, address indexed newOwner);
    event RequestReclaimContract(address indexed other);
    event SetToken(TrueUSD newContract);

    event RequestMint(address indexed to, uint256 indexed value, uint256 opIndex, address mintKey);
    event FinalizeMint(address indexed to, uint256 indexed value, uint256 opIndex, address mintKey);
    event InstantMint(address indexed to, uint256 indexed value, address indexed mintKey);

    event TransferMintKey(address indexed previousMintKey, address indexed newMintKey);
    event MintRatified(uint256 indexed opIndex, address indexed ratifier);
    event RevokeMint(uint256 opIndex);
    event AllMintsPaused(bool status);
    event MintPaused(uint opIndex, bool status);
    event MintApproved(address approver, uint opIndex);
    event FastPauseSet(address _newFastPause);

    event MintThresholdChanged(uint instant, uint ratified, uint multiSig);
    event MintLimitsChanged(uint instant, uint ratified, uint multiSig);
    event InstantPoolRefilled();
    event RatifyPoolRefilled();
    event MultiSigPoolRefilled();

    /*
    ========================================
    Ownership functions
    ========================================
    */

    function initialize() external {
        require(!initialized, "already initialized");
        owner = msg.sender;
        initialized = true;
    }

    /**
    * @dev Throws if called by any account other than the owner.
    */
    modifier onlyOwner() {
        require(msg.sender == owner, "only Owner");
        _;
    }

    /**
    * @dev Modifier throws if called by any account other than the pendingOwner.
    */
    modifier onlyPendingOwner() {
        require(msg.sender == pendingOwner);
        _;
    }

    /**
    * @dev Allows the current owner to set the pendingOwner address.
    * @param newOwner The address to transfer ownership to.
    */
    function transferOwnership(address payable newOwner) external onlyOwner {
        pendingOwner = newOwner;
        emit NewOwnerPending(address(owner), address(pendingOwner));
    }

    /**
    * @dev Allows the pendingOwner address to finalize the transfer.
    */
    function claimOwnership() external onlyPendingOwner {
        emit OwnershipTransferred(address(owner), address(pendingOwner));
        owner = pendingOwner;
        pendingOwner = address(0);
    }

    /*
    ========================================
    proxy functions
    ========================================
    */

    function transferTusdProxyOwnership(address _newOwner) external onlyOwner {
        OwnedUpgradeabilityProxy(address(uint160(address(token)))).transferProxyOwnership(_newOwner);
    }

    function claimTusdProxyOwnership() external onlyOwner {
        OwnedUpgradeabilityProxy(address(uint160(address(token)))).claimProxyOwnership();
    }

    function upgradeTusdProxyImplTo(address _implementation) external onlyOwner {
        OwnedUpgradeabilityProxy(address(uint160(address(token)))).upgradeTo(_implementation);
    }

    /*
    ========================================
    Minting functions
    ========================================
    */

    /**
     * @dev set the threshold for a mint to be considered an instant mint, ratify mint and multiSig mint
     Instant mint requires no approval, ratify mint requires 1 approval and multiSig mint requires 3 approvals
     */
    function setMintThresholds(uint256 _instant, uint256 _ratified, uint256 _multiSig) external onlyOwner {
        require(_instant <= _ratified && _ratified <= _multiSig);
        instantMintThreshold = _instant;
        ratifiedMintThreshold = _ratified;
        multiSigMintThreshold = _multiSig;
        emit MintThresholdChanged(_instant, _ratified, _multiSig);
    }


    /**
     * @dev set the limit of each mint pool. For example can only instant mint up to the instant mint pool limit
     before needing to refill
     */
    function setMintLimits(uint256 _instant, uint256 _ratified, uint256 _multiSig) external onlyOwner {
        require(_instant <= _ratified && _ratified <= _multiSig);
        instantMintLimit = _instant;
        if (instantMintPool > instantMintLimit) {
            instantMintPool = instantMintLimit;
        }
        ratifiedMintLimit = _ratified;
        if (ratifiedMintPool > ratifiedMintLimit) {
            ratifiedMintPool = ratifiedMintLimit;
        }
        multiSigMintLimit = _multiSig;
        if (multiSigMintPool > multiSigMintLimit) {
            multiSigMintPool = multiSigMintLimit;
        }
        emit MintLimitsChanged(_instant, _ratified, _multiSig);
    }

    /**
     * @dev Ratifier can refill instant mint pool
     */
    function refillInstantMintPool() external onlyMintRatifierOrOwner {
        ratifiedMintPool = ratifiedMintPool.sub(instantMintLimit.sub(instantMintPool));
        instantMintPool = instantMintLimit;
        emit InstantPoolRefilled();
    }

    /**
     * @dev Owner or 3 ratifiers can refill Ratified Mint Pool
     */
    function refillRatifiedMintPool() external onlyMintRatifierOrOwner {
        if (msg.sender != owner) {
            address[2] memory refillApprovals = ratifiedPoolRefillApprovals;
            require(msg.sender != refillApprovals[0] && msg.sender != refillApprovals[1]);
            if (refillApprovals[0] == address(0)) {
                ratifiedPoolRefillApprovals[0] = msg.sender;
                return;
            }
            if (refillApprovals[1] == address(0)) {
                ratifiedPoolRefillApprovals[1] = msg.sender;
                return;
            }
        }
        delete ratifiedPoolRefillApprovals; // clears the whole array
        multiSigMintPool = multiSigMintPool.sub(ratifiedMintLimit.sub(ratifiedMintPool));
        ratifiedMintPool = ratifiedMintLimit;
        emit RatifyPoolRefilled();
    }

    /**
     * @dev Owner can refill MultiSig Mint Pool
     */
    function refillMultiSigMintPool() external onlyOwner {
        multiSigMintPool = multiSigMintLimit;
        emit MultiSigPoolRefilled();
    }

    /**
     * @dev mintKey initiates a request to mint _value for account _to
     * @param _to the address to mint to
     * @param _value the amount requested
     */
    function requestMint(address _to, uint256 _value) external mintNotPaused onlyMintKeyOrOwner {
        MintOperation memory op = MintOperation(_to, _value, block.number, 0, false);
        emit RequestMint(_to, _value, mintOperations.length, msg.sender);
        mintOperations.push(op);
    }


    /**
     * @dev Instant mint without ratification if the amount is less than instantMintThreshold and instantMintPool
     * @param _to the address to mint to
     * @param _value the amount minted
     */
    function instantMint(address _to, uint256 _value) external mintNotPaused onlyMintKeyOrOwner {
        require(_value <= instantMintThreshold, "over the instant mint threshold");
        require(_value <= instantMintPool, "instant mint pool is dry");
        instantMintPool = instantMintPool.sub(_value);
        emit InstantMint(_to, _value, msg.sender);
        token.mint(_to, _value);
    }


    /**
     * @dev ratifier ratifies a request mint. If the number of ratifiers that signed off is greater than
     the number of approvals required, the request is finalized
     * @param _index the index of the requestMint to ratify
     * @param _to the address to mint to
     * @param _value the amount requested
     */
    function ratifyMint(uint256 _index, address _to, uint256 _value) external mintNotPaused onlyMintRatifierOrOwner {
        MintOperation memory op = mintOperations[_index];
        require(op.to == _to, "to address does not match");
        require(op.value == _value, "amount does not match");
        require(!mintOperations[_index].approved[msg.sender], "already approved");
        mintOperations[_index].approved[msg.sender] = true;
        mintOperations[_index].numberOfApproval = mintOperations[_index].numberOfApproval.add(1);
        emit MintRatified(_index, msg.sender);
        if (hasEnoughApproval(mintOperations[_index].numberOfApproval, _value)){
            finalizeMint(_index);
        }
    }

    /**
     * @dev finalize a mint request, mint the amount requested to the specified address
     @param _index of the request (visible in the RequestMint event accompanying the original request)
     */
    function finalizeMint(uint256 _index) public mintNotPaused {
        MintOperation memory op = mintOperations[_index];
        address to = op.to;
        uint256 value = op.value;
        if (msg.sender != owner) {
            require(canFinalize(_index));
            _subtractFromMintPool(value);
        }
        delete mintOperations[_index];
        token.mint(to, value);
        emit FinalizeMint(to, value, _index, msg.sender);
    }

    /**
     * assumption: only invoked when canFinalize
     */
    function _subtractFromMintPool(uint256 _value) internal {
        if (_value <= ratifiedMintPool && _value <= ratifiedMintThreshold) {
            ratifiedMintPool = ratifiedMintPool.sub(_value);
        } else {
            multiSigMintPool = multiSigMintPool.sub(_value);
        }
    }

    /**
     * @dev compute if the number of approvals is enough for a given mint amount
     */
    function hasEnoughApproval(uint256 _numberOfApproval, uint256 _value) public view returns (bool) {
        if (_value <= ratifiedMintPool && _value <= ratifiedMintThreshold) {
            if (_numberOfApproval >= RATIFY_MINT_SIGS){
                return true;
            }
        }
        if (_value <= multiSigMintPool && _value <= multiSigMintThreshold) {
            if (_numberOfApproval >= MULTISIG_MINT_SIGS){
                return true;
            }
        }
        if (msg.sender == owner) {
            return true;
        }
        return false;
    }

    /**
     * @dev compute if a mint request meets all the requirements to be finalized
     utility function for a front end
     */
    function canFinalize(uint256 _index) public view returns(bool) {
        MintOperation memory op = mintOperations[_index];
        require(op.requestedBlock > mintReqInvalidBeforeThisBlock, "this mint is invalid"); //also checks if request still exists
        require(!op.paused, "this mint is paused");
        require(hasEnoughApproval(op.numberOfApproval, op.value), "not enough approvals");
        return true;
    }

    /**
    *@dev revoke a mint request, Delete the mintOperation
    *@param index of the request (visible in the RequestMint event accompanying the original request)
    */
    function revokeMint(uint256 _index) external onlyMintKeyOrOwner {
        delete mintOperations[_index];
        emit RevokeMint(_index);
    }

    function mintOperationCount() public view returns (uint256) {
        return mintOperations.length;
    }

    /*
    ========================================
    Key management
    ========================================
    */

    /**
    *@dev Replace the current mintkey with new mintkey
    *@param _newMintKey address of the new mintKey
    */
    function transferMintKey(address _newMintKey) external onlyOwner {
        require(_newMintKey != address(0), "new mint key cannot be 0x0");
        emit TransferMintKey(mintKey, _newMintKey);
        mintKey = _newMintKey;
    }

    /*
    ========================================
    Mint Pausing
    ========================================
    */

    /**
    *@dev invalidates all mint request initiated before the current block
    */
    function invalidateAllPendingMints() external onlyOwner {
        mintReqInvalidBeforeThisBlock = block.number;
    }

    /**
    *@dev pause any further mint request and mint finalizations
    */
    function pauseMints() external onlyMintPauserOrOwner {
        mintPaused = true;
        emit AllMintsPaused(true);
    }

    /**
    *@dev unpause any further mint request and mint finalizations
    */
    function unpauseMints() external onlyOwner {
        mintPaused = false;
        emit AllMintsPaused(false);
    }

    /**
    *@dev pause a specific mint request
    *@param  _opIndex the index of the mint request the caller wants to pause
    */
    function pauseMint(uint _opIndex) external onlyMintPauserOrOwner {
        mintOperations[_opIndex].paused = true;
        emit MintPaused(_opIndex, true);
    }

    /**
    *@dev unpause a specific mint request
    *@param  _opIndex the index of the mint request the caller wants to unpause
    */
    function unpauseMint(uint _opIndex) external onlyOwner {
        mintOperations[_opIndex].paused = false;
        emit MintPaused(_opIndex, false);
    }

    /*
    ========================================
    set and claim contracts, administrative
    ========================================
    */


    /**
    *@dev Update this contract's token pointer to newContract (e.g. if the
    contract is upgraded)
    */
    function setToken(TrueUSD _newContract) external onlyOwner {
        token = _newContract;
        emit SetToken(_newContract);
    }

    /**
    *@dev Update this contract's registry pointer to _registry
    */
    function setRegistry(Registry _registry) external onlyOwner {
        registry = _registry;
        emit SetRegistry(address(registry));
    }

    /**
    *@dev Swap out token's permissions registry
    *@param _registry new registry for token
    */
    function setTokenRegistry(Registry _registry) external onlyOwner {
        token.setRegistry(_registry);
    }

    /**
    *@dev Claim ownership of an arbitrary HasOwner contract
    */
    function issueClaimOwnership(address _other) public onlyOwner {
        HasOwner other = HasOwner(_other);
        other.claimOwnership();
    }

    /**
    *@dev Transfer ownership of _child to _newOwner.
    Can be used e.g. to upgrade this TokenController contract.
    *@param _child contract that tokenController currently Owns
    *@param _newOwner new owner/pending owner of _child
    */
    function transferChild(HasOwner _child, address _newOwner) external onlyOwner {
        _child.transferOwnership(_newOwner);
        emit TransferChild(address(_child), _newOwner);
    }

    /**
    *@dev Transfer ownership of a contract from token to this TokenController.
    Can be used e.g. to reclaim balance sheet
    in order to transfer it to an upgraded TrueUSD contract.
    *@param _other address of the contract to claim ownership of
    */
    function requestReclaimContract(InstantiatableOwnable _other) public onlyOwner {
        token.reclaimContract(_other);
        emit RequestReclaimContract(address(_other));
    }

    /**
    *@dev send all ether in token address to the owner of tokenController
    */
    function requestReclaimEther() external onlyOwner {
        token.reclaimEther(owner);
    }

    /**
    *@dev transfer all tokens of a particular type in token address to the
    owner of tokenController
    *@param _token token address of the token to transfer
    */
    function requestReclaimToken(IERC20 _token) external onlyOwner {
        token.reclaimToken(_token, owner);
    }

    /**
    *@dev set new contract to which specified address can send eth to to quickly pause token
    *@param _newFastPause address of the new contract
    */
    function setFastPause(address _newFastPause) external onlyOwner {
        fastPause = _newFastPause;
        emit FastPauseSet(address(_newFastPause));
    }

    /**
    *@dev pause all pausable actions on TrueUSD, mints/burn/transfer/approve
    */
    function pauseToken() external onlyFastPauseOrOwner {
        OwnedUpgradeabilityProxy(address(uint160(address(token)))).upgradeTo(PAUSED_IMPLEMENTATION);
    }

    /**
    *@dev wipe balance of a blacklisted address
    *@param _blacklistedAddress address whose balance will be wiped
    */
    function wipeBlackListedTrueUSD(address _blacklistedAddress) external onlyOwner {
        token.wipeBlacklistedAccount(_blacklistedAddress);
    }

    /**
    *@dev Change the minimum and maximum amounts that TrueUSD users can
    burn to newMin and newMax
    *@param _min minimum amount user can burn at a time
    *@param _max maximum amount user can burn at a time
    */
    function setBurnBounds(uint256 _min, uint256 _max) external onlyOwner {
        token.setBurnBounds(_min, _max);
    }

    /**
    *@dev Owner can send ether balance in contract address
    *@param _to address to which the funds will be send to
    */
    function reclaimEther(address payable _to) external onlyOwner {
        _to.transfer(address(this).balance);
    }

    /**
    *@dev Owner can send erc20 token balance in contract address
    *@param _token address of the token to send
    *@param _to address to which the funds will be send to
    */
    function reclaimToken(IERC20 _token, address _to) external onlyOwner {
        uint256 balance = _token.balanceOf(address(this));
        _token.transfer(_to, balance);
    }

    /*
    ========================================
    Truereward
    ========================================
    */

    /**
     * @dev Sets the contract which has permissions to manage truerewards reserve
     * Controls access to reserve functions to allow providing liquidity
     */
    function setTrueRewardManager(address _newTrueRewardManager) external onlyOwner {
        trueRewardManager = _newTrueRewardManager;
    }

    /**
     * @dev Sets the contract which has permissions to manage truerewards reserve
     * Controls access to reserve functions to allow providing liquidity
     */
    function setOpportunityAddress(address _opportunityAddress) external onlyOwner {
        token.setOpportunityAddress(_opportunityAddress);
    }

    /**
     * @dev Withdraw all TrueCurrencies from reserve
     * @param _to address to withdraw to
     * @param _value amount to withdraw
     */
    function reserveWithdraw(address _to, uint256 _value) external onlyTrueRewardManager {
        token.reserveWithdraw(_to, _value);
    }

    /**
     * @dev Allow this contract to rebalance currency reserves
     * This is called when there is not enough money in opportunity reserve and we want
     * to get more opportunity tokens
     *
     * @param _value amount to exchange for opportunity rewardTokens
     */
    function opportunityReserveMint(uint256 _value) external onlyTrueRewardManager {
        token.opportunityReserveMint(_value);
    }

    /**
     * @dev Allow this contract to rebalance currency reserves
     * This is called when there is too much money in opportunity and we want
     * to get more TrueCurrency.
     *
     * @param _value amount of opportunity rewardTokens to redeem for TrueCurrency
     */
    function opportunityReserveRedeem(uint256 _value) external onlyTrueRewardManager {
        token.opportunityReserveRedeem(_value);
    }
}
