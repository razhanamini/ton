import crypto from 'crypto';
import { Request, Response, NextFunction } from 'express';

/**
 * Validate Telegram Mini App initData and extract the user.
 * See: https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
 */
// src/auth.ts

const BOT_TOKEN = process.env.BOT_TOKEN || ''; // Your bot token from @BotFather

export function validateTelegramAuth(initData: string): any | null {
  try {
    // Parse the initData string into a URLSearchParams object
    const params = new URLSearchParams(initData);
    
    // Get the hash that Telegram sent
    const hash = params.get('hash');
    if (!hash) return null;
    
    // Remove the hash from the params for validation
    params.delete('hash');
    
    // Sort the remaining parameters alphabetically by key
    const keys = Array.from(params.keys()).sort();
    const dataCheckString = keys
      .map(key => `${key}=${params.get(key)}`)
      .join('\n');
    
    // Create secret key: HMAC-SHA256 of "WebAppData" with bot token as key
    const secretKey = crypto
      .createHmac('sha256', 'WebAppData')
      .update(BOT_TOKEN)
      .digest();
    
    // Create signature: HMAC-SHA256 of dataCheckString with secretKey
    const signature = crypto
      .createHmac('sha256', secretKey)
      .update(dataCheckString)
      .digest('hex');
    
    // Compare signatures
    if (signature !== hash) {
      console.error('Invalid hash signature');
      return null;
    }
    
    // Check if the data is not older than 1 day (optional, but recommended)
    const authDate = parseInt(params.get('auth_date') || '0');
    const now = Math.floor(Date.now() / 1000);
    if (now - authDate > 86400) { // 24 hours
      console.error('Auth data expired');
      return null;
    }
    
    // Parse and return the user data
    const user = JSON.parse(params.get('user') || '{}');
    return user;
    
  } catch (error) {
    console.error('Validation error:', error);
    return null;
  }
}

// Express middleware — attaches req.telegramUser or returns 401
export function requireAuth(req: Request, res: Response, next: NextFunction) {
  // Development mode - allow testing from browser
  if (req.headers['x-dev-mode'] === 'true' && process.env.NODE_ENV !== 'production') {
    console.log('Dev mode: skipping auth');
    (req as any).telegramUser = { id: 123456, username: 'dev_user' };
    return next();
  }

  // Get initData from headers
  const initData = req.headers['x-telegram-init-data'] as string;
  if (!initData) {
    console.log('Missing Telegram auth header');
    return res.status(401).json({ error: 'Missing Telegram auth' });
  }

  // Validate the data
  const user = validateTelegramAuth(initData);
  if (!user) {
    console.log('Invalid Telegram auth');
    return res.status(401).json({ error: 'Invalid Telegram auth' });
  }

  (req as any).telegramUser = user;
  next();
}

export interface TelegramUser {
  id: number;
  username?: string;
  first_name?: string;
}

// Express middleware — attaches req.telegramUser or returns 401
// Express middleware — attaches req.telegramUser or returns 401
// export function requireAuth(req: Request, res: Response, next: NextFunction) {
//   // Development mode - allow testing from browser
//   if (req.headers['x-dev-mode'] === 'true' && process.env.NODE_ENV !== 'production') {
//     console.log('Dev mode: skipping auth');
//     (req as any).telegramUser = { id: 123456, username: 'dev_user' };
//     return next();
//   }

//   // Production - validate Telegram auth
//   const initData = req.headers['x-telegram-init-data'] as string;
//   if (!initData) {
//     console.log('Missing Telegram auth header');
//     return res.status(401).json({ error: 'Missing Telegram auth' });
//   }

//   const user = validateTelegramAuth(initData);
//   if (!user) {
//     console.log('Invalid Telegram auth');
//     return res.status(401).json({ error: 'Invalid Telegram auth' });
//   }

//   (req as any).telegramUser = user;
//   next();
// }

// Admin-only middleware — checks user ID matches ADMIN_ID env var
export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  const user: TelegramUser = (req as any).telegramUser;
  if (!user || user.id !== parseInt(process.env.ADMIN_ID || '0', 10)) {
    return res.status(403).json({ error: 'Admin only' });
  }
  next();
}