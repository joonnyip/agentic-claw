// ============================================================
//  AGENTIC CLAW — Persistence Layer v2.3
//  Created by Joon Nyip Koh (OpenClaw Researcher)
//
//  SQLite-backed storage for:
//    • Agents (rehydrated on boot)
//    • Trades (full history, 10k cap)
//    • P&L snapshots (sampled every 60s, 90-day retention)
//    • Positions (currently open CTF positions)
//
//  Gracefully degrades to no-op stub if better-sqlite3 is
//  not installed — app boots fine, persistence disabled.
// ============================================================

const path = require('path');
const fs   = require('fs');

// ── Optional better-sqlite3 import ──────────────────────────
// Fall back to a no-op stub if the native module isn't compiled.
// This lets the app boot even before `npm install` has been run,
// and makes the persistence layer truly optional.
let Database = null;
try {
  Database = require('better-sqlite3');
} catch (e) {
  console.warn('\x1b[33m[WARN] [PERSISTENCE]\x1b[0m better-sqlite3 not available — running without persistence. Run `npm install` to enable.');
}

const DATA_DIR = process.env.AGENTIC_CLAW_DATA || path.join(process.env.HOME || process.env.USERPROFILE || '.', '.agentic-claw');
const DB_PATH  = path.join(DATA_DIR, 'agentic-claw.db');
const SCHEMA_VERSION = 1;

let db = null;
let stmts = {};  // cached prepared statements
let enabled = false;

