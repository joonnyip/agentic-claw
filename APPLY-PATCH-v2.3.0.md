# Agentic Claw v2.3.0 — Persistent State & Portfolio P&L

First feature release in the roadmap. Adds SQLite-backed persistence so
agents survive restarts, and a Portfolio P&L tracker with 7D/30D/90D history.

## How to apply

```bash
cd ~/AgenticClaw           # or wherever your checkout lives
git checkout main
git pull origin main       # make sure you're on top of v2.2.2 first

# Apply the v2.3.0 commit
git am agentic-claw-v2.3.0.patch

# Install the new dependency (better-sqlite3 compiles natively ~10s on macOS)
npm install

# Boot — you should see a PERSISTENCE ready line in the log
node server/index.js
```

Open http://localhost:3747 — you'll see the new **PORTFOLIO P&L** panel in
column 3 (between MIROFISH AI and TRADE FEED). It will show "Collecting
samples..." for the first minute while the snapshot sampler warms up,
then draw a line chart.

## What this release does

### Agents survive restarts
Stop the server with Ctrl+C, wait, restart — your agents come back with
the same budget remaining, trade count, P&L, and last action. First boot
of v2.3 still spawns the two starters; subsequent boots rehydrate whatever
you had running.

### Portfolio P&L chart
- Fixed row of 3 toggle buttons: 7D (1-min buckets), 30D (10-min buckets), 90D (1-hour buckets)
- Delta shown in section header: `+$12.40 (+2.1%)` when up, red when down
- Server samples every 60s, chart refreshes every 60s — no WS traffic

### Two new terminal commands
```
$ pnl 7d
P&L HISTORY — 7D (412 samples)
  First sample:  2026-04-10 09:34:12  bal=$1000.00
  Latest sample: 2026-04-17 16:44:03  bal=$1014.22
  Change:        +$14.22  realized=+$14.22
  Open positions: 0   Active agents: 2

$ persist
PERSISTENCE STATS
  Database:   /Users/you/.agentic-claw/agentic-claw.db
  Schema:     v1
  Agents:     2
  Trades:     87
  Snapshots:  412
  Positions:  0
```

## Where your data lives

```
~/.agentic-claw/
├── agentic-claw.db           # SQLite main file
├── agentic-claw.db-wal       # write-ahead log (normal)
└── agentic-claw.db-shm       # shared-memory file (normal)
```

Override with env var: `AGENTIC_CLAW_DATA=/custom/path node server/index.js`

**Back up** by copying all three files while the server is stopped. While
running, copy the `.db` file only — SQLite will merge the WAL on next start.

## If you need to wipe state

```bash
rm -rf ~/.agentic-claw     # nuke everything and start fresh
```

Next boot will spawn the two starter agents like a first run.

## Troubleshooting

**`[WARN] [PERSISTENCE] Running without persistence` on boot**
`better-sqlite3` didn't install cleanly. Usually means Xcode command-line
tools aren't present. Fix:
```bash
xcode-select --install
cd ~/AgenticClaw
npm rebuild better-sqlite3
node server/index.js
```
The app runs fine without it — just loses persistence.

**`npm install` takes 30+ seconds**
Native compile. Normal on first install. Cached afterwards.

**P&L chart stays empty**
Needs at least 2 snapshots (so ~2 minutes from first boot). Also check
`persist` in the terminal — if `Snapshots: 0` after 2 minutes, the sampler
isn't running (check the server log for `[ERROR] [SNAPSHOT]` entries).

**Migrating an existing install**
No manual steps. On first boot, persistence sees an empty DB and creates
the schema. Your in-memory agents from the old session will be gone, but
that's consistent with how v2.2 worked.

## Schema reference (v1)

```sql
agents        (id, short_id, name, strategy, status, budget, remaining,
               trade_count, win_count, pnl, last_action, created_at, updated_at)
trades        (id, ts, market_id, question, side, amount, shares, price,
               slippage, agent_id, status, balance, pnl)
pnl_snapshots (ts, total_balance, realized_pnl, unrealized_pnl,
               open_positions, active_agents)
positions     (market_id, side, shares, avg_price, opened_at, closed_at, question)
```

Future v2.4/v2.5 schema changes will use `schema_version` for migrations.

## What's next

Roadmap v2.4 — Beast Mode / Panda Mode + 3 new Mirofish models. Still
simulated, so fast iteration on UX. After that: v2.5 Live trading.

Created by Joon Nyip Koh (OpenClaw Researcher)
