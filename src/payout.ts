// src/payout.ts  — separate module so it can run independently of the bot callback

import { getBet, getWinnersForBet, markPaidOut, Position } from './db';
import { sendTon, calculatePayout } from './ton';

export interface PayoutResult {
  pos: Position;
  payout: number;
  success: boolean;
  error?: string;
}

/**
 * Attempt to send TON with retries.
 * Tries up to `maxAttempts` times with exponential backoff.
 */
async function sendWithRetry(
  address: string,
  amount: number,
  comment: string,
  maxAttempts = 3
): Promise<void> {
  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await sendTon(address, amount, comment);
      return; // success
    } catch (e) {
      lastError = e as Error;
      if (attempt < maxAttempts) {
        // exponential backoff: 2s, 4s, 8s
        await new Promise(r => setTimeout(r, 1000 * Math.pow(2, attempt)));
      }
    }
  }

  throw lastError;
}

/**
 * Pay out all winners for a resolved bet.
 * Runs all payouts concurrently with per-tx retry.
 * Returns results for each position so caller can report status.
 */
export async function payoutBet(betId: number): Promise<PayoutResult[]> {
  const bet = getBet(betId);
  if (!bet || bet.status !== 'resolved' || !bet.result) {
    throw new Error(`Bet #${betId} is not resolved`);
  }

  const winners     = getWinnersForBet(betId, bet.result as 'yes' | 'no');
  const winningPool = bet.result === 'yes' ? bet.yes_pool : bet.no_pool;
  const totalPool   = bet.yes_pool + bet.no_pool;

  // Run all payouts in parallel
  const results = await Promise.allSettled(
    winners.map(async (pos): Promise<PayoutResult> => {
      if (!pos.ton_address) {
        return { pos, payout: 0, success: false, error: 'No TON address on file' };
      }

      const payout = calculatePayout(pos.amount_ton, winningPool, totalPool);

      await sendWithRetry(pos.ton_address, payout, `Win BET-${betId}`, 3);

      // Only mark paid after successful send
      markPaidOut(pos.id);

      return { pos, payout, success: true };
    })
  );

  // Unwrap allSettled results
  return results.map((r, i) => {
    if (r.status === 'fulfilled') return r.value;
    // If the whole promise rejected unexpectedly
    return {
      pos: winners[i],
      payout: 0,
      success: false,
      error: r.reason?.message ?? 'Unknown error',
    };
  });
}