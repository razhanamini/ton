"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.startAdminBot = startAdminBot;
const grammy_1 = require("grammy");
const db_1 = require("./db");
const ton_1 = require("./ton");
const payout_1 = require("./payout");
const ADMIN_ID = parseInt(process.env.ADMIN_ID || '0', 10);
function isAdmin(id) {
    return id === ADMIN_ID;
}
function betSummary(bet) {
    if (!bet)
        return '';
    const { yesOdds, noOdds } = (0, ton_1.computeOdds)(bet.yes_pool, bet.no_pool);
    const statusEmoji = bet.status === 'open' ? '🟢' : bet.status === 'closed' ? '🔴' : '✅';
    return (`${statusEmoji} *Bet #${bet.id}*\n` +
        `📋 ${bet.statement}\n` +
        `⏰ ${bet.deadline}\n` +
        `💰 YES: ${bet.yes_pool.toFixed(2)} TON (${yesOdds ?? '—'}x) | NO: ${bet.no_pool.toFixed(2)} TON (${noOdds ?? '—'}x)` +
        (bet.result ? `\n🏆 Result: *${bet.result.toUpperCase()}*` : ''));
}
function startAdminBot() {
    const token = process.env.BOT_TOKEN;
    if (!token)
        throw new Error('BOT_TOKEN not set');
    const bot = new grammy_1.Bot(token);
    bot.command('admin', async (ctx) => {
        if (!isAdmin(ctx.from?.id ?? 0))
            return ctx.reply('⛔ Not authorized.');
        const balance = await (0, ton_1.getAdminBalance)().catch(() => '?');
        const address = await (0, ton_1.getAdminAddress)().catch(() => '?');
        await ctx.reply(`🔑 *Admin Panel*\n\n💼 \`${address}\`\n💰 Balance: *${balance} TON*`, {
            parse_mode: 'Markdown',
            reply_markup: new grammy_1.InlineKeyboard()
                .text('📋 List Bets', 'admin:list').row()
                .text('➕ New Bet', 'admin:new'),
        });
    });
    bot.callbackQuery('admin:list', async (ctx) => {
        if (!isAdmin(ctx.from.id))
            return ctx.answerCallbackQuery('Not authorized');
        await ctx.answerCallbackQuery();
        const bets = (0, db_1.getAllBets)();
        if (!bets.length)
            return ctx.reply('No bets yet.');
        for (const bet of bets) {
            const kb = new grammy_1.InlineKeyboard();
            if (bet.status === 'open')
                kb.text('🔒 Close', `admin:close:${bet.id}`);
            if (bet.status === 'closed') {
                kb.text('✅ YES Won', `admin:resolve:${bet.id}:yes`)
                    .text('❌ NO Won', `admin:resolve:${bet.id}:no`);
            }
            await ctx.reply(betSummary(bet), { parse_mode: 'Markdown', reply_markup: kb });
        }
    });
    // Simple new bet via /newbet command for the admin bot
    bot.command('newbet', async (ctx) => {
        if (!isAdmin(ctx.from?.id ?? 0))
            return;
        await ctx.reply('Use the Mini App admin panel to create bets, or use the API directly.');
    });
    bot.callbackQuery(/^admin:close:(\d+)$/, async (ctx) => {
        if (!isAdmin(ctx.from.id))
            return ctx.answerCallbackQuery('Not authorized');
        const betId = parseInt(ctx.match[1]);
        const bet = (0, db_1.getBet)(betId);
        if (!bet || bet.status !== 'open')
            return ctx.answerCallbackQuery('Cannot close');
        (0, db_1.closeBet)(betId);
        await ctx.answerCallbackQuery('Closed ✅');
        await ctx.editMessageReplyMarkup({
            reply_markup: new grammy_1.InlineKeyboard()
                .text('✅ YES Won', `admin:resolve:${betId}:yes`)
                .text('❌ NO Won', `admin:resolve:${betId}:no`),
        });
    });
    bot.callbackQuery(/^admin:resolve:(\d+):(yes|no)$/, async (ctx) => {
        if (!isAdmin(ctx.from.id))
            return ctx.answerCallbackQuery('Not authorized');
        const betId = parseInt(ctx.match[1]);
        const result = ctx.match[2];
        const bet = (0, db_1.getBet)(betId);
        if (!bet || bet.status !== 'closed')
            return ctx.answerCallbackQuery('Must be closed first');
        await ctx.answerCallbackQuery('Resolving…');
        (0, db_1.resolveBet)(betId, result);
        await ctx.reply(`⚙️ Bet #${betId} resolved as *${result.toUpperCase()}*. Paying out…`, { parse_mode: 'Markdown' });
        (0, payout_1.payoutBet)(betId)
            .then(async (results) => {
            for (const r of results) {
                if (r.success) {
                    await ctx.reply(`✅ ${r.payout} TON → @${r.username ?? r.userId}`);
                }
                else {
                    await ctx.reply(`❌ Failed: @${r.username ?? r.userId} — ${r.error}`);
                }
            }
            const ok = results.filter(r => r.success).length;
            await ctx.reply(`🏆 Done. ${ok}/${results.length} paid.`);
        })
            .catch(async (e) => ctx.reply(`🚨 Payout error: ${e.message}`));
    });
    bot.catch(e => console.error('[AdminBot]', e.message));
    bot.start({ onStart: info => console.log(`[AdminBot] Running as @${info.username}`) });
}
