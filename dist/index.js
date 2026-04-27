"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const db_1 = require("./db");
const user_1 = __importDefault(require("./routes/user"));
const admin_1 = __importDefault(require("./routes/admin"));
const paymentMonitor_1 = require("./paymentMonitor");
const adminBot_1 = require("./adminBot");
const PORT = parseInt(process.env.PORT || '3000', 10);
async function main() {
    // Init DB
    (0, db_1.getDb)();
    // Express API
    const app = (0, express_1.default)();
    // Dynamic CORS configuration
    const allowedOrigins = [
        'http://localhost:5173',
        'http://localhost:8080',
        'https://ton-front.vercel.app', // Replace with your Vercel URL
        /\.vercel\.app$/ // Allow all Vercel preview deployments
    ];
    // app.use(cors({
    //   origin: function (origin, callback) {
    //     // Allow requests with no origin (like mobile apps or curl)
    //     if (!origin) return callback(null, true);
    //     // Check if origin is allowed
    //     const isAllowed = allowedOrigins.some(allowed => {
    //       if (allowed instanceof RegExp) {
    //         return allowed.test(origin);
    //       }
    //       return allowed === origin;
    //     });
    //     if (isAllowed) {
    //       callback(null, true);
    //     } else {
    //       console.log(`CORS blocked: ${origin}`);
    //       callback(new Error('Not allowed by CORS'));
    //     }
    //   },
    //   credentials: true,
    //   methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    //   allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
    // }));
    app.use((0, cors_1.default)({
        origin: '*', // Allows all origins (testing only)
        credentials: false // Must be false when origin is '*'
    }));
    app.use(express_1.default.json());
    // Routes
    app.get('/health', (_, res) => res.json({ ok: true }));
    app.use('/api/user', user_1.default);
    app.use('/api/admin', admin_1.default);
    // Start server
    app.listen(PORT, () => console.log(`[API] Running on port ${PORT}`));
    // Background payment monitor + expiry job
    (0, paymentMonitor_1.startPaymentMonitor)();
    // Admin Telegram bo
    (0, adminBot_1.startAdminBot)();
}
main().catch(e => {
    console.error('Startup error:', e);
    process.exit(1);
});
