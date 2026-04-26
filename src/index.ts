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

  app.get('/health', (req, res) => {
    res.status(200).send('OK')
  })

  // Also add CORS for development
  app.use(cors({
    origin: ['http://localhost:5173', 'http://localhost:8080'],
    credentials: true
  }))

  // Background payment monitor + expiry job
  startPaymentMonitor();

  // Admin Telegram bot (optional — comment out if using API only)
  startAdminBot();
}

main().catch(e => {
  console.error('Startup error:', e);
  process.exit(1);
});

