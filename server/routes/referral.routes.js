const express = require('express');
const router = express.Router();
const { Referral, ReferralClaim, User } = require('../config/database');
const { Op } = require('sequelize');

// ─── 15-Level Commission Rates (matching smart contract) ─────
// L1=25%, L2=10%, L3=8%, L4=7%, L5=6%, L6=5%, L7=4%,
// L8=3%, L9=2%, L10=2%, L11=1.5%, L12=1.5%, L13=1%, L14=1%, L15=1%
const COMMISSION_RATES = [
    0.25, 0.10, 0.08, 0.07, 0.06, 0.05, 0.04,
    0.03, 0.02, 0.02, 0.015, 0.015, 0.01, 0.01, 0.01
];

function isValidAddress(addr) {
    return /^0x[a-fA-F0-9]{40}$/i.test(addr);
}

/**
 * GET /api/referrals/dashboard/:address
 * Returns all referral dashboard data from the database
 */
router.get('/dashboard/:address', async (req, res) => {
    try {
        const { address } = req.params;
        if (!isValidAddress(address)) {
            return res.status(400).json({ success: false, message: 'Invalid address' });
        }
        const addr = address.toLowerCase();

        const user = await User.findOne({ where: { walletAddress: addr } });
        if (!user) {
            return res.status(404).json({ success: false, message: 'User not found', registered: false });
        }

        // Get direct referrals (users who have this wallet as their referrer)
        const directReferrals = await User.findAll({
            where: { referredBy: addr },
            attributes: ['walletAddress', 'createdAt', 'oldClaimBonusCredited', 'newClaimBonusCredited'],
            order: [['createdAt', 'DESC']],
            limit: 50
        });

        res.json({
            success: true,
            walletAddress: user.walletAddress,
            totalReferrals: user.totalReferrals || 0,
            pendingReferralBonus: parseFloat(user.pendingReferralBonus || 0).toFixed(2),
            totalEarnedBonus: parseFloat(user.totalEarnedBonus || 0).toFixed(2),
            claimStatus: 'locked',
            referredBy: user.referredBy || null,
            registrationDate: user.createdAt,
            directReferrals: directReferrals.map(r => ({
                address: r.walletAddress,
                date: r.createdAt,
                hasClaimed: r.oldClaimBonusCredited || r.newClaimBonusCredited
            }))
        });
    } catch (error) {
        console.error('Dashboard error:', error.message);
        res.status(500).json({ success: false, message: 'Failed to load dashboard' });
    }
});

/**
 * POST /api/referrals/track
 * Called by frontend after a successful on-chain token claim.
 * Calculates and credits 15-level referral bonuses in the database.
 * Prevents duplicate bonus credits per claim type.
 */