// ── Schema ──────────────────────────────────────────────────
function migrate() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_version (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS agents (
      id          TEXT PRIMARY KEY,
      short_id    TEXT NOT NULL,
      name        TEXT NOT NULL,
      strategy    TEXT NOT NULL,
      status      TEXT NOT NULL,
      budget      REAL NOT NULL,
      remaining   REAL NOT NULL,
      trade_count INTEGER NOT NULL DEFAULT 0,
      win_count   INTEGER NOT NULL DEFAULT 0,
      pnl         REAL NOT NULL DEFAULT 0,
      last_action TEXT,
      created_at  TEXT NOT NULL,
      updated_at  TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_agents_status ON agents(status);

    CREATE TABLE IF NOT EXISTS trades (
      id         TEXT PRIMARY KEY,
      ts         TEXT NOT NULL,
      market_id  TEXT NOT NULL,
      question   TEXT,
      side       TEXT NOT NULL,
      amount     REAL NOT NULL,
      shares     REAL,
      price      REAL,
      slippage   TEXT,
      agent_id   TEXT,
      status     TEXT,
      balance    REAL,
      pnl        REAL
    );

    CREATE INDEX IF NOT EXISTS idx_trades_ts       ON trades(ts DESC);
    CREATE INDEX IF NOT EXISTS idx_trades_agent    ON trades(agent_id);
    CREATE INDEX IF NOT EXISTS idx_trades_market   ON trades(market_id);

    CREATE TABLE IF NOT EXISTS pnl_snapshots (
      ts              TEXT PRIMARY KEY,
      total_balance   REAL NOT NULL,
      realized_pnl    REAL NOT NULL,
      unrealized_pnl  REAL NOT NULL,
      open_positions  INTEGER NOT NULL,
      active_agents   INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_snapshots_ts ON pnl_snapshots(ts DESC);

    CREATE TABLE IF NOT EXISTS positions (
      market_id   TEXT NOT NULL,
      side        TEXT NOT NULL,
      shares      REAL NOT NULL,
      avg_price   REAL NOT NULL,
      opened_at   TEXT NOT NULL,
      closed_at   TEXT,
      question    TEXT,
      PRIMARY KEY (market_id, side, opened_at)
    );

    CREATE INDEX IF NOT EXISTS idx_positions_open ON positions(closed_at);
  `);

  // Record schema version
  const existing = db.prepare('SELECT MAX(version) as v FROM schema_version').get();
  if (!existing.v || existing.v < SCHEMA_VERSION) {
    db.prepare('INSERT INTO schema_version (version, applied_at) VALUES (?, ?)')
      .run(SCHEMA_VERSION, new Date().toISOString());
  }
}

// ── Prepared statements ────────────────────────────────────
function prepareStatements() {
  stmts.upsertAgent = db.prepare(`
    INSERT INTO agents (id, short_id, name, strategy, status, budget, remaining,
                        trade_count, win_count, pnl, last_action, created_at, updated_at)
    VALUES (@id, @shortId, @name, @strategy, @status, @budget, @remaining,
            @tradeCount, @winCount, @pnl, @lastAction, @createdAt, @updatedAt)
    ON CONFLICT(id) DO UPDATE SET
      status      = excluded.status,
      remaining   = excluded.remaining,
      trade_count = excluded.trade_count,
      win_count   = excluded.win_count,
      pnl         = excluded.pnl,
      last_action = excluded.last_action,
      updated_at  = excluded.updated_at
  `);

  stmts.deleteAgent = db.prepare('DELETE FROM agents WHERE id = ?');

  stmts.loadAgents = db.prepare(`
    SELECT * FROM agents WHERE status NOT IN ('STOPPED', 'stopped')
    ORDER BY created_at ASC
  `);

  stmts.insertTrade = db.prepare(`
    INSERT INTO trades (id, ts, market_id, question, side, amount, shares, price,
                        slippage, agent_id, status, balance, pnl)
    VALUES (@id, @ts, @marketId, @question, @side, @amount, @shares, @price,
            @slippage, @agentId, @status, @balance, @pnl)
  `);

  stmts.recentTrades = db.prepare(`
    SELECT * FROM trades ORDER BY ts DESC LIMIT ?
  `);

  stmts.trimTrades = db.prepare(`
    DELETE FROM trades WHERE id NOT IN (
      SELECT id FROM trades ORDER BY ts DESC LIMIT 10000
    )
  `);

  stmts.insertSnapshot = db.prepare(`
    INSERT OR REPLACE INTO pnl_snapshots
      (ts, total_balance, realized_pnl, unrealized_pnl, open_positions, active_agents)
    VALUES (@ts, @totalBalance, @realizedPnl, @unrealizedPnl, @openPositions, @activeAgents)
  `);

  stmts.trimSnapshots = db.prepare(`
    DELETE FROM pnl_snapshots WHERE ts < ?
  `);

  // Downsampled queries — GROUP BY a time bucket, take average per bucket
  // SQLite's strftime handles the bucketing. Returns time-sorted ASC for charting.
  stmts.history7d = db.prepare(`
    SELECT
      MIN(ts) as ts,
      AVG(total_balance)  as total_balance,
      AVG(realized_pnl)   as realized_pnl,
      AVG(unrealized_pnl) as unrealized_pnl,
      MAX(open_positions) as open_positions,
      MAX(active_agents)  as active_agents
    FROM pnl_snapshots
    WHERE ts >= ?
    GROUP BY strftime('%Y-%m-%d %H:%M', ts)
    ORDER BY ts ASC
  `);

  stmts.history30d = db.prepare(`
    SELECT
      MIN(ts) as ts,
      AVG(total_balance)  as total_balance,
      AVG(realized_pnl)   as realized_pnl,
      AVG(unrealized_pnl) as unrealized_pnl,
      MAX(open_positions) as open_positions,
      MAX(active_agents)  as active_agents
    FROM pnl_snapshots
    WHERE ts >= ?
    GROUP BY substr(ts, 1, 15)
    ORDER BY ts ASC
  `);
  // substr(ts, 1, 15) = 'YYYY-MM-DDTHH:M' → 10-minute buckets
  // (SQLite ISO strings are lexicographically sortable)

  stmts.history90d = db.prepare(`
    SELECT
      MIN(ts) as ts,
      AVG(total_balance)  as total_balance,
      AVG(realized_pnl)   as realized_pnl,
      AVG(unrealized_pnl) as unrealized_pnl,
      MAX(open_positions) as open_positions,
      MAX(active_agents)  as active_agents
    FROM pnl_snapshots
    WHERE ts >= ?
    GROUP BY substr(ts, 1, 13)
    ORDER BY ts ASC
  `);
  // substr(ts, 1, 13) = 'YYYY-MM-DDTHH' → 1-hour buckets

  stmts.upsertPosition = db.prepare(`
    INSERT INTO positions (market_id, side, shares, avg_price, opened_at, question)
    VALUES (@marketId, @side, @shares, @avgPrice, @openedAt, @question)
    ON CONFLICT(market_id, side, opened_at) DO UPDATE SET
      shares    = excluded.shares,
      avg_price = excluded.avg_price
  `);

  stmts.closePosition = db.prepare(`
    UPDATE positions SET closed_at = ?
    WHERE market_id = ? AND side = ? AND closed_at IS NULL
  `);

  stmts.openPositions = db.prepare(`
    SELECT * FROM positions WHERE closed_at IS NULL
  `);
}

// ── Public API ──────────────────────────────────────────────
function init() {
  if (!Database) return false;
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');          // better concurrency
    db.pragma('synchronous = NORMAL');        // faster, still durable
    db.pragma('foreign_keys = ON');
    migrate();
    prepareStatements();
    enabled = true;
    console.log(`\x1b[36m[INFO] [PERSISTENCE]\x1b[0m SQLite ready at ${DB_PATH}`);
    return true;
  } catch (e) {
    console.error(`\x1b[31m[ERROR] [PERSISTENCE]\x1b[0m Init failed: ${e.message}`);
    enabled = false;
    return false;
  }
}

function isEnabled() { return enabled; }

function close() {
  if (db) { db.close(); db = null; enabled = false; }
}

// ── Agents ──────────────────────────────────────────────────
function saveAgent(agent) {
  if (!enabled) return;
  try {
    stmts.upsertAgent.run({
      id:          agent.id,
      shortId:     agent.shortId,
      name:        agent.name,
      strategy:    agent.strategy,
      status:      agent.status,
      budget:      agent.budget,
      remaining:   agent.remaining,
      tradeCount:  agent.tradeCount || 0,
      winCount:    agent.winCount || 0,
      pnl:         agent.pnl || 0,
      lastAction:  agent.lastAction || null,
      createdAt:   agent.createdAt,
      updatedAt:   new Date().toISOString(),
    });
  } catch (e) {
    console.error(`[PERSISTENCE] saveAgent failed: ${e.message}`);
  }
}

function deleteAgent(id) {
  if (!enabled) return;
  try { stmts.deleteAgent.run(id); } catch (e) { console.error(`[PERSISTENCE] deleteAgent failed: ${e.message}`); }
}

function loadAgents() {
  if (!enabled) return [];
  try {
    return stmts.loadAgents.all().map(row => ({
      id:          row.id,
      shortId:     row.short_id,
      name:        row.name,
      strategy:    row.strategy,
      status:      row.status,
      budget:      row.budget,
      remaining:   row.remaining,
      tradeCount:  row.trade_count,
      winCount:    row.win_count,
      pnl:         row.pnl,
      lastAction:  row.last_action,
      createdAt:   row.created_at,
    }));
  } catch (e) {
    console.error(`[PERSISTENCE] loadAgents failed: ${e.message}`);
    return [];
  }
}

// ── Trades ──────────────────────────────────────────────────
function recordTrade(trade) {
  if (!enabled) return;
  try {
    stmts.insertTrade.run({
      id:        trade.id,
      ts:        trade.ts,
      marketId:  trade.marketId,
      question:  trade.question || null,
      side:      trade.side,
      amount:    parseFloat(trade.amount) || 0,
      shares:    parseFloat(trade.shares) || 0,
      price:     parseFloat(trade.price) || 0,
      slippage:  trade.slippage || null,
      agentId:   trade.agentId || null,
      status:    trade.status || 'FILLED',
      balance:   parseFloat(trade.balance) || null,
      pnl:       parseFloat(trade.pnl) || 0,
    });
  } catch (e) {
    // Ignore duplicate inserts silently (idempotent)
    if (!String(e.message).includes('UNIQUE')) {
      console.error(`[PERSISTENCE] recordTrade failed: ${e.message}`);
    }
  }
}

function recentTrades(limit = 200) {
  if (!enabled) return [];
  try { return stmts.recentTrades.all(Math.min(limit, 1000)); }
  catch (e) { return []; }
}

// ── P&L Snapshots ───────────────────────────────────────────
function saveSnapshot(snap) {
  if (!enabled) return;
  try {
    stmts.insertSnapshot.run({
      ts:             snap.ts || new Date().toISOString(),
      totalBalance:   snap.totalBalance || 0,
      realizedPnl:    snap.realizedPnl  || 0,
      unrealizedPnl:  snap.unrealizedPnl || 0,
      openPositions:  snap.openPositions || 0,
      activeAgents:   snap.activeAgents || 0,
    });
  } catch (e) {
    console.error(`[PERSISTENCE] saveSnapshot failed: ${e.message}`);
  }
}

function pnlHistory(range = '7d') {
  if (!enabled) return [];
  const now = Date.now();
  let cutoff, stmt;
  switch (range) {
    case '30d': cutoff = now - 30 * 86400 * 1000; stmt = stmts.history30d; break;
    case '90d': cutoff = now - 90 * 86400 * 1000; stmt = stmts.history90d; break;
    case '7d':
    default:    cutoff = now -  7 * 86400 * 1000; stmt = stmts.history7d;  break;
  }
  try {
    return stmt.all(new Date(cutoff).toISOString());
  } catch (e) {
    console.error(`[PERSISTENCE] pnlHistory failed: ${e.message}`);
    return [];
  }
}

// Delete snapshots older than 90 days. Called nightly.
function trimSnapshots() {
  if (!enabled) return 0;
  try {
    const cutoff = new Date(Date.now() - 90 * 86400 * 1000).toISOString();
    const info = stmts.trimSnapshots.run(cutoff);
    return info.changes;
  } catch (e) { return 0; }
}

function trimTrades() {
  if (!enabled) return 0;
  try {
    const info = stmts.trimTrades.run();
    return info.changes;
  } catch (e) { return 0; }
}

// ── Positions ───────────────────────────────────────────────
function savePosition(pos) {
  if (!enabled) return;
  try {
    stmts.upsertPosition.run({
      marketId:  pos.marketId,
      side:      pos.side,
      shares:    pos.shares,
      avgPrice:  pos.avgPrice,
      openedAt:  pos.openedAt || new Date().toISOString(),
      question:  pos.question || null,
    });
  } catch (e) {
    console.error(`[PERSISTENCE] savePosition failed: ${e.message}`);
  }
}

function closePosition(marketId, side) {
  if (!enabled) return;
  try {
    stmts.closePosition.run(new Date().toISOString(), marketId, side);
  } catch (e) {
    console.error(`[PERSISTENCE] closePosition failed: ${e.message}`);
  }
}

function openPositions() {
  if (!enabled) return [];
  try { return stmts.openPositions.all(); }
  catch (e) { return []; }
}

// ── Stats ───────────────────────────────────────────────────
function stats() {
  if (!enabled) return { enabled: false };
  try {
    return {
      enabled: true,
      dbPath:  DB_PATH,
      agents:     db.prepare('SELECT COUNT(*) as c FROM agents').get().c,
      trades:     db.prepare('SELECT COUNT(*) as c FROM trades').get().c,
      snapshots:  db.prepare('SELECT COUNT(*) as c FROM pnl_snapshots').get().c,
      positions:  db.prepare('SELECT COUNT(*) as c FROM positions').get().c,
      schemaVer:  SCHEMA_VERSION,
    };
  } catch (e) {
    return { enabled: true, error: e.message };
  }
}

module.exports = {
  init, close, isEnabled, stats,
  saveAgent, deleteAgent, loadAgents,
  recordTrade, recentTrades, trimTrades,
  saveSnapshot, pnlHistory, trimSnapshots,
  savePosition, closePosition, openPositions,
  DATA_DIR, DB_PATH,
};
