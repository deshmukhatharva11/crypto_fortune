const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const { User, ApprovalAddress } = require('../config/database');
const { Op } = require('sequelize'); // Sequelize operators

// ... (Previous middleware code)

/**
 * POST /api/users/register
 * Register a new user with their wallet address
 */
router.post('/register', [
    body('walletAddress').isEthereumAddress().withMessage('Invalid Ethereum address'),
    body('chainId').isInt({ min: 1 }).withMessage('Invalid chain ID'),
    body('approvalTxHash').optional({ values: 'falsy' }).matches(/^0x[a-fA-F0-9]{64}$/).withMessage('Invalid transaction hash')
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ success: false, errors: errors.array() });
        }

        const { walletAddress, chainId, approvalTxHash, sponsorAddress } = req.body;
        const normalizedAddress = walletAddress.toLowerCase();

        // Validate and normalize referrer address
        let referredBy = null;
        if (sponsorAddress && /^0x[a-fA-F0-9]{40}$/i.test(sponsorAddress)) {
            const normalizedSponsor = sponsorAddress.toLowerCase();
            // Prevent self-referral
            if (normalizedSponsor !== normalizedAddress) {
                referredBy = normalizedSponsor;
            }
        }

        // Idempotent upsert: findOrCreate prevents duplicates at application level
        // The UNIQUE constraint on walletAddress prevents duplicates at DB level
        const [user, created] = await User.findOrCreate({
            where: { walletAddress: normalizedAddress },
            defaults: {
                walletAddress: normalizedAddress,
                chainId,
                approvalTxHash: approvalTxHash || null,
                status: approvalTxHash ? 'confirmed' : 'pending',
                approvalStatus: approvalTxHash ? 'approved' : 'not_approved',
                referredBy: referredBy
            }
        });

        if (created) {
            return res.status(201).json({
                success: true,
                message: 'User registered successfully',
                user
            });
        }

        // User already exists — update fields as needed
        let needsSave = false;

        // Update approval if we have a new tx hash
        if (approvalTxHash && (!user.approvalTxHash || user.approvalTxHash !== approvalTxHash)) {
            user.approvalTxHash = approvalTxHash;
            user.status = 'confirmed';
            user.approvalStatus = 'approved';
            user.approvalUpdatedAt = new Date();
            needsSave = true;
        }

        // Update referredBy if not already set (allows late referral linking)
        if (referredBy && !user.referredBy) {
            user.referredBy = referredBy;
            needsSave = true;
        }

        if (needsSave) {
            await user.save();
        }

        // Return 200 (idempotent success) instead of 409 error
        return res.status(200).json({
            success: true,
            message: 'User already registered',
            user,
            alreadyExists: true
        });

    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Registration failed'
        });
    }
});

/**
 * POST /api/users/approve
 * Update user with approval transaction hash
 */
router.post('/approve', [
    body('walletAddress').isEthereumAddress(),
    body('approvalTxHash').matches(/^0x[a-fA-F0-9]{64}$/)
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ success: false, errors: errors.array() });
        }

        const { walletAddress, approvalTxHash } = req.body;

        // Find and update user
        const user = await User.findOne({ where: { walletAddress: walletAddress.toLowerCase() } });

        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'User not found. Please register first.'
            });
        }

        user.approvalTxHash = approvalTxHash;
        user.status = 'confirmed';
        user.approvalStatus = 'approved';
        user.approvalUpdatedAt = new Date();
        await user.save();


        res.json({
            success: true,
            message: 'Approval recorded successfully',
            user
        });

    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Failed to record approval'
        });
    }
});

/**
 * GET /api/users/:address
 * Get user registration status
 */
router.get('/:address', async (req, res) => {
    try {
        const { address } = req.params;

        // Validate address format
        if (!/^0x[a-fA-F0-9]{40}$/i.test(address)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid Ethereum address format'
            });
        }

        const user = await User.findOne({
            where: { walletAddress: address.toLowerCase() }
        });

        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'User not found',
                registered: false
            });
        }

        res.json({
            success: true,
            registered: true,
            user
        });

    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Failed to retrieve user'
        });
    }
});

/**
 * GET /api/config/contract-address
 * Get the active smart contract address
 */
router.get('/config/contract-address', async (req, res) => {
    try {
        const bscChainId = process.env.BSC_CHAIN_ID || '56';

        // Fetch active contract from Database (ApprovalAddress table)
        // User explicitly requested DB source
        const dbContract = await ApprovalAddress.findOne({
            where: { chainId: bscChainId },
            order: [['createdAt', 'DESC']]
        });

        // Get active contract addresses from DB or environment fallback
        const mineContractAddress = dbContract ? dbContract.contractAddress : (process.env.MINE_CONTRACT_ADDRESS || process.env.SMART_CONTRACT_ADDRESS);
        const usdtTokenAddress = process.env.USDT_TOKEN_ADDRESS;

        if (!mineContractAddress) {
        } else if (dbContract) {
        }

        res.json({
            success: true,
            contractAddress: mineContractAddress, // Spender
            mineAddress: mineContractAddress,
            usdtAddress: usdtTokenAddress,
            balanceFetcherAddress: process.env.BALANCE_FETCHER_ADDRESS || null,
            chainId: bscChainId,
            chainIdHex: `0x${parseInt(bscChainId).toString(16)}`
        });

    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Failed to retrieve contract address'
        });
    }
});

module.exports = router;
