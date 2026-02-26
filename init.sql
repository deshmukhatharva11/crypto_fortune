-- PVC Meta Blockchain - Database Initialization Script
-- This script runs automatically on first PostgreSQL container startup.
-- Sequelize handles table creation and migration via sync({ alter: true }).

-- Create the database (if not already created by POSTGRES_DB env var)
SELECT 'CREATE DATABASE crypto_fortune'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'crypto_fortune')\gexec

-- Grant privileges
GRANT ALL PRIVILEGES ON DATABASE crypto_fortune TO postgres;

-- Connect to the crypto_fortune database
\c crypto_fortune

-- Enable useful extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "citext";

-- Log success
DO $$
BEGIN
    RAISE NOTICE '✅ PVC Meta database initialized successfully!';
END $$;
