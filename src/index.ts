import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { getDb } from './db';
import userRoutes from './routes/user';
import adminRoutes from './routes/admin';
import { startPaymentMonitor } from './paymentMonitor';
import { startAdminBot } from './adminBot';

const PORT = parseInt(process.env.PORT || '3000', 10);

async function main() {
  // Init DB
  getDb();
  // Express API
  const app = express();
  app.use(cors());
  app.use(express.json());

  app.get('/health', (_, res) => res.json({ ok: true }));
  app.use('/api/user', userRoutes);
  app.use('/api/admin', adminRoutes);

  app.listen(PORT, () => console.log(`[API] Running on port ${PORT}`));

  // Background payment monitor + expiry job
  startPaymentMonitor();

  // Admin Telegram bot (optional — comment out if using API only)
  startAdminBot();
}

main().catch(e => {
  console.error('Startup error:', e);
  process.exit(1);
});