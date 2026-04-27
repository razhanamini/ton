"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getDb = getDb;
exports.upsertUser = upsertUser;
exports.getUser = getUser;
exports.createBet = createBet;
exports.getAllOpenBets = getAllOpenBets;
exports.getAllBets = getAllBets;
exports.getBet = getBet;
exports.closeBet = closeBet;
exports.resolveBet = resolveBet;
exports.updatePools = updatePools;
exports.revertPool = revertPool;
exports.createPosition = createPosition;
exports.getPosition = getPosition;
exports.confirmPosition = confirmPosition;
exports.expirePosition = expirePosition;
exports.markPaidOut = markPaidOut;
exports.getPendingPositions = getPendingPositions;
exports.getExpiredPendingPositions = getExpiredPendingPositions;
exports.getConfirmedWinnersForBet = getConfirmedWinnersForBet;
exports.getUserPositions = getUserPositions;
const better_sqlite3_1 = __importDefault(require("better-sqlite3"));
const DB_PATH = process.env.DB_PATH || './bets.db';
let db;
function getDb() {
    if (!db) {
        db = new better_sqlite3_1.default(DB_PATH);
        db.pragma('journal_mode = WAL');
        migrate(db);
    }
    return db;
}
function migrate(db) {
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
    }
    catch (e) {
        // Column already exists — ignore error
        if (!e.message.includes('duplicate column name'))
            throw e;
    }
    try {
        db.exec(`ALTER TABLE positions ADD COLUMN paid_out INTEGER NOT NULL DEFAULT 0`);
    }
    catch (e) {
        if (!e.message.includes('duplicate column name'))
            throw e;
    }
}
// ── Users ──────────────────────────────────────────────────────────────
function upsertUser(userId, username, tonAddress) {
    getDb().prepare(`
    INSERT INTO users (user_id, username, ton_address)
    VALUES (?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET
      username    = excluded.username,
      ton_address = COALESCE(excluded.ton_address, ton_address)
  `).run(userId, username ?? null, tonAddress ?? null);
}
function getUser(userId) {
    return getDb().prepare(`SELECT * FROM users WHERE user_id = ?`).get(userId);
}
// ── Bets ───────────────────────────────────────────────────────────────
function createBet(statement, deadline) {
    const r = getDb().prepare(`INSERT INTO bets (statement, deadline) VALUES (?, ?)`).run(statement, deadline);
    return r.lastInsertRowid;
}
function getAllOpenBets() {
    return getDb().prepare(`SELECT * FROM bets WHERE status = 'open' ORDER BY deadline ASC`).all();
}
function getAllBets() {
    return getDb().prepare(`SELECT * FROM bets ORDER BY created_at DESC`).all();
}
function getBet(id) {
    return getDb().prepare(`SELECT * FROM bets WHERE id = ?`).get(id);
}
function closeBet(id) {
    getDb().prepare(`UPDATE bets SET status = 'closed' WHERE id = ?`).run(id);
}
function resolveBet(id, result) {
    getDb().prepare(`UPDATE bets SET status = 'resolved', result = ? WHERE id = ?`).run(result, id);
}
function updatePools(betId, side, amount) {
    const col = side === 'yes' ? 'yes_pool' : 'no_pool';
    getDb().prepare(`UPDATE bets SET ${col} = ${col} + ? WHERE id = ?`).run(amount, betId);
}
function revertPool(betId, side, amount) {
    const col = side === 'yes' ? 'yes_pool' : 'no_pool';
    getDb().prepare(`UPDATE bets SET ${col} = MAX(0, ${col} - ?) WHERE id = ?`).run(amount, betId);
}
// ── Positions ──────────────────────────────────────────────────────────
function createPosition(betId, userId, username, tonAddress, side, amountTon, expiresAt) {
    const r = getDb().prepare(`
    INSERT INTO positions (bet_id, user_id, username, ton_address, side, amount_ton, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(betId, userId, username ?? null, tonAddress, side, amountTon, expiresAt);
    return r.lastInsertRowid;
}
function getPosition(id) {
    return getDb().prepare(`SELECT * FROM positions WHERE id = ?`).get(id);
}
function confirmPosition(positionId, txHash) {
    getDb().prepare(`
    UPDATE positions SET status = 'confirmed', tx_hash = ? WHERE id = ?
  `).run(txHash, positionId);
}
function expirePosition(positionId) {
    getDb().prepare(`UPDATE positions SET status = 'expired' WHERE id = ?`).run(positionId);
}
function markPaidOut(positionId) {
    getDb().prepare(`UPDATE positions SET paid_out = 1 WHERE id = ?`).run(positionId);
}
function getPendingPositions() {
    return getDb().prepare(`SELECT * FROM positions WHERE status = 'pending_payment'`).all();
}
function getExpiredPendingPositions() {
    return getDb().prepare(`
    SELECT * FROM positions
    WHERE status = 'pending_payment' AND expires_at < datetime('now')
  `).all();
}
function getConfirmedWinnersForBet(betId, side) {
    return getDb().prepare(`
    SELECT * FROM positions
    WHERE bet_id = ? AND side = ? AND status = 'confirmed' AND paid_out = 0
  `).all(betId, side);
}
function getUserPositions(userId) {
    return getDb().prepare(`
    SELECT p.*, b.statement, b.status as bet_status, b.result, b.deadline
    FROM positions p JOIN bets b ON p.bet_id = b.id
    WHERE p.user_id = ?
    ORDER BY p.created_at DESC
  `).all(userId);
}
