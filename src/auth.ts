import crypto from 'crypto';
import { Request, Response, NextFunction } from 'express';

/**
 * Validate Telegram Mini App initData and extract the user.
 * See: https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
 */
export function validateTelegramAuth(initData: string): TelegramUser | null {
  try {
    const params = new URLSearchParams(initData);
    const hash = params.get('hash');
    if (!hash) return null;

    params.delete('hash');
    const dataCheckString = Array.from(params.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${v}`)
      .join('\n');

    const secret = crypto
      .createHmac('sha256', 'WebAppData')
      .update(process.env.TELEGRAM_BOT_TOKEN || '')
      .digest();

    const expectedHash = crypto
      .createHmac('sha256', secret)
      .update(dataCheckString)
      .digest('hex');

    if (expectedHash !== hash) return null;

    const userStr = params.get('user');
    if (!userStr) return null;
    return JSON.parse(userStr) as TelegramUser;
  } catch {
    return null;
  }
}

export interface TelegramUser {
  id: number;
  username?: string;
  first_name?: string;
}

// Express middleware — attaches req.telegramUser or returns 401
// Express middleware — attaches req.telegramUser or returns 401
export function requireAuth(req: Request, res: Response, next: NextFunction) {
  // Development mode - allow testing from browser
  if (req.headers['x-dev-mode'] === 'true' && process.env.NODE_ENV !== 'production') {
    console.log('Dev mode: skipping auth');
    (req as any).telegramUser = { id: 123456, username: 'dev_user' };
    return next();
  }

  // Production - validate Telegram auth
  const initData = req.headers['x-telegram-init-data'] as string;
  if (!initData) {
    console.log('Missing Telegram auth header');
    return res.status(401).json({ error: 'Missing Telegram auth' });
  }

  const user = validateTelegramAuth(initData);
  if (!user) {
    console.log('Invalid Telegram auth');
    return res.status(401).json({ error: 'Invalid Telegram auth' });
  }

  (req as any).telegramUser = user;
  next();
}

// Admin-only middleware — checks user ID matches ADMIN_ID env var
export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  const user: TelegramUser = (req as any).telegramUser;
  if (!user || user.id !== parseInt(process.env.ADMIN_ID || '0', 10)) {
    return res.status(403).json({ error: 'Admin only' });
  }
  next();
}