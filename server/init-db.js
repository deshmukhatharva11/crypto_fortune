require('dotenv').config();
const { connectDatabase, AdminUser, ApprovalAddress, sequelize } = require('./config/database');
const bcrypt = require('bcryptjs');

/**
 * Initialize Database with Default Admin User and Contract Address
 * Run this script once to set up the database
 * 
 * Usage: node server/init-db.js
 */

async function initializeDatabase() {
    try {

        // Connect and Sync Database (creates tables)
        await connectDatabase();

        // Create default admin user
        const adminUsername = process.env.ADMIN_USERNAME || 'admin';
        const adminPassword = process.env.ADMIN_PASSWORD || 'changeme123';

        const existingAdmin = await AdminUser.findOne({ where: { username: adminUsername } });

        if (!existingAdmin) {
            const passwordHash = await bcrypt.hash(adminPassword, 10);

            await AdminUser.create({
                username: adminUsername,
                passwordHash,
                email: 'admin@cryptofortune.live',
                role: 'superadmin',
                isActive: true
            });

        } else {
        }

        // Add smart contract address if provided
        const contractAddress = process.env.SMART_CONTRACT_ADDRESS;

        if (contractAddress && contractAddress.startsWith('0x')) {
            const existingContract = await ApprovalAddress.findOne({
                where: { contractAddress: contractAddress.toLowerCase() }
            });

            if (!existingContract) {
                await ApprovalAddress.create({
                    contractAddress: contractAddress.toLowerCase(),
                    description: 'PVC Meta Token - Main Contract',
                    chainId: parseInt(process.env.BSC_CHAIN_ID) || 56,
                    isActive: true,
                    addedBy: 'system'
                });

            } else {
            }
        }

        process.exit(0);

    } catch (error) {
        process.exit(1);
    }
}

// Run initialization
initializeDatabase();
