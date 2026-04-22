import { Bet } from './db';

export function formatBetCard(bet: Bet): string {
  const total = (bet.yes_pool + bet.no_pool).toFixed(2);
  const yesOdds = bet.yes_pool > 0 ? ((bet.yes_pool + bet.no_pool) / bet.yes_pool).toFixed(2) + 'x' : '—';
  const noOdds  = bet.no_pool  > 0 ? ((bet.yes_pool + bet.no_pool) / bet.no_pool).toFixed(2)  + 'x' : '—';
  const statusEmoji = bet.status === 'open' ? '🟢' : bet.status === 'closed' ? '🔴' : '✅';

  return (
    `${statusEmoji} *Bet #${bet.id}*\n` +
    `📋 ${esc(bet.statement)}\n` +
    `⏰ Deadline: ${esc(bet.deadline)}\n` +
    `💰 Total pool: *${total} TON*\n` +
    `✅ YES: ${bet.yes_pool.toFixed(2)} TON → *${yesOdds}*\n` +
    `❌ NO:  ${bet.no_pool.toFixed(2)} TON → *${noOdds}*` +
    (bet.status === 'resolved' ? `\n🏆 Result: *${bet.result?.toUpperCase()}*` : '')
  );
}

export function esc(text: string): string {
  return text.replace(/[_*[\]()~`>#+=|{}.!-]/g, '\\$&');
}