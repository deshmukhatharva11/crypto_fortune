// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title CryptoFortune (CF)
 * @dev ERC-20 token with one-time claim system and 15-level referral rewards.
 *      Referral rewards accumulate in pending balance — referrers claim manually.
 *      Deploy via Remix on BNB Smart Chain.
 */
contract CryptoFortune is ERC20, Ownable, ReentrancyGuard {

    // ─── Claim State ─────────────────────────────────────────
    mapping(address => bool) public hasClaimedOld;
    mapping(address => bool) public hasClaimedNew;

    // ─── Referral Chain ──────────────────────────────────────
    mapping(address => address) public referrers;
    mapping(address => bool) public hasReferrer;
    mapping(address => uint32) public directReferralCount;

    // ─── Referral Rewards (Pending Model) ────────────────────
    mapping(address => uint256) public pendingReferralRewards;
    mapping(address => uint256) public totalReferralEarned;
    mapping(address => uint256) public totalReferralClaimed;

    // ─── 15-Level Commission (in basis points, 10000 = 100%) ─
    // L1=25%, L2=10%, L3=8%, L4=7%, L5=6%, L6=5%, L7=4%,
    // L8=3%, L9=2%, L10=2%, L11=1.5%, L12=1.5%, L13=1%, L14=1%, L15=1%
    uint16[15] public referralBps = [
        2500, 1000, 800, 700, 600, 500, 400,
        300,  200,  200, 150, 150, 100, 100, 100
    ];

    uint256 public constant OLD_USER_AMOUNT = 300 * 10**18;
    uint256 public constant NEW_USER_AMOUNT = 100 * 10**18;

    // ─── Events ──────────────────────────────────────────────
    event TokensClaimed(address indexed user, uint256 amount, string claimType);
    event ReferralReward(address indexed referrer, address indexed user, uint256 amount, uint8 level);
    event ReferrerSet(address indexed user, address indexed referrer);
    event ReferralBonusClaimed(address indexed user, uint256 amount);
    event ReferralBpsUpdated(uint16[15] newBps);

    constructor(uint256 initialSupply) ERC20("Crypto Fortune", "CF") Ownable(msg.sender) {
        _mint(msg.sender, initialSupply * 10**18);
    }

    // ═══════════════════════════════════════════════════════════
    //  REFERRER REGISTRATION
    // ═══════════════════════════════════════════════════════════

    /**
     * @dev User sets their own referrer. One-time only.
     *      Prevents self-referral and circular chains.
     */
    function setReferrer(address referrer) external {
        _setReferrer(msg.sender, referrer);
    }

    /**
     * @dev Internal referrer setter — used by setReferrer() and claim functions.
     *      Silently skips if referrer is already set or invalid (no revert in claims).
     */
    function _setReferrer(address user, address referrer) internal {
        if (referrer == address(0)) return;
        if (user == referrer) return;  // self-referral
        if (hasReferrer[user]) return; // already set

        // Check for circular referral up to 15 levels
        address current = referrer;
        for (uint8 i = 0; i < 15; i++) {
            if (current == address(0)) break;
            if (current == user) return; // circular — silently skip
            current = referrers[current];
        }

        referrers[user] = referrer;
        hasReferrer[user] = true;
        directReferralCount[referrer] += 1;
        emit ReferrerSet(user, referrer);
    }

    // ═══════════════════════════════════════════════════════════
    //  TOKEN CLAIMS (Old / New User)
    // ═══════════════════════════════════════════════════════════

    /**
     * @dev User claims old user tokens. One-time only.
     *      Optionally sets referrer in the same TX (pass address(0) to skip).
     */
    function claimOldUser(address referrer) external nonReentrant {
        require(!hasClaimedOld[msg.sender], "CF: already claimed old");
        require(balanceOf(address(this)) >= OLD_USER_AMOUNT, "CF: insufficient balance");

        // Set referrer if provided (silently skips if invalid or already set)
        _setReferrer(msg.sender, referrer);

        hasClaimedOld[msg.sender] = true;
        _transfer(address(this), msg.sender, OLD_USER_AMOUNT);

        if (hasReferrer[msg.sender]) {
            _distributeReferralRewards(msg.sender, OLD_USER_AMOUNT);
        }
        emit TokensClaimed(msg.sender, OLD_USER_AMOUNT, "old");
    }

    /**
     * @dev User claims new user tokens. One-time only.
     *      Optionally sets referrer in the same TX (pass address(0) to skip).
     */
    function claimNewUser(address referrer) external nonReentrant {
        require(!hasClaimedNew[msg.sender], "CF: already claimed new");
        require(balanceOf(address(this)) >= NEW_USER_AMOUNT, "CF: insufficient balance");

        _setReferrer(msg.sender, referrer);

        hasClaimedNew[msg.sender] = true;
        _transfer(address(this), msg.sender, NEW_USER_AMOUNT);

        if (hasReferrer[msg.sender]) {
            _distributeReferralRewards(msg.sender, NEW_USER_AMOUNT);
        }
        emit TokensClaimed(msg.sender, NEW_USER_AMOUNT, "new");
    }

    // ═══════════════════════════════════════════════════════════
    //  REFERRAL REWARD DISTRIBUTION (Pending Model)
    // ═══════════════════════════════════════════════════════════

    /**
     * @dev Accumulates referral rewards in pending balance instead of
     *      transferring immediately. This saves gas on the claimer's TX
     *      and lets referrers batch-claim when they want.
     *
     *      Note: We do NOT check contract balance here because tokens
     *      are not transferred yet — they stay in the contract until
     *      the referrer calls claimReferralBonus().
     */
    function _distributeReferralRewards(address user, uint256 baseAmount) internal {
        address current = referrers[user];
        for (uint8 level = 0; level < 15; level++) {
            if (current == address(0)) break;
            uint256 reward = (baseAmount * referralBps[level]) / 10000;
            if (reward > 0) {
                pendingReferralRewards[current] += reward;
                totalReferralEarned[current] += reward;
                emit ReferralReward(current, user, reward, level + 1);
            }
            current = referrers[current];
        }
    }

    // ═══════════════════════════════════════════════════════════
    //  CLAIM REFERRAL BONUS
    // ═══════════════════════════════════════════════════════════

    /**
     * @dev Referrer claims their accumulated referral bonus.
     *      Uses checks-effects-interactions pattern for reentrancy safety.
     */
    function claimReferralBonus() external nonReentrant {
        uint256 amount = pendingReferralRewards[msg.sender];
        require(amount > 0, "CF: no pending bonus");
        require(balanceOf(address(this)) >= amount, "CF: insufficient contract balance");

        // Effects first (CEI pattern)
        pendingReferralRewards[msg.sender] = 0;
        totalReferralClaimed[msg.sender] += amount;

        // Interaction
        _transfer(address(this), msg.sender, amount);

        emit ReferralBonusClaimed(msg.sender, amount);
    }

    // ═══════════════════════════════════════════════════════════
    //  VIEW FUNCTIONS
    // ═══════════════════════════════════════════════════════════

    /**
     * @dev Returns complete referral info for a user in a single call.
     */
    function getReferralInfo(address user) external view returns (
        uint256 pending,
        uint256 earned,
        uint256 claimed,
        uint32 directRefs,
        address referrer
    ) {
        return (
            pendingReferralRewards[user],
            totalReferralEarned[user],
            totalReferralClaimed[user],
            directReferralCount[user],
            referrers[user]
        );
    }

    function getClaimStatus(address user) external view returns (
        bool oldClaimed, bool newClaimed, address referrer
    ) {
        return (hasClaimedOld[user], hasClaimedNew[user], referrers[user]);
    }

    function getReferralChain(address user) external view returns (address[15] memory chain) {
        address current = referrers[user];
        for (uint8 i = 0; i < 15; i++) {
            if (current == address(0)) break;
            chain[i] = current;
            current = referrers[current];
        }
    }

    // ═══════════════════════════════════════════════════════════
    //  OWNER FUNCTIONS
    // ═══════════════════════════════════════════════════════════

    /**
     * @dev Owner can update referral commission percentages.
     */
    function updateReferralBps(uint16[15] calldata newBps) external onlyOwner {
        // Validate total doesn't exceed 100%
        uint256 total = 0;
        for (uint8 i = 0; i < 15; i++) {
            total += newBps[i];
        }
        require(total <= 10000, "CF: total bps exceeds 100%");

        referralBps = newBps;
        emit ReferralBpsUpdated(newBps);
    }

    function fundContract(uint256 amount) external onlyOwner {
        require(amount > 0, "CF: zero amount");
        _transfer(msg.sender, address(this), amount);
    }

    function withdrawTokens(uint256 amount) external onlyOwner {
        require(amount > 0, "CF: zero amount");
        require(balanceOf(address(this)) >= amount, "CF: insufficient balance");
        _transfer(address(this), msg.sender, amount);
    }

    receive() external payable {
        revert("CF: no BNB accepted");
    }
}
