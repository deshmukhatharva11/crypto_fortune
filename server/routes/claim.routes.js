const express = require('express');
const router = express.Router();
const { ethers } = require('ethers');

// CF Token ABI — read-only functions for backend status checks
// + write functions returned to frontend for direct wallet calls
const CF_ABI = [
    "function hasClaimedOld(address) view returns (bool)",
    "function hasClaimedNew(address) view returns (bool)",
    "function hasReferrer(address) view returns (bool)",
    "function referrers(address) view returns (address)",
    "function getClaimStatus(address) view returns (bool oldClaimed, bool newClaimed, address referrer)",
    "function getReferralChain(address) view returns (address[15])",
    "function getReferralInfo(address) view returns (uint256 pending, uint256 earned, uint256 claimed, uint32 directRefs, address referrer)",
    "function pendingReferralRewards(address) view returns (uint256)",
    "function totalReferralEarned(address) view returns (uint256)",
    "function totalReferralClaimed(address) view returns (uint256)",
    "function directReferralCount(address) view returns (uint32)",
    "function setReferrer(address referrer)",
    "function claimOldUser(address referrer)",
    "function claimNewUser(address referrer)",
    "function claimReferralBonus()",
    "function balanceOf(address) view returns (uint256)",
    "event TokensClaimed(address indexed user, uint256 amount, string claimType)",
    "event ReferralReward(address indexed referrer, address indexed user, uint256 amount, uint8 level)",
    "event ReferrerSet(address indexed user, address indexed referrer)",
    "event ReferralBonusClaimed(address indexed user, uint256 amount)"
];

// Get read-only provider (no private key needed)
function getProvider() {
    const rpcUrl = process.env.BSC_RPC_URL || 'https://bsc-dataseed1.binance.org/';
    return new ethers.JsonRpcProvider(rpcUrl);
}

function getCFContract() {
    const cfAddress = process.env.CF_TOKEN_ADDRESS;
    if (!cfAddress || cfAddress === '0x_PLACEHOLDER_DEPLOY_FIRST') {
        throw new Error('CF_TOKEN_ADDRESS not configured. Deploy the contract first.');
    }
    return new ethers.Contract(cfAddress, CF_ABI, getProvider());
}

/**
 * GET /api/claims/status/:address
 * Check claim status for a wallet (read-only, no private key needed)
 */
router.get('/status/:address', async (req, res) => {
    try {
        const { address } = req.params;
        if (!/^0x[a-fA-F0-9]{40}$/i.test(address)) {
            return res.status(400).json({ success: false, message: 'Invalid address' });
        }

        const cf = getCFContract();
        const [oldClaimed, newClaimed, referrer] = await cf.getClaimStatus(address);

        res.json({
            success: true,
            oldClaimed,
            newClaimed,
            referrer,
            hasReferrer: referrer !== ethers.ZeroAddress
        });
    } catch (error) {
        console.error('Claim status error:', error.message);
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * GET /api/claims/referral-info/:address
 * Returns full referral info: pending rewards, total earned, total claimed,
 * direct referral count, and referrer address — all from on-chain data.
 */
router.get('/referral-info/:address', async (req, res) => {
    try {
        const { address } = req.params;
        if (!/^0x[a-fA-F0-9]{40}$/i.test(address)) {
            return res.status(400).json({ success: false, message: 'Invalid address' });
        }

        const cf = getCFContract();
        const [pending, earned, claimed, directRefs, referrer] = await cf.getReferralInfo(address);

        res.json({
            success: true,
            pendingRewards: ethers.formatEther(pending),
            totalEarned: ethers.formatEther(earned),
            totalClaimed: ethers.formatEther(claimed),
            directReferrals: Number(directRefs),
            referrer: referrer,
            hasReferrer: referrer !== ethers.ZeroAddress,
            pendingRewardsWei: pending.toString(),
            totalEarnedWei: earned.toString(),
            totalClaimedWei: claimed.toString()
        });
    } catch (error) {
        console.error('Referral info error:', error.message);
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * GET /api/claims/config
 * Return CF token contract address + ABI for frontend direct wallet calls
 */
router.get('/config', (req, res) => {
    res.json({
        success: true,
        cfTokenAddress: process.env.CF_TOKEN_ADDRESS || null,
        chainId: process.env.BSC_CHAIN_ID || '56',
        abi: CF_ABI
    });
});

module.exports = router;
