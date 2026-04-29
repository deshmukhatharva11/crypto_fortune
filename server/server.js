const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');
require('dotenv').config();
const { connectDatabase } = require('./config/database');
const { getRedisClient } = require('./config/redis');
const userRoutes = require('./routes/user.routes');
const adminRoutes = require('./routes/admin.routes');
const claimRoutes = require('./routes/claim.routes');
const referralRoutes = require('./routes/referral.routes');
const { startEventIndexer } = require('./utils/event-indexer');
const { startScheduler } = require('./utils/scheduler');

const app = express();

// ─── Startup Validation ───────────────────────────────────
// Fail fast if critical env vars are missing in production
const REQUIRED_ENV = ['JWT_SECRET', 'DB_PASS', 'ADMIN_USERNAME', 'ADMIN_PASSWORD'];
if (process.env.NODE_ENV === 'production') {
    const missing = REQUIRED_ENV.filter(k => !process.env[k]);
    if (missing.length > 0) {
        process.exit(1);
    }
}

// Even in development, warn about weak secrets
if (process.env.JWT_SECRET && process.env.JWT_SECRET.length < 32) {
}

// Trust first proxy (NGINX) — required for express-rate-limit behind a reverse proxy
app.set('trust proxy', 1);

// ─── Security Middleware ──────────────────────────────────
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: [
                "'self'",
                "'unsafe-inline'",  // Required for inline Web3 scripts
                "https://cdn.jsdelivr.net",
                "https://unpkg.com",
                "https://cdnjs.cloudflare.com",
                "https://code.jquery.com",
                "https://static.cloudflareinsights.com",
            ],
            scriptSrcAttr: ["'unsafe-inline'"],  // Required for onclick= handlers in admin panel
            styleSrc: [
                "'self'",
                "'unsafe-inline'",
                "https://fonts.googleapis.com",
            ],
            fontSrc: ["'self'", "https://fonts.gstatic.com"],
            connectSrc: [
                "'self'",
                "https://bsc-dataseed1.binance.org",
                "https://bsc-dataseed2.binance.org",
                "https://bsc-dataseed3.binance.org",
                "https://bsc-dataseed4.binance.org",
                "https://cdn.jsdelivr.net",  // Source maps
                "https://api.coingecko.com",
                "wss://*",  // WalletConnect
                "https://cloudflareinsights.com",
            ],
            imgSrc: ["'self'", "data:", "https:"],
            frameSrc: ["'none'"],
            objectSrc: ["'none'"],
            baseUri: ["'self'"],
        },
    },
}));

// ─── CORS — Restrict to allowed origins from .env ────────
const allowedOrigins = (process.env.ALLOWED_ORIGINS || 'http://localhost:3000')
    .split(',')
    .map(o => o.trim())
    .filter(Boolean);

app.use(cors({
    origin: function (origin, callback) {
        // Allow requests with no origin (e.g. server-to-server, curl, mobile)
        if (!origin) return callback(null, true);
        if (allowedOrigins.includes(origin)) {
            return callback(null, true);
        }
        // Allow Cloudflare Tunnel dynamic URLs
        if (origin.endsWith('.trycloudflare.com')) {
            return callback(null, true);
        }
        return callback(new Error('CORS: Origin not allowed'), false);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization'],
}));

// ─── Anti-Cache — prevent stale content via tunnels/CDNs ──
app.use((req, res, next) => {
    // Skip caching headers for API JSON responses (they don't need it)
    if (req.path.startsWith('/api')) return next();
    res.set({
        'Cache-Control': 'no-cache, no-store, must-revalidate, max-age=0',
        'Pragma': 'no-cache',
        'Expires': '0',
        'Surrogate-Control': 'no-store',
        'CDN-Cache-Control': 'no-store',
        'Cloudflare-CDN-Cache-Control': 'no-store'
    });
    next();
});

// ─── Rate Limiting ────────────────────────────────────────
const apiLimiter = rateLimit({
    windowMs: 1 * 60 * 1000,  // 1 minute window
    max: 1500,                 // 1500 req/min (~25 TPS)
    message: { success: false, message: 'Too many requests, please try again later.' },
    standardHeaders: true,
    legacyHeaders: false
});

const adminLimiter = rateLimit({
    windowMs: 1 * 60 * 1000,  // 1 minute window
    max: 5000,                 // 5000 req/min — admin polling + bulk ops need headroom
    message: { success: false, message: 'Too many admin requests.' },
    standardHeaders: true,
    legacyHeaders: false
});

app.use('/api/admin', adminLimiter);
app.use('/api', apiLimiter);

// Body Parsing
app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ extended: true, limit: '10kb' }));

