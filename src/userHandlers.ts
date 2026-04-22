import { Bot, Context, InlineKeyboard } from 'grammy';
import {
  getAllOpenBets, getBet, addPosition, updatePools,
  getUserPositions, upsertUser, getUser
} from './db';
import { buildPaymentLink, getAdminAddress, isValidTonAddress } from './ton';
import { getSession, setSession, clearSession } from './session';
import { formatBetCard } from './format';

const MIN_BET = 0.1;

function mainMenu() {
  return new InlineKeyboard()
    .text('🎲 Open Bets', 'menu:bets')
    .text('📊 My Bets', 'menu:mybets').row()
    .text('💳 My TON Address', 'menu:wallet')
    .text('❓ Help', 'menu:help');
}

export function registerUserHandlers(bot: Bot) {

  // /start
  bot.command('start', async (ctx) => {
    const userId   = ctx.from!.id;
    const username = ctx.from!.username;
    upsertUser(userId, username);

    const user = getUser(userId);
    const hasWallet = !!user?.ton_address;

    await ctx.reply(
      `👋 Welcome to *TON Bet Bot*\\!\n\n` +
      `Bet on real\\-world statements using TON\\.\n` +
      `Winners are paid out automatically when the result is announced\\.\n\n` +
      (hasWallet
        ? `💳 Your TON address is saved\\. You\\'re ready to bet\\!`
        : `⚠️ *First, set your TON wallet address* so you can receive winnings\\.\nTap *My TON Address* below\\.`),
      {
        parse_mode: 'MarkdownV2',
        reply_markup: mainMenu(),
      }
    );
  });

  // Open bets
  bot.command('bets', sendOpenBets);
  bot.callbackQuery('menu:bets', async (ctx) => {
    await ctx.answerCallbackQuery();
    await sendOpenBets(ctx);
  });

  async function sendOpenBets(ctx: Context) {
    const bets = getAllOpenBets();
    if (!bets.length) return ctx.reply('No open bets right now. Check back soon! 🕐');

    await ctx.reply(`🎲 *Open Bets* — pick one to bet on:`, { parse_mode: 'Markdown' });
    for (const bet of bets) {
      await ctx.reply(formatBetCard(bet), {
        parse_mode: 'Markdown',
        reply_markup: new InlineKeyboard()
          .text('✅ Bet YES', `bet:yes:${bet.id}`)
          .text('❌ Bet NO',  `bet:no:${bet.id}`),
      });
    }
  }

  // My bets
  bot.command('mybets', sendMyBets);
  bot.callbackQuery('menu:mybets', async (ctx) => {
    await ctx.answerCallbackQuery();
    await sendMyBets(ctx);
  });

  async function sendMyBets(ctx: Context) {
    const userId = ctx.from?.id;
    if (!userId) return;
    const positions = getUserPositions(userId);
    if (!positions.length) return ctx.reply("You haven't placed any bets yet.");

    await ctx.reply(`📊 *Your Bets:*`, { parse_mode: 'Markdown' });
    for (const pos of positions) {
      let statusLine = '';
      if (pos.status === 'resolved') {
        statusLine = pos.result === pos.side
          ? (pos.paid_out ? '🏆 Won & Paid' : '🏆 Won — payout pending')
          : '💔 Lost';
      } else {
        statusLine = pos.status === 'open' ? '⏳ Open' : '🔒 Closed';
      }

      await ctx.reply(
        `*Bet #${pos.bet_id}* — ${statusLine}\n` +
        `📋 ${pos.statement}\n` +
        `Your side: *${pos.side.toUpperCase()}* | Stake: *${pos.amount_ton} TON*`,
        { parse_mode: 'Markdown' }
      );
    }
  }

  // Wallet address management
  bot.callbackQuery('menu:wallet', async (ctx) => {
    await ctx.answerCallbackQuery();
    const user = getUser(ctx.from.id);
    if (user?.ton_address) {
      await ctx.reply(
        `💳 *Your TON address:*\n\`${user.ton_address}\`\n\nTo change it, just send a new address:`,
        { parse_mode: 'Markdown' }
      );
    } else {
      await ctx.reply(
        `💳 You haven't set a TON address yet\\.\n\nSend me your TON wallet address \\(from Tonkeeper or any TON wallet\\):`,
        { parse_mode: 'MarkdownV2' }
      );
    }
    setSession(ctx.from.id, { step: 'set_wallet' });
  });

  // Help
  bot.callbackQuery('menu:help', async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.reply(
      `*How it works:*\n\n` +
      `1️⃣ Set your TON wallet address (tap *My TON Address*)\n` +
      `2️⃣ Browse open bets and tap YES or NO\n` +
      `3️⃣ Enter your stake amount in TON\n` +
      `4️⃣ Send the TON payment using the link provided\n` +
      `5️⃣ When the result is announced, *winners are paid automatically*\n\n` +
      `*Odds* = Total pool ÷ your side's pool\n` +
      `Example: total 10 TON, YES pool 4 TON → YES odds = 2.50x\n\n` +
      `2% fee is taken from winnings.`,
      { parse_mode: 'Markdown', reply_markup: mainMenu() }
    );
  });

  // User picks YES or NO on a bet
  bot.callbackQuery(/^bet:(yes|no):(\d+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const side  = ctx.match[1] as 'yes' | 'no';
    const betId = parseInt(ctx.match[2]);
    const bet   = getBet(betId);
    const user  = getUser(ctx.from.id);

    if (!bet || bet.status !== 'open') {
      return ctx.reply('❌ This bet is no longer open.');
    }

    // Make sure they have a TON address saved
    if (!user?.ton_address) {
      setSession(ctx.from.id, {
        step: 'set_wallet_then_bet',
        data: { betId, side },
      });
      return ctx.reply(
        `💳 You need to set your TON wallet address first so we can send you winnings.\n\nSend me your TON address:`
      );
    }

    setSession(ctx.from.id, { step: 'bet:amount', data: { betId, side } });
    await ctx.reply(
      `You chose *${side.toUpperCase()}* on:\n📋 _${bet.statement}_\n\n` +
      `How many TON do you want to bet? \\(min ${MIN_BET}\\)\n` +
      `Reply with a number, e\\.g\\. \`0\\.5\``,
      { parse_mode: 'MarkdownV2' }
    );
  });

  // All text messages — handle multi-step flows
  bot.on('message:text', async (ctx, next) => {
    const userId  = ctx.from.id;
    const text    = ctx.message.text.trim();
    const session = getSession(userId);

    // ── Setting TON wallet address ──────────────────────────────────
    if (session.step === 'set_wallet' || session.step === 'set_wallet_then_bet') {
      if (!isValidTonAddress(text)) {
        return ctx.reply('❌ That doesn\'t look like a valid TON address. Please try again:');
      }

      upsertUser(userId, ctx.from.username, text);

      // If they were in the middle of placing a bet, continue that flow
      if (session.step === 'set_wallet_then_bet') {
        const { betId, side } = session.data as { betId: number; side: 'yes' | 'no' };
        setSession(userId, { step: 'bet:amount', data: { betId, side } });
        return ctx.reply(
          `✅ TON address saved!\n\nNow, how many TON do you want to bet? (min ${MIN_BET})\nReply with a number, e.g. \`0.5\``,
          { parse_mode: 'Markdown' }
        );
      }

      clearSession(userId);
      return ctx.reply(`✅ TON address saved:\n\`${text}\``, {
        parse_mode: 'Markdown',
        reply_markup: mainMenu(),
      });
    }

    // ── Entering bet amount ─────────────────────────────────────────
    if (session.step === 'bet:amount') {
      const amount = parseFloat(text);
      if (isNaN(amount) || amount < MIN_BET) {
        return ctx.reply(`❌ Enter a valid amount (min ${MIN_BET} TON):`);
      }

      const { betId, side } = session.data as { betId: number; side: 'yes' | 'no' };
      const bet  = getBet(betId);
      const user = getUser(userId);

      if (!bet || bet.status !== 'open') {
        clearSession(userId);
        return ctx.reply('❌ That bet is no longer open.');
      }
      if (!user?.ton_address) {
        clearSession(userId);
        return ctx.reply('❌ No TON address found. Please set it first via My TON Address.');
      }

      // Record position
      addPosition(betId, userId, ctx.from.username, user.ton_address, side, amount);
      updatePools(betId, side, amount);
      clearSession(userId);

      // Build payment link
      const adminAddress = await getAdminAddress();
      const payLink = buildPaymentLink(adminAddress, amount, betId, side, userId);

      await ctx.reply(
        `✅ *Position recorded!*\n\n` +
        `Bet #${betId} | *${side.toUpperCase()}* | *${amount} TON*\n\n` +
        `📲 *Now send your TON payment:*\n` +
        `[Tap here to open TON Wallet](${payLink})\n\n` +
        `Or manually send *${amount} TON* to:\n` +
        `\`${adminAddress}\`\n` +
        `Comment: \`BET-${betId}-${side}-${userId}\`\n\n` +
        `⚠️ Send the exact amount with the comment or your bet won't be matched.`,
        {
          parse_mode: 'Markdown',
          reply_markup: mainMenu(),
          link_preview_options: { is_disabled: true },
        }
      );
      return;
    }

    return next();
  });
}