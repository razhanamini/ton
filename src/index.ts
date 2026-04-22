import 'dotenv/config';
import { Bot } from 'grammy';
import { registerAdminHandlers } from './adminHandlers';
import { registerUserHandlers } from './userHandlers';
import { getDb } from './db';

async function main() {
  getDb(); // initialise + migrate DB

  const token = process.env.BOT_TOKEN;
  if (!token) throw new Error('BOT_TOKEN is not set in .env');

  const bot = new Bot(token);

  // Order matters: user handlers registered first,
  // admin handlers added on top (they check isAdmin internally)
  registerUserHandlers(bot);
  registerAdminHandlers(bot);

  bot.catch((err) => console.error('Bot error:', err.message));

  console.log('🤖 Starting bot…');
  await bot.start({
    onStart: (info) => console.log(`✅ Running as @${info.username}`),
  });
}

main().catch(console.error);