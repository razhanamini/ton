"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.startPaymentMonitor = startPaymentMonitor;
const db_1 = require("./db");
const ton_1 = require("./ton");
const POLL_INTERVAL_MS = 30000; // 30 seconds
/**
 * Parse the BET comment format: "BET-<betId>-<side>-<positionId>"
 */
function parseComment(comment) {
    const m = comment.match(/^BET-(\d+)-(yes|no)-(\d+)$/);
    if (!m)
        return null;
    return { betId: parseInt(m[1]), side: m[2], positionId: parseInt(m[3]) };
}
/**
 * Poll toncenter for incoming transactions and match them to pending positions.
 * A position is confirmed when:
 *   1. A transaction arrives at the admin wallet
 *   2. Its comment matches BET-<betId>-<side>-<positionId>
 *   3. The amount sent is >= the expected amount_ton
 *   4. The position is still in pending_payment status (not expired)
 */
async function checkIncomingPayments() {
    const pending = (0, db_1.getPendingPositions)();
    if (pending.length === 0)
        return;
    let txs;
    try {
        txs = await (0, ton_1.fetchRecentTransactions)(100);
    }
    catch (e) {
        console.error('[PaymentMonitor] Failed to fetch transactions:', e.message);
        return;
    }
    for (const tx of txs) {
        const msg = tx.in_msg;
        if (!msg?.message || !msg.value)
            continue;
        const parsed = parseComment(msg.message.trim());
        if (!parsed)
            continue;
        const position = (0, db_1.getPosition)(parsed.positionId);
        if (!position)
            continue;
        if (position.status !== 'pending_payment')
            continue;
        if (position.bet_id !== parsed.betId)
            continue;
        if (position.side !== parsed.side)
            continue;
        // Check amount: allow up to 5% shortfall for network fees rounding
        const sentNano = BigInt(msg.value);
        const expectedNano = BigInt(Math.floor(position.amount_ton * 1e9));
        const tolerance = expectedNano * 5n / 100n;
        if (sentNano < expectedNano - tolerance) {
            console.warn(`[PaymentMonitor] Position ${position.id}: sent ${msg.value} nano, expected ${expectedNano.toString()} nano — too low, skipping`);
            continue;
        }
        const txHash = tx.transaction_id.hash;
        (0, db_1.confirmPosition)(position.id, txHash);
        console.log(`[PaymentMonitor] Confirmed position ${position.id} via tx ${txHash}`);
    }
}
/**
 * Expire positions that have been pending for more than 10 minutes.
 * Reverts their amounts from the pool so odds stay accurate.
 */
function expireStalePositions() {
    const stale = (0, db_1.getExpiredPendingPositions)();
    for (const pos of stale) {
        (0, db_1.expirePosition)(pos.id);
        (0, db_1.revertPool)(pos.bet_id, pos.side, pos.amount_ton);
        console.log(`[ExpiryJob] Expired position ${pos.id} (bet ${pos.bet_id}, ${pos.amount_ton} TON ${pos.side})`);
    }
}
function startPaymentMonitor() {
    console.log('[PaymentMonitor] Starting — polling every 30s');
    const tick = async () => {
        expireStalePositions();
        await checkIncomingPayments();
    };
    tick(); // run immediately on start
    setInterval(tick, POLL_INTERVAL_MS);
}
