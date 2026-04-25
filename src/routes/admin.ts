import { Router } from 'express';
import { requireAuth, requireAdmin } from '../auth';
import {
  createBet, getAllBets, getBet, closeBet, resolveBet,
  getConfirmedWinnersForBet, getAllOpenBets
} from '../db';
import { getAdminBalance, getAdminAddress, computeOdds } from '../ton';
import { payoutBet } from '../payout';

const router = Router();

// All admin routes require Telegram auth + admin user ID
router.use(requireAuth, requireAdmin);

/**
 * GET /api/admin/dashboard
 * Overview stats for the admin panel.
 */
router.get('/dashboard', async (req, res) => {
  const [balance, address] = await Promise.all([
    getAdminBalance().catch(() => '?'),
    getAdminAddress().catch(() => '?'),
  ]);
  const bets = getAllBets();
  const open = bets.filter(b => b.status === 'open').length;
  const closed = bets.filter(b => b.status === 'closed').length;
  const resolved = bets.filter(b => b.status === 'resolved').length;

  res.json({
    wallet: { address, balance_ton: balance },
    bets: { total: bets.length, open, closed, resolved },
  });
});

/**
 * GET /api/admin/bets
 * All bets with full detail including winner counts.
 */
router.get('/bets', (req, res) => {
  const bets = getAllBets().map(bet => ({
    ...bet,
    odds: computeOdds(bet.yes_pool, bet.no_pool),
    total_pool: bet.yes_pool + bet.no_pool,
  }));
  res.json(bets);
});

/**
 * POST /api/admin/bets
 * Body: { statement: string, deadline: string }
 * Create a new bet.
 */
router.post('/bets', (req, res) => {
  const { statement, deadline } = req.body as { statement: string; deadline: string };
  if (!statement?.trim() || !deadline?.trim()) {
    return res.status(400).json({ error: 'statement and deadline are required' });
  }
  const id = createBet(statement.trim(), deadline.trim());
  res.status(201).json({ id, statement, deadline, status: 'open' });
});

/**
 * GET /api/admin/bets/:id
 * Single bet with winner details.
 */
router.get('/bets/:id', (req, res) => {
  const bet = getBet(parseInt(req.params.id));
  if (!bet) return res.status(404).json({ error: 'Bet not found' });

  const yesWinners = getConfirmedWinnersForBet(bet.id, 'yes');
  const noWinners  = getConfirmedWinnersForBet(bet.id, 'no');

  res.json({
    ...bet,
    odds: computeOdds(bet.yes_pool, bet.no_pool),
    total_pool: bet.yes_pool + bet.no_pool,
    confirmed_yes_positions: yesWinners.length,
    confirmed_no_positions: noWinners.length,
  });
});

/**
 * POST /api/admin/bets/:id/close
 * Close a bet — no new positions accepted.
 */
router.post('/bets/:id/close', (req, res) => {
  const bet = getBet(parseInt(req.params.id));
  if (!bet) return res.status(404).json({ error: 'Bet not found' });
  if (bet.status !== 'open') return res.status(409).json({ error: `Bet is ${bet.status}` });
  closeBet(bet.id);
  res.json({ ok: true, id: bet.id, status: 'closed' });
});

/**
 * POST /api/admin/bets/:id/resolve
 * Body: { result: 'yes' | 'no' }
 * Resolve a bet and trigger automatic payouts to all confirmed winners.
 *
 * Payout logic:
 *   - Only confirmed positions (payment verified) receive payouts
 *   - Payout = (stake / winning_pool) * total_pool * 0.98  (2% house fee)
 *   - All payouts run in parallel with 3 retries each
 *   - Returns per-winner results
 */
router.post('/bets/:id/resolve', async (req, res) => {
  const bet = getBet(parseInt(req.params.id));
  if (!bet) return res.status(404).json({ error: 'Bet not found' });
  if (bet.status !== 'closed') return res.status(409).json({ error: 'Bet must be closed before resolving' });

  const { result } = req.body as { result: 'yes' | 'no' };
  if (!['yes', 'no'].includes(result)) {
    return res.status(400).json({ error: 'result must be yes or no' });
  }

  resolveBet(bet.id, result);

  // Run payouts asynchronously — respond immediately so request doesn't timeout
  const betId = bet.id;
  res.json({ ok: true, id: betId, result, message: 'Bet resolved. Payouts are being processed.' });

  // Fire payouts in background
  payoutBet(betId)
    .then(results => {
      const ok = results.filter(r => r.success).length;
      const fail = results.filter(r => !r.success).length;
      console.log(`[Payout] Bet #${betId}: ${ok} paid, ${fail} failed`);
      results.filter(r => !r.success).forEach(r =>
        console.error(`[Payout] Failed user ${r.userId}: ${r.error}`)
      );
    })
    .catch(e => console.error(`[Payout] Bet #${betId} crashed:`, e.message));
});

export default router;