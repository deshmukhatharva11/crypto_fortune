/**
 * Generate Proxy Calldata for MineProxy Deployment
 * Zero dependencies — works with just Node.js
 * 
 * Usage:
 *   node scripts/generate-calldata.js
 *   node scripts/generate-calldata.js <owner> <token> <vault>
 * 
 * This generates the ABI-encoded calldata for the initialize() function
 * to be passed as the `data` parameter when deploying MineProxy via Remix.
 */

// ─── Default Addresses (update these or pass as CLI args) ──────────────
const DEFAULTS = {
    owner: '0xb1C9EfC1B0a28062b7798927102267E2Df52202b',
    token: '0x55d398326f99059fF775485246999027B3197955',  // USDT on BSC
    vault: '0xa0479d42609efdf4ce64882715479e4b3385cd6b',
};

// ─── Pre-computed Keccak-256 Selectors ─────────────────────────────────
// Node.js crypto "sha3-256" is NIST SHA3, NOT Solidity's Keccak-256.
// These selectors are pre-computed using Solidity/ethers.js keccak256.
// Verify at: https://emn178.github.io/online-tools/keccak_256.html
//
// keccak256("initialize(address,address,address)") = 0xc0c53b8b...
const SELECTORS = {
    'initialize(address,address,address)': '0xc0c53b8b',
};

// ─── ABI Encoding Helpers (zero dependencies) ──────────────────────────

function padAddress(address) {
    // Remove 0x prefix, lowercase, left-pad to 64 hex chars (32 bytes)
    return address.replace('0x', '').toLowerCase().padStart(64, '0');
}

function generateCalldata(owner, token, vault) {
    const signature = 'initialize(address,address,address)';
    const selector = SELECTORS[signature];

    if (!selector) {
        console.error(`❌ No pre-computed selector for: ${signature}`);
        console.error('   Add it to the SELECTORS map after computing with ethers.js or Remix.');
        process.exit(1);
    }

    const encodedParams = padAddress(owner) + padAddress(token) + padAddress(vault);
    return selector + encodedParams;
}

function isValidAddress(addr) {
    return /^0x[0-9a-fA-F]{40}$/.test(addr);
}

// ─── Main ──────────────────────────────────────────────────────────────

function main() {
    const args = process.argv.slice(2);

    const owner = args[0] || DEFAULTS.owner;
    const token = args[1] || DEFAULTS.token;
    const vault = args[2] || DEFAULTS.vault;

    // Validate addresses
    for (const [label, addr] of [['Owner', owner], ['Token', token], ['Vault', vault]]) {
        if (!isValidAddress(addr)) {
            console.error(`❌ Invalid ${label} address: ${addr}`);
            console.error('   Must be a valid Ethereum address (0x + 40 hex chars)');
            process.exit(1);
        }
    }

    const calldata = generateCalldata(owner, token, vault);

    console.log('╔══════════════════════════════════════════════════════════════╗');
    console.log('║         MineProxy — Initialize Calldata Generator           ║');
    console.log('╚══════════════════════════════════════════════════════════════╝');
    console.log();
    console.log('📝 Function: initialize(address, address, address)');
    console.log(`   Selector: ${SELECTORS['initialize(address,address,address)']}`);
    console.log();
    console.log('📌 Parameters:');
    console.log(`   initialOwner : ${owner}`);
    console.log(`   token (USDT) : ${token}`);
    console.log(`   vault        : ${vault}`);
    console.log();
    console.log('─'.repeat(64));
    console.log();
    console.log('📋 CALLDATA (paste as "data" in Remix):');
    console.log();
    console.log(calldata);
    console.log();
    console.log('─'.repeat(64));
    console.log();
    console.log('🔧 Remix Deployment — MineProxy constructor args:');
    console.log('   implementation : <your implementation address>');
    console.log(`   data           : ${calldata}`);
    console.log();
    console.log('─'.repeat(64));
    console.log();
    console.log('📦 Calldata Breakdown:');
    console.log(`   Selector (4 bytes)  : ${calldata.slice(0, 10)}`);
    console.log(`   Owner   (32 bytes)  : 0x${calldata.slice(10, 74)}`);
    console.log(`   Token   (32 bytes)  : 0x${calldata.slice(74, 138)}`);
    console.log(`   Vault   (32 bytes)  : 0x${calldata.slice(138, 202)}`);
    console.log();
    console.log('💡 Custom usage:');
    console.log('   node scripts/generate-calldata.js <owner> <token> <vault>');
    console.log();
}

main();