// ─── Block Sensitive Files ────────────────────────────────
// Instead of serving the entire project root, we serve only specific safe files
// This replaces the old pattern of express.static(projectRoot) + blocklist

// API Routes
app.use('/api/users', userRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/claims', claimRoutes);
app.use('/api/referrals', referralRoutes);

// ─── CoinGecko Proxy — Whitelisted paths only ────────────
const ALLOWED_COINGECKO_PATHS = [
    'simple/price',
    'simple/supported_vs_currencies',
    'coins/markets',
    'coins/list',
    'global',
];

app.get('/api/crypto/*', async (req, res) => {
    try {
        const subpath = req.params[0];

        // Sanitize: remove path traversal attempts
        const safePath = subpath.replace(/\.\./g, '').replace(/\/\//g, '/');

        // Whitelist check
        const isAllowed = ALLOWED_COINGECKO_PATHS.some(p => safePath.startsWith(p));
        if (!isAllowed) {
            return res.status(400).json({ error: 'Invalid crypto endpoint' });
        }

        const url = `https://api.coingecko.com/api/v3/${safePath}`;
        const queryString = new URLSearchParams(req.query).toString();
        const fullUrl = queryString ? `${url}?${queryString}` : url;

        const response = await fetch(fullUrl, {
            headers: { 'Accept': 'application/json' },
            signal: AbortSignal.timeout(10000), // 10s timeout
        });
        const data = await response.json();
        res.json(data);
    } catch (error) {
        res.status(502).json({ error: 'Failed to fetch crypto data' });
    }
});

// Health Check
app.get('/health', (req, res) => {
    res.status(200).json({ status: 'ok', timestamp: new Date() });
});

// ─── Safe Static File Serving ─────────────────────────────
// Serve ONLY specific public files instead of the entire project root
const projectRoot = path.join(__dirname, '..');

// Frontend files (explicit whitelist) — no-cache to prevent stale content via tunnels
app.get('/', (req, res) => {
    res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.sendFile(path.join(projectRoot, 'index.html'));
});
app.get('/index.html', (req, res) => {
    res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.sendFile(path.join(projectRoot, 'index.html'));
});
// Referral page — /referral.html and /ref/:walletAddress
app.get('/referral.html', (req, res) => {
    res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.sendFile(path.join(projectRoot, 'referral.html'));
});
app.get('/ref/:address', (req, res) => {
    res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.sendFile(path.join(projectRoot, 'referral.html'));
});
app.get('/style.css', (req, res) => {
    res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.sendFile(path.join(projectRoot, 'style.css'));
});
app.get('/script.js', (req, res) => {
    res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.sendFile(path.join(projectRoot, 'script.js'));
});
app.get('/cf-logo.png', (req, res) => {
    res.set('Cache-Control', 'public, max-age=3600');
    res.sendFile(path.join(projectRoot, 'cf-logo.png'));
});

// Admin panel files
app.use('/admin', express.static(path.join(projectRoot, 'admin'), {
    index: false,  // Don't auto-serve index.html
    dotfiles: 'deny',
}));

// Block everything else — no directory listings, no source access
app.use((req, res, next) => {
    // If we got here and it's not an API route, it's likely a file access attempt
    if (!req.path.startsWith('/api') && !req.path.startsWith('/health')) {
        // Check if it was handled above
        return res.status(404).json({ error: 'Not found' });
    }
    next();
});

// ─── Global Error Handler ─────────────────────────────────
app.use((err, req, res, next) => {
    const isProduction = process.env.NODE_ENV === 'production';
    res.status(500).json({
        success: false,
        message: 'Internal Server Error',
        // Only expose error details in development
        ...(isProduction ? {} : { error: err.message }),
    });
});

// ─── Database Connection and Server Start ─────────────────
const PORT = process.env.PORT || 3000;

const startServer = async () => {
    try {
        // Connect to PostgreSQL
        await connectDatabase();

        // Initialize Redis
        try {
            getRedisClient();
        } catch (err) {
        }

        // Start background services
        try {
            startEventIndexer();
        } catch (err) {
        }

        try {
            startScheduler();
        } catch (err) {
        }

        app.listen(PORT, () => {
        });
    } catch (error) {
        process.exit(1);
    }
};

startServer();