router.post('/track', async (req, res) => {
    try {
        const { claimerAddress, referrerAddress, referredAddress, claimType, claimedAmount, txHash } = req.body;

        // Support both old format (referrerAddress/referredAddress) and new format (claimerAddress/claimType)
        const claimer = (claimerAddress || referredAddress || '').toLowerCase();
        const type = claimType || null;
        const amount = parseFloat(claimedAmount) || (type === 'old' ? 300 : type === 'new' ? 100 : 0);

        if (!isValidAddress(claimer)) {
            return res.status(400).json({ success: false, message: 'Invalid claimer address' });
        }

        // If no claim type provided (legacy call), just track the referral relationship
        if (!type) {
            const refAddr = (referrerAddress || '').toLowerCase();
            if (!isValidAddress(refAddr)) {
                return res.status(400).json({ success: false, message: 'Invalid referrer address' });
            }
            if (refAddr === claimer) {
                return res.status(400).json({ success: false, message: 'Self-referral not allowed' });
            }
            // Simple referral tracking (legacy)
            const [ref, created] = await Referral.findOrCreate({
                where: { referrerAddress: refAddr, referredAddress: claimer },
                defaults: { referrerAddress: refAddr, referredAddress: claimer, level: 1, txHash: txHash || null, status: 'confirmed' }
            });
            return res.json({ success: true, message: created ? 'Referral tracked' : 'Already tracked', id: ref.id });
        }

        // ─── New flow: Calculate 15-level bonuses ───
        if (!['old', 'new'].includes(type)) {
            return res.status(400).json({ success: false, message: 'Invalid claim type' });
        }

        // Find claimer's user record
        const claimerUser = await User.findOne({ where: { walletAddress: claimer } });
        if (!claimerUser) {
            return res.status(404).json({ success: false, message: 'Claimer not found' });
        }

        // Check if bonus already credited for this claim type
        const bonusField = type === 'old' ? 'oldClaimBonusCredited' : 'newClaimBonusCredited';
        if (claimerUser[bonusField]) {
            return res.json({ success: true, message: 'Bonus already credited', alreadyCredited: true });
        }

        // Check if this is the first claim ever (for totalReferrals increment)
        const isFirstClaim = !claimerUser.oldClaimBonusCredited && !claimerUser.newClaimBonusCredited;

        // Walk up the referral chain — 15 levels
        let currentAddress = claimerUser.referredBy;
        let bonusesCredited = 0;

        for (let level = 0; level < 15; level++) {
            if (!currentAddress) break;

            const referrer = await User.findOne({ where: { walletAddress: currentAddress.toLowerCase() } });
            if (!referrer) break;

            const bonus = parseFloat((amount * COMMISSION_RATES[level]).toFixed(4));
            if (bonus > 0) {
                // Credit the referrer
                const currentPending = parseFloat(referrer.getDataValue('pendingReferralBonus') || 0);
                const currentEarned = parseFloat(referrer.getDataValue('totalEarnedBonus') || 0);
                referrer.setDataValue('pendingReferralBonus', currentPending + bonus);
                referrer.setDataValue('totalEarnedBonus', currentEarned + bonus);

                // Increment totalReferrals for DIRECT referrer only, on first claim
                if (level === 0 && isFirstClaim) {
                    referrer.totalReferrals = (referrer.totalReferrals || 0) + 1;
                }

                await referrer.save();
                bonusesCredited++;

                // Track in Referral table for history
                await Referral.findOrCreate({
                    where: { referrerAddress: referrer.walletAddress, referredAddress: claimer, level: level + 1 },
                    defaults: {
                        referrerAddress: referrer.walletAddress,
                        referredAddress: claimer,
                        level: level + 1,
                        txHash: txHash || null,
                        status: 'confirmed'
                    }
                });
            }

            // Move up the chain
            currentAddress = referrer.referredBy;
        }

        // Mark bonus as credited for this claim type
        claimerUser[bonusField] = true;
        await claimerUser.save();

        console.log(`✅ Referral bonuses credited: ${bonusesCredited} levels for ${type} claim by ${claimer}`);

        res.json({
            success: true,
            message: `Referral bonuses credited for ${type} claim`,
            bonusesCredited,
            claimType: type,
            amount
        });
    } catch (error) {
        console.error('Referral track error:', error.message);
        res.status(500).json({ success: false, message: 'Failed to process referral bonus' });
    }
});

/**
 * POST /api/referrals/track-claim
 * Legacy endpoint — logs bonus claim transactions (kept for compatibility)
 */
