"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateTelegramAuth = validateTelegramAuth;
exports.requireAuth = requireAuth;
exports.requireAdmin = requireAdmin;
const crypto_1 = __importDefault(require("crypto"));
/**
 * Validate Telegram Mini App initData and extract the user.
 * See: https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
 */
function validateTelegramAuth(initData) {
    try {
        const params = new URLSearchParams(initData);
        const hash = params.get('hash');
        if (!hash)
            return null;
        params.delete('hash');
        const dataCheckString = Array.from(params.entries())
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([k, v]) => `${k}=${v}`)
            .join('\n');
        const secret = crypto_1.default
            .createHmac('sha256', 'WebAppData')
            .update(process.env.TELEGRAM_BOT_TOKEN || '')
            .digest();
        const expectedHash = crypto_1.default
            .createHmac('sha256', secret)
            .update(dataCheckString)
            .digest('hex');
        if (expectedHash !== hash)
            return null;
        const userStr = params.get('user');
        if (!userStr)
            return null;
        return JSON.parse(userStr);
    }
    catch {
        return null;
    }
}
// Express middleware — attaches req.telegramUser or returns 401
// Express middleware — attaches req.telegramUser or returns 401
function requireAuth(req, res, next) {
    // Development mode - allow testing from browser
    if (req.headers['x-dev-mode'] === 'true' && process.env.NODE_ENV !== 'production') {
        console.log('Dev mode: skipping auth');
        req.telegramUser = { id: 123456, username: 'dev_user' };
        return next();
    }
    // Production - validate Telegram auth
    const initData = req.headers['x-telegram-init-data'];
    if (!initData) {
        console.log('Missing Telegram auth header');
        return res.status(401).json({ error: 'Missing Telegram auth' });
    }
    const user = validateTelegramAuth(initData);
    if (!user) {
        console.log('Invalid Telegram auth');
        return res.status(401).json({ error: 'Invalid Telegram auth' });
    }
    req.telegramUser = user;
    next();
}
// Admin-only middleware — checks user ID matches ADMIN_ID env var
function requireAdmin(req, res, next) {
    const user = req.telegramUser;
    if (!user || user.id !== parseInt(process.env.ADMIN_ID || '0', 10)) {
        return res.status(403).json({ error: 'Admin only' });
    }
    next();
}
