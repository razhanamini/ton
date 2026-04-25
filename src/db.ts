import Database from 'better-sqlite3';

const DB_PATH = process.env.DB_PATH || './bets.db';
let db: Database.Database;

export function getDb(): Database.Database {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    migrate(db);
  }
  return db;
}

function migrate(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      user_id     INTEGER PRIMARY KEY,
      username    TEXT,
      ton_address TEXT,
      created_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS bets (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      statement   TEXT NOT NULL,
      deadline    TEXT NOT NULL,
      status      TEXT NOT NULL DEFAULT 'open',
      result      TEXT,
      yes_pool    REAL NOT NULL DEFAULT 0,
      no_pool     REAL NOT NULL DEFAULT 0,
      created_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS positions (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      bet_id        INTEGER NOT NULL REFERENCES bets(id),
      user_id       INTEGER NOT NULL,
      username      TEXT,
      ton_address   TEXT NOT NULL,
      side          TEXT NOT NULL,
      amount_ton    REAL NOT NULL,
      status        TEXT NOT NULL DEFAULT 'pending_payment',
      tx_hash       TEXT,
      expires_at    TEXT NOT NULL,
      paid_out      INTEGER NOT NULL DEFAULT 0,
      created_at    TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  // Add missing columns to existing tables
  try {
    db.exec(`ALTER TABLE positions ADD COLUMN status TEXT DEFAULT 'pending_payment'`);
  } catch (e: any) {
    // Column already exists — ignore error
    if (!e.message.includes('duplicate column name')) throw e;
  }
  
  try {
    db.exec(`ALTER TABLE positions ADD COLUMN paid_out INTEGER NOT NULL DEFAULT 0`);
  } catch (e: any) {
    if (!e.message.includes('duplicate column name')) throw e;
  }
}

// ── Users ──────────────────────────────────────────────────────────────

export function upsertUser(userId: number, username: string | undefined, tonAddress?: string) {
  getDb().prepare(`
    INSERT INTO users (user_id, username, ton_address)
    VALUES (?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET
      username    = excluded.username,
      ton_address = COALESCE(excluded.ton_address, ton_address)
  `).run(userId, username ?? null, tonAddress ?? null);
}

export function getUser(userId: number): User | undefined {
  return getDb().prepare(`SELECT * FROM users WHERE user_id = ?`).get(userId) as User | undefined;
}

// ── Bets ───────────────────────────────────────────────────────────────

export function createBet(statement: string, deadline: string): number {
  const r = getDb().prepare(
    `INSERT INTO bets (statement, deadline) VALUES (?, ?)`
  ).run(statement, deadline);
  return r.lastInsertRowid as number;
}

export function getAllOpenBets(): Bet[] {
  return getDb().prepare(
    `SELECT * FROM bets WHERE status = 'open' ORDER BY deadline ASC`
  ).all() as Bet[];
}

export function getAllBets(): Bet[] {
  return getDb().prepare(`SELECT * FROM bets ORDER BY created_at DESC`).all() as Bet[];
}

export function getBet(id: number): Bet | undefined {
  return getDb().prepare(`SELECT * FROM bets WHERE id = ?`).get(id) as Bet | undefined;
}

export function closeBet(id: number) {
  getDb().prepare(`UPDATE bets SET status = 'closed' WHERE id = ?`).run(id);
}

export function resolveBet(id: number, result: 'yes' | 'no') {
  getDb().prepare(`UPDATE bets SET status = 'resolved', result = ? WHERE id = ?`).run(result, id);
}

export function updatePools(betId: number, side: 'yes' | 'no', amount: number) {
  const col = side === 'yes' ? 'yes_pool' : 'no_pool';
  getDb().prepare(`UPDATE bets SET ${col} = ${col} + ? WHERE id = ?`).run(amount, betId);
}

export function revertPool(betId: number, side: 'yes' | 'no', amount: number) {
  const col = side === 'yes' ? 'yes_pool' : 'no_pool';
  getDb().prepare(`UPDATE bets SET ${col} = MAX(0, ${col} - ?) WHERE id = ?`).run(amount, betId);
}

// ── Positions ──────────────────────────────────────────────────────────

export function createPosition(
  betId: number, userId: number, username: string | undefined,
  tonAddress: string, side: 'yes' | 'no', amountTon: number, expiresAt: string
): number {
  const r = getDb().prepare(`
    INSERT INTO positions (bet_id, user_id, username, ton_address, side, amount_ton, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(betId, userId, username ?? null, tonAddress, side, amountTon, expiresAt);
  return r.lastInsertRowid as number;
}

export function getPosition(id: number): Position | undefined {
  return getDb().prepare(`SELECT * FROM positions WHERE id = ?`).get(id) as Position | undefined;
}

export function confirmPosition(positionId: number, txHash: string) {
  getDb().prepare(`
    UPDATE positions SET status = 'confirmed', tx_hash = ? WHERE id = ?
  `).run(txHash, positionId);
}

export function expirePosition(positionId: number) {
  getDb().prepare(`UPDATE positions SET status = 'expired' WHERE id = ?`).run(positionId);
}

export function markPaidOut(positionId: number) {
  getDb().prepare(`UPDATE positions SET paid_out = 1 WHERE id = ?`).run(positionId);
}

export function getPendingPositions(): Position[] {
  return getDb().prepare(
    `SELECT * FROM positions WHERE status = 'pending_payment'`
  ).all() as Position[];
}

export function getExpiredPendingPositions(): Position[] {
  return getDb().prepare(`
    SELECT * FROM positions
    WHERE status = 'pending_payment' AND expires_at < datetime('now')
  `).all() as Position[];
}

export function getConfirmedWinnersForBet(betId: number, side: 'yes' | 'no'): Position[] {
  return getDb().prepare(`
    SELECT * FROM positions
    WHERE bet_id = ? AND side = ? AND status = 'confirmed' AND paid_out = 0
  `).all(betId, side) as Position[];
}

export function getUserPositions(userId: number): (Position & Pick<Bet, 'statement' | 'status' | 'result' | 'deadline'>)[] {
  return getDb().prepare(`
    SELECT p.*, b.statement, b.status as bet_status, b.result, b.deadline
    FROM positions p JOIN bets b ON p.bet_id = b.id
    WHERE p.user_id = ?
    ORDER BY p.created_at DESC
  `).all(userId) as any;
}

// ── Types ──────────────────────────────────────────────────────────────

export interface User {
  user_id: number;
  username: string | null;
  ton_address: string | null;
}

export interface Bet {
  id: number;
  statement: string;
  deadline: string;
  status: 'open' | 'closed' | 'resolved';
  result: 'yes' | 'no' | null;
  yes_pool: number;
  no_pool: number;
  created_at: string;
}

export interface Position {
  id: number;
  bet_id: number;
  user_id: number;
  username: string | null;
  ton_address: string;
  side: 'yes' | 'no';
  amount_ton: number;
  status: 'pending_payment' | 'confirmed' | 'expired';
  tx_hash: string | null;
  expires_at: string;
  paid_out: number;
  created_at: string;
}