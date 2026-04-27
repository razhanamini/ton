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

  // Dynamic CORS configuration
  const allowedOrigins = [
    'http://localhost:5173',
    'http://localhost:8080',
    'https://ton-front.vercel.app',  // Replace with your Vercel URL
    /\.vercel\.app$/                  // Allow all Vercel preview deployments
  ];

  // app.use(cors({
  //   origin: function (origin, callback) {
  //     // Allow requests with no origin (like mobile apps or curl)
  //     if (!origin) return callback(null, true);

  //     // Check if origin is allowed
  //     const isAllowed = allowedOrigins.some(allowed => {
  //       if (allowed instanceof RegExp) {
  //         return allowed.test(origin);
  //       }
  //       return allowed === origin;
  //     });

  //     if (isAllowed) {
  //       callback(null, true);
  //     } else {
  //       console.log(`CORS blocked: ${origin}`);
  //       callback(new Error('Not allowed by CORS'));
  //     }
  //   },
  //   credentials: true,
  //   methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  //   allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
  // }));
  app.use(cors({
    origin: '*',  // Allows all origins (testing only)
    credentials: false  // Must be false when origin is '*'
  }));

  app.use(express.json());

  // Routes
  app.get('/health', (_, res) => res.json({ ok: true }));
  app.use('/api/user', userRoutes);
  app.use('/api/admin', adminRoutes);

  // Start server
  app.listen(PORT, () => console.log(`[API] Running on port ${PORT}`));

  // Background payment monitor + expiry job
  startPaymentMonitor();

  // Admin Telegram bo
  startAdminBot();
}

main().catch(e => {
  console.error('Startup error:', e);
  process.exit(1);
});