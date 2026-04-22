import { Bot, Context, InlineKeyboard } from 'grammy';
import {
    getAllBets, getBet, closeBet, resolveBet,
    getWinnersForBet, markPaidOut
} from './db';
import { sendTon, calculatePayout, getAdminBalance, getAdminAddress } from './ton';
import { getSession, setSession, clearSession } from './session';
import { formatBetCard } from './format';
import { createBet } from './db';
import { payoutBet } from './payout';

const ADMIN_ID = parseInt(process.env.ADMIN_ID || '0', 10);

export function isAdmin(ctx: Context): boolean {
    return ctx.from?.id === ADMIN_ID;
}



export function registerAdminHandlers(bot: Bot) {

    // /admin — main panel
    bot.command('admin', async (ctx) => {
        if (!isAdmin(ctx)) return ctx.reply('⛔ Not authorized.');
        const balance = await getAdminBalance().catch(() => '?');
        const address = await getAdminAddress().catch(() => '?');

        await ctx.reply(
            `🔑 *Admin Panel*\n\n` +
            `💼 Pool wallet:\n\`${address}\`\n` +
            `💰 Balance: *${balance} TON*\n\n` +
            `Choose an action:`,
            {
                parse_mode: 'Markdown',
                reply_markup: new InlineKeyboard()
                    .text('➕ Create Bet', 'admin:create_bet').row()
                    .text('📋 List All Bets', 'admin:list_bets'),
            }
        );
    });

    // Start bet creation flow
    bot.callbackQuery('admin:create_bet', async (ctx) => {
        if (!isAdmin(ctx)) return ctx.answerCallbackQuery('Not authorized');
        await ctx.answerCallbackQuery();
        setSession(ctx.from.id, { step: 'create_bet:statement' });
        await ctx.reply('📝 Enter the bet statement:\n_e.g. "Trump will sign the bill by Friday"_', {
            parse_mode: 'Markdown',
        });
    });

    // List all bets with admin controls
    bot.callbackQuery('admin:list_bets', async (ctx) => {
        if (!isAdmin(ctx)) return ctx.answerCallbackQuery('Not authorized');
        await ctx.answerCallbackQuery();
        const bets = getAllBets();
        if (!bets.length) return ctx.reply('No bets yet.');

        for (const bet of bets) {
            const kb = new InlineKeyboard();
            if (bet.status === 'open') {
                kb.text('🔒 Close Betting', `admin:close:${bet.id}`);
            }
            if (bet.status === 'closed') {
                kb.text('✅ YES Won', `admin:resolve:${bet.id}:yes`)
                    .text('❌ NO Won', `admin:resolve:${bet.id}:no`);
            }
            await ctx.reply(formatBetCard(bet), {
                parse_mode: 'Markdown',
                reply_markup: kb,
            });
        }
    });

    // Close a bet (no new positions)
    bot.callbackQuery(/^admin:close:(\d+)$/, async (ctx) => {
        if (!isAdmin(ctx)) return ctx.answerCallbackQuery('Not authorized');
        const betId = parseInt(ctx.match[1]);
        closeBet(betId);
        await ctx.answerCallbackQuery('Bet closed ✅');
        await ctx.editMessageReplyMarkup({
            reply_markup: new InlineKeyboard()
                .text('✅ YES Won', `admin:resolve:${betId}:yes`)
                .text('❌ NO Won', `admin:resolve:${betId}:no`),
        });
    });

    // Resolve bet and pay winners
    bot.callbackQuery(/^admin:resolve:(\d+):(yes|no)$/, async (ctx) => {
        if (!isAdmin(ctx)) return ctx.answerCallbackQuery('Not authorized');
        const betId = parseInt(ctx.match[1]);
        const result = ctx.match[2] as 'yes' | 'no';
        const bet = getBet(betId);

        if (!bet) return ctx.answerCallbackQuery('Bet not found');
        if (bet.status === 'resolved') return ctx.answerCallbackQuery('Already resolved');
        if (bet.status !== 'closed') return ctx.answerCallbackQuery('Close the bet first');

        await ctx.answerCallbackQuery('Resolving…');

        // 1. Mark resolved in DB immediately
        resolveBet(betId, result);

        await ctx.reply(
            `⚙️ Bet #${betId} resolved as *${result.toUpperCase()}*\\. Sending payouts…`,
            { parse_mode: 'Markdown' }
        );

        // 2. Run payouts — this is async and won't block/timeout the bot
        //    We don't await inside the callback; we fire and report back via separate messages
        payoutBet(betId)
            .then(async (results) => {
                const succeeded = results.filter(r => r.success);
                const failed = results.filter(r => !r.success);

                // Report successes
                for (const r of succeeded) {
                    await ctx.reply(
                        `✅ *${r.payout.toFixed(4)} TON* → \`${r.pos.ton_address}\`\n` +
                        `   @${r.pos.username ?? r.pos.user_id} | staked ${r.pos.amount_ton} TON`,
                        { parse_mode: 'Markdown' }
                    );
                }

                // Report failures (admin needs to handle these manually)
                for (const r of failed) {
                    await ctx.reply(
                        `❌ *Failed:* @${r.pos.username ?? r.pos.user_id}\n` +
                        `   Address: \`${r.pos.ton_address ?? 'none'}\`\n` +
                        `   Reason: ${r.error}`,
                        { parse_mode: 'Markdown' }
                    );
                }

                await ctx.reply(
                    `🏆 *Bet #${betId} complete*\n` +
                    `✅ Paid: ${succeeded.length} | ❌ Failed: ${failed.length}`,
                    { parse_mode: 'Markdown' }
                );
            })
            .catch(async (e) => {
                // This should never fire since payoutBet handles errors internally,
                // but just in case
                await ctx.reply(`🚨 Payout job crashed for bet #${betId}: ${e.message}`);
            });
    });

    // Text handler: multi-step create bet flow
    bot.on('message:text', async (ctx, next) => {
        if (!isAdmin(ctx)) return next();
        const session = getSession(ctx.from.id);

        if (session.step === 'create_bet:statement') {
            setSession(ctx.from.id, {
                step: 'create_bet:deadline',
                data: { statement: ctx.message.text },
            });
            return ctx.reply('📅 Enter the deadline:\n_e.g. "2024-12-31 18:00" or "by Monday noon"_', {
                parse_mode: 'Markdown',
            });
        }

        if (session.step === 'create_bet:deadline') {
            const statement = session.data?.statement as string;
            const deadline = ctx.message.text;
            const id = createBet(statement, deadline);
            clearSession(ctx.from.id);
            return ctx.reply(
                `✅ *Bet #${id} created!*\n\n📋 ${statement}\n⏰ ${deadline}`,
                { parse_mode: 'Markdown' }
            );
        }

        return next();
    });
}