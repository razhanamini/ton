"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.payoutBet = payoutBet;
const db_1 = require("./db");
const ton_1 = require("./ton");
async function sendWithRetry(address, amount, comment, attempts = 3) {
    let last;
    for (let i = 1; i <= attempts; i++) {
        try {
            await (0, ton_1.sendTon)(address, amount, comment);
            return;
        }
        catch (e) {
            last = e;
            if (i < attempts)
                await new Promise(r => setTimeout(r, 1000 * Math.pow(2, i)));
        }
    }
    throw last;
}
async function payoutBet(betId) {
    const bet = (0, db_1.getBet)(betId);
    if (!bet || bet.status !== 'resolved' || !bet.result) {
        throw new Error(`Bet #${betId} is not resolved`);
    }
    const winners = (0, db_1.getConfirmedWinnersForBet)(betId, bet.result);
    const winningPool = bet.result === 'yes' ? bet.yes_pool : bet.no_pool;
    const totalPool = bet.yes_pool + bet.no_pool;
    if (winners.length === 0)
        return [];
    const results = await Promise.allSettled(winners.map(async (pos) => {
        const payout = (0, ton_1.calculatePayout)(pos.amount_ton, winningPool, totalPool);
        await sendWithRetry(pos.ton_address, payout, `Win BET-${betId}`);
        (0, db_1.markPaidOut)(pos.id);
        return { positionId: pos.id, userId: pos.user_id, username: pos.username, payout, success: true };
    }));
    return results.map((r, i) => {
        if (r.status === 'fulfilled')
            return r.value;
        return {
            positionId: winners[i].id,
            userId: winners[i].user_id,
            username: winners[i].username,
            payout: 0,
            success: false,
            error: r.reason?.message ?? 'Unknown error',
        };
    });
}