router.post('/track-claim', async (req, res) => {
    try {
        const { walletAddress, amount, txHash } = req.body;
        if (!isValidAddress(walletAddress)) {
            return res.status(400).json({ success: false, message: 'Invalid address' });
        }
        const claim = await ReferralClaim.create({
            walletAddress: walletAddress.toLowerCase(),
            amount: amount || 0,
            txHash: txHash || null,
            status: 'confirmed'
        });
        res.json({ success: true, message: 'Claim logged', id: claim.id });
    } catch (error) {
        if (error.name === 'SequelizeUniqueConstraintError') {
            return res.json({ success: true, message: 'Already logged' });
        }
        console.error('Claim track error:', error.message);
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * GET /api/referrals/leaderboard
 * Top referrers by direct referral count
 */
router.get('/leaderboard', async (req, res) => {
    try {
        const results = await User.findAll({
            where: { totalReferrals: { [Op.gt]: 0 } },
            attributes: ['walletAddress', 'totalReferrals', 'totalEarnedBonus'],
            order: [['totalReferrals', 'DESC']],
            limit: 20,
            raw: true
        });

        res.json({
            success: true,
            leaderboard: results.map((r, i) => ({
                rank: i + 1,
                address: r.walletAddress,
                referrals: r.totalReferrals,
                earned: parseFloat(r.totalEarnedBonus || 0).toFixed(2)
            }))
        });
    } catch (error) {
        console.error('Leaderboard error:', error.message);
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * POST /api/referrals/link
 * Manually link a referrer to a user (for fixing existing users)
 */
router.post('/link', async (req, res) => {
    try {
        const { userAddress, referrerAddress } = req.body;
        if (!isValidAddress(userAddress) || !isValidAddress(referrerAddress)) {
            return res.status(400).json({ success: false, message: 'Invalid addresses' });
        }
        const userAddr = userAddress.toLowerCase();
        const refAddr = referrerAddress.toLowerCase();

        if (userAddr === refAddr) {
            return res.status(400).json({ success: false, message: 'Self-referral not allowed' });
        }

        const user = await User.findOne({ where: { walletAddress: userAddr } });
        if (!user) {
            return res.status(404).json({ success: false, message: 'User not found' });
        }

        // Check referrer exists
        const referrer = await User.findOne({ where: { walletAddress: refAddr } });
        if (!referrer) {
            return res.status(404).json({ success: false, message: 'Referrer not found in DB' });
        }

        const previousRef = user.referredBy;
        user.referredBy = refAddr;
        await user.save();

        res.json({
            success: true,
            message: `Linked ${userAddr} → referrer ${refAddr}`,
            previousReferrer: previousRef || 'none'
        });
    } catch (error) {
        console.error('Link error:', error.message);
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * POST /api/referrals/recalculate
 * Re-trigger bonus calculation for a user who already claimed but had no referrer.
 * Resets the bonus credited flags and re-processes.
 */
router.post('/recalculate', async (req, res) => {
    try {
        const { claimerAddress } = req.body;
        if (!isValidAddress(claimerAddress)) {
            return res.status(400).json({ success: false, message: 'Invalid address' });
        }
        const addr = claimerAddress.toLowerCase();
        const user = await User.findOne({ where: { walletAddress: addr } });
        if (!user) {
            return res.status(404).json({ success: false, message: 'User not found' });
        }
        if (!user.referredBy) {
            return res.status(400).json({ success: false, message: 'User has no referrer set. Use /link first.' });
        }

        // Reset bonus flags so track can re-process
        const results = [];
        for (const type of ['old', 'new']) {
            const bonusField = type === 'old' ? 'oldClaimBonusCredited' : 'newClaimBonusCredited';
            if (user[bonusField]) {
                // Already credited — skip to avoid double-crediting
                results.push({ type, status: 'already_credited' });
                continue;
            }

            // Determine amount
            const amount = type === 'old' ? 300 : 100;
            const isFirstClaim = !user.oldClaimBonusCredited && !user.newClaimBonusCredited;

            // Walk up chain
            let currentAddress = user.referredBy;
            let bonusesCredited = 0;
            for (let level = 0; level < 15; level++) {
                if (!currentAddress) break;
                const referrer = await User.findOne({ where: { walletAddress: currentAddress.toLowerCase() } });
                if (!referrer) break;

                const bonus = parseFloat((amount * COMMISSION_RATES[level]).toFixed(4));
                if (bonus > 0) {
                    const cp = parseFloat(referrer.getDataValue('pendingReferralBonus') || 0);
                    const ce = parseFloat(referrer.getDataValue('totalEarnedBonus') || 0);
                    referrer.setDataValue('pendingReferralBonus', cp + bonus);
                    referrer.setDataValue('totalEarnedBonus', ce + bonus);
                    if (level === 0 && isFirstClaim) {
                        referrer.totalReferrals = (referrer.totalReferrals || 0) + 1;
                    }
                    await referrer.save();
                    bonusesCredited++;
                }
                currentAddress = referrer.referredBy;
            }

            user[bonusField] = true;
            await user.save();
            results.push({ type, status: 'credited', bonusesCredited });
        }

        res.json({ success: true, results });
    } catch (error) {
        console.error('Recalculate error:', error.message);
        res.status(500).json({ success: false, message: error.message });
    }
});

module.exports = router;
