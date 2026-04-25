import { Bot, InlineKeyboard } from 'grammy';
import { getAllBets, getBet, closeBet, resolveBet, getDb } from './db';
import { getAdminBalance, getAdminAddress, computeOdds } from './ton';
import { payoutBet } from './payout';

const ADMIN_ID = parseInt(process.env.ADMIN_ID || '0', 10);

function isAdmin(id: number): boolean {
  return id === ADMIN_ID;
}

function betSummary(bet: ReturnType<typeof getBet>) {
  if (!bet) return '';
  const { yesOdds, noOdds } = computeOdds(bet.yes_pool, bet.no_pool);
  const statusEmoji = bet.status === 'open' ? '🟢' : bet.status === 'closed' ? '🔴' : '✅';
  return (
    `${statusEmoji} *Bet #${bet.id}*\n` +
    `📋 ${bet.statement}\n` +
    `⏰ ${bet.deadline}\n` +
    `💰 YES: ${bet.yes_pool.toFixed(2)} TON (${yesOdds ?? '—'}x) | NO: ${bet.no_pool.toFixed(2)} TON (${noOdds ?? '—'}x)` +
    (bet.result ? `\n🏆 Result: *${bet.result.toUpperCase()}*` : '')
  );
}

export function startAdminBot() {
  const token = process.env.BOT_TOKEN;
  if (!token) throw new Error('BOT_TOKEN not set');
  const bot = new Bot(token);

  bot.command('admin', async (ctx) => {
    if (!isAdmin(ctx.from?.id ?? 0)) return ctx.reply('⛔ Not authorized.');
    const balance = await getAdminBalance().catch(() => '?');
    const address = await getAdminAddress().catch(() => '?');
    await ctx.reply(
      `🔑 *Admin Panel*\n\n💼 \`${address}\`\n💰 Balance: *${balance} TON*`,
      {
        parse_mode: 'Markdown',
        reply_markup: new InlineKeyboard()
          .text('📋 List Bets', 'admin:list').row()
          .text('➕ New Bet', 'admin:new'),
      }
    );
  });

  bot.callbackQuery('admin:list', async (ctx) => {
    if (!isAdmin(ctx.from.id)) return ctx.answerCallbackQuery('Not authorized');
    await ctx.answerCallbackQuery();
    const bets = getAllBets();
    if (!bets.length) return ctx.reply('No bets yet.');
    for (const bet of bets) {
      const kb = new InlineKeyboard();
      if (bet.status === 'open') kb.text('🔒 Close', `admin:close:${bet.id}`);
      if (bet.status === 'closed') {
        kb.text('✅ YES Won', `admin:resolve:${bet.id}:yes`)
          .text('❌ NO Won', `admin:resolve:${bet.id}:no`);
      }
      await ctx.reply(betSummary(bet), { parse_mode: 'Markdown', reply_markup: kb });
    }
  });

  // Simple new bet via /newbet command for the admin bot
  bot.command('newbet', async (ctx) => {
    if (!isAdmin(ctx.from?.id ?? 0)) return;
    await ctx.reply('Use the Mini App admin panel to create bets, or use the API directly.');
  });

  bot.callbackQuery(/^admin:close:(\d+)$/, async (ctx) => {
    if (!isAdmin(ctx.from.id)) return ctx.answerCallbackQuery('Not authorized');
    const betId = parseInt(ctx.match[1]);
    const bet = getBet(betId);
    if (!bet || bet.status !== 'open') return ctx.answerCallbackQuery('Cannot close');
    closeBet(betId);
    await ctx.answerCallbackQuery('Closed ✅');
    await ctx.editMessageReplyMarkup({
      reply_markup: new InlineKeyboard()
        .text('✅ YES Won', `admin:resolve:${betId}:yes`)
        .text('❌ NO Won', `admin:resolve:${betId}:no`),
    });
  });

  bot.callbackQuery(/^admin:resolve:(\d+):(yes|no)$/, async (ctx) => {
    if (!isAdmin(ctx.from.id)) return ctx.answerCallbackQuery('Not authorized');
    const betId  = parseInt(ctx.match[1]);
    const result = ctx.match[2] as 'yes' | 'no';
    const bet    = getBet(betId);
    if (!bet || bet.status !== 'closed') return ctx.answerCallbackQuery('Must be closed first');

    await ctx.answerCallbackQuery('Resolving…');
    resolveBet(betId, result);
    await ctx.reply(`⚙️ Bet #${betId} resolved as *${result.toUpperCase()}*. Paying out…`, { parse_mode: 'Markdown' });

    payoutBet(betId)
      .then(async results => {
        for (const r of results) {
          if (r.success) {
            await ctx.reply(`✅ ${r.payout} TON → @${r.username ?? r.userId}`);
          } else {
            await ctx.reply(`❌ Failed: @${r.username ?? r.userId} — ${r.error}`);
          }
        }
        const ok = results.filter(r => r.success).length;
        await ctx.reply(`🏆 Done. ${ok}/${results.length} paid.`);
      })
      .catch(async e => ctx.reply(`🚨 Payout error: ${e.message}`));
  });

  bot.catch(e => console.error('[AdminBot]', e.message));
  bot.start({ onStart: info => console.log(`[AdminBot] Running as @${info.username}`) });
}