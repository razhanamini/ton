import { getBet, getConfirmedWinnersForBet, markPaidOut, Position } from './db';
import { sendTon, calculatePayout } from './ton';

export interface PayoutResult {
  positionId: number;
  userId: number;
  username: string | null;
  payout: number;
  success: boolean;
  error?: string;
}

async function sendWithRetry(address: string, amount: number, comment: string, attempts = 3): Promise<void> {
  let last: Error | undefined;
  for (let i = 1; i <= attempts; i++) {
    try {
      await sendTon(address, amount, comment);
      return;
    } catch (e) {
      last = e as Error;
      if (i < attempts) await new Promise(r => setTimeout(r, 1000 * Math.pow(2, i)));
    }
  }
  throw last;
}

export async function payoutBet(betId: number): Promise<PayoutResult[]> {
  const bet = getBet(betId);
  if (!bet || bet.status !== 'resolved' || !bet.result) {
    throw new Error(`Bet #${betId} is not resolved`);
  }

  const winners = getConfirmedWinnersForBet(betId, bet.result as 'yes' | 'no');
  const winningPool = bet.result === 'yes' ? bet.yes_pool : bet.no_pool;
  const totalPool = bet.yes_pool + bet.no_pool;

  if (winners.length === 0) return [];

  const results = await Promise.allSettled(
    winners.map(async (pos): Promise<PayoutResult> => {
      const payout = calculatePayout(pos.amount_ton, winningPool, totalPool);

      await sendWithRetry(pos.ton_address, payout, `Win BET-${betId}`);
      markPaidOut(pos.id);

      return { positionId: pos.id, userId: pos.user_id, username: pos.username, payout, success: true };
    })
  );

  return results.map((r, i) => {
    if (r.status === 'fulfilled') return r.value;
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