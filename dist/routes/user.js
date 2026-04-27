"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const auth_1 = require("../auth");
const db_1 = require("../db");
const ton_1 = require("../ton");
const router = (0, express_1.Router)();
const MIN_BET = 0.1;
const PAYMENT_WINDOW_MINUTES = 10;
// All user routes require Telegram Mini App auth
router.use(auth_1.requireAuth);
/**
 * GET /api/user/me
 * Returns the current user's profile and saved TON address.
 */
router.get('/me', (req, res) => {
    const tgUser = req.telegramUser;
    (0, db_1.upsertUser)(tgUser.id, tgUser.username);
    const user = (0, db_1.getUser)(tgUser.id);
    res.json({ user_id: tgUser.id, username: tgUser.username, ton_address: user?.ton_address ?? null });
});
/**
 * POST /api/user/wallet
 * Body: { ton_address: string }
 * Save or update the user's TON wallet address.
 */
router.post('/wallet', (req, res) => {
    const tgUser = req.telegramUser;
    const { ton_address } = req.body;
    if (!ton_address || !(0, ton_1.isValidTonAddress)(ton_address)) {
        return res.status(400).json({ error: 'Invalid TON address' });
    }
    (0, db_1.upsertUser)(tgUser.id, tgUser.username, ton_address);
    res.json({ ok: true });
});
/**
 * GET /api/user/bets
 * Returns all open bets with odds and pool sizes.
 */
router.get('/bets', (req, res) => {
    const bets = (0, db_1.getAllOpenBets)();
    const result = bets.map(bet => ({
        ...bet,
        odds: (0, ton_1.computeOdds)(bet.yes_pool, bet.no_pool),
        total_pool: bet.yes_pool + bet.no_pool,
    }));
    res.json(result);
});
/**
 * GET /api/user/bets/:id
 * Single bet with full detail.
 */
router.get('/bets/:id', (req, res) => {
    const bet = (0, db_1.getBet)(parseInt(req.params.id));
    if (!bet)
        return res.status(404).json({ error: 'Bet not found' });
    res.json({
        ...bet,
        odds: (0, ton_1.computeOdds)(bet.yes_pool, bet.no_pool),
        total_pool: bet.yes_pool + bet.no_pool,
    });
});
/**
 * POST /api/user/positions
 * Body: { bet_id: number, side: 'yes'|'no', amount_ton: number }
 *
 * Creates a pending position and returns payment instructions.
 * The position expires in 10 minutes if payment is not detected.
 *
 * Flow:
 *   1. Validate bet is open, user has TON address, amount is valid
 *   2. Create position with status=pending_payment
 *   3. Optimistically add to pool (reverted by expiry job if unpaid)
 *   4. Return payment link and instructions
 */
router.post('/positions', async (req, res) => {
    const tgUser = req.telegramUser;
    const { bet_id, side, amount_ton } = req.body;
    if (!bet_id || !side || !amount_ton) {
        return res.status(400).json({ error: 'bet_id, side, and amount_ton are required' });
    }
    if (!['yes', 'no'].includes(side)) {
        return res.status(400).json({ error: 'side must be yes or no' });
    }
    if (amount_ton < MIN_BET) {
        return res.status(400).json({ error: `Minimum bet is ${MIN_BET} TON` });
    }
    const bet = (0, db_1.getBet)(bet_id);
    if (!bet)
        return res.status(404).json({ error: 'Bet not found' });
    if (bet.status !== 'open')
        return res.status(409).json({ error: 'Bet is not open' });
    const user = (0, db_1.getUser)(tgUser.id);
    if (!user?.ton_address) {
        return res.status(409).json({ error: 'Set your TON wallet address first' });
    }
    const expiresAt = new Date(Date.now() + PAYMENT_WINDOW_MINUTES * 60 * 1000)
        .toISOString()
        .replace('T', ' ')
        .substring(0, 19);
    const positionId = (0, db_1.createPosition)(bet_id, tgUser.id, tgUser.username, user.ton_address, side, amount_ton, expiresAt);
    // Optimistically add to pool — reverted automatically if payment never arrives
    (0, db_1.updatePools)(bet_id, side, amount_ton);
    const adminAddress = await (0, ton_1.getAdminAddress)();
    const paymentLink = (0, ton_1.buildPaymentLink)(adminAddress, amount_ton, bet_id, side, positionId);
    const paymentComment = `BET-${bet_id}-${side}-${positionId}`;
    res.status(201).json({
        position_id: positionId,
        status: 'pending_payment',
        expires_at: expiresAt,
        payment: {
            to_address: adminAddress,
            amount_ton,
            comment: paymentComment,
            ton_link: paymentLink,
        },
        message: `Send exactly ${amount_ton} TON with comment "${paymentComment}" within 10 minutes.`,
    });
});
/**
 * GET /api/user/positions
 * Returns the current user's bet history.
 */
router.get('/positions', (req, res) => {
    const tgUser = req.telegramUser;
    const positions = (0, db_1.getUserPositions)(tgUser.id);
    res.json(positions);
});
/**
 * GET /api/user/positions/:id
 * Check status of a specific position (poll this after placing a bet).
 */
router.get('/positions/:id', (req, res) => {
    const tgUser = req.telegramUser;
    const position = (0, db_1.getPosition)(parseInt(req.params.id));
    if (!position)
        return res.status(404).json({ error: 'Position not found' });
    if (position.user_id !== tgUser.id)
        return res.status(403).json({ error: 'Forbidden' });
    res.json(position);
});
exports.default = router;
