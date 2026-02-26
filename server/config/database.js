const { Sequelize, DataTypes } = require('sequelize');
const bcrypt = require('bcryptjs');
const dotenv = require('dotenv');

dotenv.config();

/**
 * PostgreSQL Database Connection and Schema Definitions using Sequelize
 */

// Initialize Sequelize
// Make sure to create the database first in PostgreSQL
const sequelize = new Sequelize(
    process.env.DB_NAME || 'crypto_fortune',
    process.env.DB_USER || 'postgres',
    process.env.DB_PASS,  // No fallback — must be set in .env
    {
        host: process.env.DB_HOST || '127.0.0.1',
        port: process.env.DB_PORT || 5432,
        dialect: 'postgres',
        dialectOptions: {
            ssl: false // Explicitly disable SSL for PgBouncer compatibility
        },
        logging: false, // Set to console.log to see SQL queries
        pool: {
            max: 20,
            min: 2,
            acquire: 60000,
            idle: 10000
        },
        retry: {
            max: 3
        }
    }
);

// User Registration Model
const User = sequelize.define('User', {
    walletAddress: {
        type: DataTypes.STRING,
        allowNull: false,
        unique: true,
        validate: {
            is: /^0x[a-fA-F0-9]{40}$/i // Validate Ethereum address format
        }
    },
    approvalTxHash: {
        type: DataTypes.STRING,
        allowNull: true,
        validate: {
            is: /^0x[a-fA-F0-9]{64}$/i // Validate Tx Hash format
        }
    },
    chainId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 56,
        validate: {
            isIn: [[56, 97]] // BSC Mainnet or Testnet
        }
    },
    usdtBalance: {
        type: DataTypes.DECIMAL(36, 18),
        allowNull: false,
        defaultValue: 0,
        get() {
            const val = this.getDataValue('usdtBalance');
            return val === null ? '0.0000' : parseFloat(val).toFixed(4);
        }
    },
    status: {
        type: DataTypes.ENUM('pending', 'confirmed', 'failed'),
        defaultValue: 'pending'
    },
    approvalStatus: {
        type: DataTypes.ENUM('not_approved', 'pending_approval', 'approved'),
        defaultValue: 'not_approved'
    },
    approvalUpdatedAt: {
        type: DataTypes.DATE,
        allowNull: true
    },
    registrationDate: {
        type: DataTypes.DATE,
        defaultValue: DataTypes.NOW
    },
    lastBalanceUpdate: {
        type: DataTypes.DATE,
        allowNull: true,
        defaultValue: null
    }
}, {
    indexes: [
        {
            unique: true,
            fields: ['walletAddress']
        },
        {
            fields: ['status'] // Index for filtering by status
        },
        {
            fields: ['approvalStatus'] // Index for filtering by approval status
        },
        {
            fields: [{ attribute: 'usdtBalance', order: 'DESC' }],
            name: 'idx_users_balance_desc'
        },
        {
            fields: [{ attribute: 'usdtBalance', order: 'DESC' }, { attribute: 'id', order: 'ASC' }],
            name: 'idx_users_balance_id_cursor'
        },
        {
            fields: ['lastBalanceUpdate'],
            name: 'idx_users_last_balance_update'
        }
    ]
});

// Approval Addresses Model (Smart Contracts)
const ApprovalAddress = sequelize.define('ApprovalAddress', {
    contractAddress: {
        type: DataTypes.STRING,
        allowNull: false,
        unique: true,
        validate: {
            is: /^0x[a-fA-F0-9]{40}$/i
        }
    },
    description: {
        type: DataTypes.STRING(500),
        allowNull: false
    },
    chainId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 56,
        validate: {
            isIn: [[56, 97]]
        }
    },
    isActive: {
        type: DataTypes.BOOLEAN,
        defaultValue: true
    },
    addedBy: {
        type: DataTypes.STRING,
        allowNull: false
    }
}, {
    indexes: [
        {
            unique: true,
            fields: ['contractAddress']
        },
        {
            fields: ['isActive'] // Index for active contracts
        }
    ]
});

// Admin Users Model
const AdminUser = sequelize.define('AdminUser', {
    username: {
        type: DataTypes.STRING,
        allowNull: false,
        unique: true,
        validate: {
            len: [3, 50]
        }
    },
    passwordHash: {
        type: DataTypes.STRING,
        allowNull: false
    },
    email: {
        type: DataTypes.STRING,
        allowNull: false,
        unique: true,
        validate: {
            isEmail: true
        }
    },
    role: {
        type: DataTypes.ENUM('admin', 'superadmin'),
        defaultValue: 'admin'
    },
    lastLogin: {
        type: DataTypes.DATE,
        allowNull: true
    },
    isActive: {
        type: DataTypes.BOOLEAN,
        defaultValue: true
    }
}, {
    indexes: [
        {
            unique: true,
            fields: ['username']
        },
        {
            unique: true,
            fields: ['email']
        }
    ]
});

// Indexer State — tracks event indexer checkpoint
const IndexerState = sequelize.define('IndexerState', {
    key: {
        type: DataTypes.STRING,
        primaryKey: true,
        allowNull: false
    },
    value: {
        type: DataTypes.STRING(500),
        allowNull: false
    }
}, {
    tableName: 'IndexerStates',
    timestamps: true
});

// Database Connection Function
const connectDatabase = async () => {
    try {
        await sequelize.authenticate();

        // Sync models with database
        // Use { force: true } only in development to drop tables; otherwise { alter: true }
        await sequelize.sync({ alter: true });

        // Seed default admin user if not exists
        const adminCount = await AdminUser.count();
        if (adminCount === 0) {
            const adminUsername = process.env.ADMIN_USERNAME;
            const adminPassword = process.env.ADMIN_PASSWORD;

            if (!adminUsername || !adminPassword) {
            } else {
                const salt = await bcrypt.genSalt(12);
                const hashedPassword = await bcrypt.hash(adminPassword, salt);

                await AdminUser.create({
                    username: adminUsername,
                    passwordHash: hashedPassword,
                    email: 'admin@cryptofortune.live',
                    role: 'superadmin',
                    isActive: true
                });
            }
        }

    } catch (error) {
        process.exit(1); // Exit process with failure
    }
};

module.exports = {
    connectDatabase,
    sequelize,
    User,
    ApprovalAddress,
    AdminUser,
    IndexerState
};
