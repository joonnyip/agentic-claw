// ============================================================
//  AGENTIC CLAW — Mission Control Server v2.2
//  Created by Joon Nyip Koh (OpenClaw Researcher)
//  FIXES: interval try/catch, switch-case braces, route order,
//         terminal command bugs, AGENTS_UPDATE serialization
// ============================================================

const express = require('express');
const http    = require('http');
const WebSocket = require('ws');
const cors    = require('cors');
const path    = require('path');
const { v4: uuidv4 } = require('uuid');

const gateway       = require('./gateway');
const AgentManager  = require('./agents/AgentManager');
const polymarket    = require('./polymarket');
const mirofish      = require('./mirofish');
const newsModule    = require('./news');
const pricesModule  = require('./prices');
const walletModule  = require('./wallet');

const app    = express();
const server = http.createServer(app);
const wss    = new WebSocket.Server({ server });
const PORT   = process.env.PORT || 3747;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../frontend')));

// ── State ──────────────────────────────────────────────────
const state = {
  connected:   0,
  uptime:      Date.now(),
  logs:        [],
  trades:      [],
  agents:      {},      // keyed by id, plain objects (no class instances)
  markets:     [],
  predictions: [],
  news:        [],
  prices:      [],
};

// ── Logger ─────────────────────────────────────────────────
// FIX #31 — broadcast important levels only. Previously every log entry
// was sent as its own WS message, and with 6 agents ticking + HTTP access
// logs + periodic fetches, clients were flooded. WARN/ERROR/TRADE/AGENT
// are what users care about; INFO/GATEWAY stay local (still console'd
// and kept in state.logs for the /api/logs endpoint).
const BROADCAST_LEVELS = new Set(['WARN', 'ERROR', 'TRADE', 'AGENT']);
function log(level, source, message, data = null) {
  const entry = { id: uuidv4(), ts: new Date().toISOString(), level, source, message, data };
  state.logs.unshift(entry);
  if (state.logs.length > 500) state.logs.pop();
  if (BROADCAST_LEVELS.has(level)) broadcast({ type: 'LOG', payload: entry });
  const c = { INFO:'\x1b[36m', WARN:'\x1b[33m', ERROR:'\x1b[31m', TRADE:'\x1b[32m', AGENT:'\x1b[35m', GATEWAY:'\x1b[34m' };
  console.log(`${c[level] || ''}[${level}] [${source}]\x1b[0m ${message}`);
  return entry;
}
global.agenticLog = log;
// FIX #32 — expose state so modules like polymarket.js can read the
// cached markets list without re-fetching on every trade.
global.agenticState = state;

// ── Broadcaster ────────────────────────────────────────────
function broadcast(msg) {
  const data = JSON.stringify(msg);
  wss.clients.forEach(c => { if (c.readyState === WebSocket.OPEN) c.send(data); });
}
global.broadcast = broadcast;

// ── WebSocket connections ──────────────────────────────────
wss.on('connection', (ws) => {
  // FIX #30 — heartbeat: mark alive on pong, terminate on missed pings.
  // Without this, a client whose network drops without a clean TCP close
  // stays in wss.clients forever; broadcasts fire into zombies and
  // state.connected drifts upward indefinitely.
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });

  state.connected++;
  log('INFO', 'WS', `Client connected — ${state.connected} active`);
  broadcast({ type: 'SYSTEM', payload: { connected: state.connected } });

  // Snapshot: send current state; agents is object of plain JSON
  const snapshot = {
    ...state,
    agents: AgentManager.getAll().reduce((m, a) => { m[a.id] = a; return m; }, {}),
  };
  ws.send(JSON.stringify({ type: 'SNAPSHOT', payload: snapshot }));

  ws.on('message', (raw) => {
    try { handleWsMessage(ws, JSON.parse(raw.toString())); }
    catch (e) { log('ERROR', 'WS', 'Parse error: ' + e.message); }
  });

  ws.on('close', () => {
    state.connected = Math.max(0, state.connected - 1);
    broadcast({ type: 'SYSTEM', payload: { connected: state.connected } });
  });

  ws.on('error', (e) => log('ERROR', 'WS', 'Socket error: ' + e.message));
});

// ── WS Message Handler ─────────────────────────────────────
function handleWsMessage(ws, msg) {
  const { type, payload } = msg;
  switch (type) {
    case 'AGENT_SPAWN':  AgentManager.spawn(payload); break;
    case 'AGENT_KILL':   AgentManager.kill(payload.id); break;
    case 'AGENT_PAUSE':  AgentManager.pause(payload.id); break;
    case 'AGENT_RESUME': AgentManager.resume(payload.id); break;

    case 'MANUAL_TRADE':
      polymarket.placeTrade(payload)
        .then(r  => ws.send(JSON.stringify({ type: 'TRADE_RESULT', payload: r })))
        .catch(e => ws.send(JSON.stringify({ type: 'TRADE_ERROR',  payload: { error: e.message } })));
      break;

    case 'REFRESH_MARKETS':
      polymarket.getMarkets()
        .then(m => { state.markets = m; broadcast({ type: 'MARKETS_UPDATE', payload: m }); })
        .catch(e => log('ERROR', 'MARKETS', e.message));
      break;

    case 'REFRESH_NEWS':
      newsModule.getNews()
        .then(n => { state.news = n; broadcast({ type: 'NEWS_UPDATE', payload: n }); })
        .catch(e => log('ERROR', 'NEWS', e.message));
      break;

    case 'REFRESH_PRICES':
      pricesModule.getPrices()
        .then(p => { state.prices = p; broadcast({ type: 'PRICES_UPDATE', payload: p }); })
        .catch(e => log('ERROR', 'PRICES', e.message));
      break;

    case 'GET_WALLET':
      walletModule.getWallet(payload)
        .then(w  => ws.send(JSON.stringify({ type: 'WALLET_DATA', payload: w })))
        .catch(e => ws.send(JSON.stringify({ type: 'WALLET_ERROR', payload: { error: e.message } })));
      break;

    case 'TERMINAL_CMD':
      handleTerminalCommand(ws, payload.cmd);
      break;
  }
}

// ── Terminal Command Handler ───────────────────────────────
// FIX #8: each case wrapped in block {} to allow const declarations safely
function handleTerminalCommand(ws, cmd) {
  const parts   = cmd.trim().split(/\s+/);
  const command = parts[0].toLowerCase();
  let response  = '';

  const sendOut = (r) => ws.send(JSON.stringify({ type: 'TERMINAL_OUT', payload: { cmd, response: r } }));

  switch (command) {
    case 'help': {
      sendOut(`AGENTIC CLAW v2.2 — Commands:
  agents list                List all running agents
  agents spawn <strategy>    Spawn new agent
  agents kill <id>           Kill agent by ID
  agents pause <id>          Pause agent
  agents resume <id>         Resume agent
  markets list               Show loaded markets
  markets refresh            Fetch latest markets
  predictions list           Show Mirofish predictions
  news [CATEGORY]            Show news (AI|CRYPTO|FINANCE|WORLD|GEOPOLITICS)
  prices                     Show live crypto & commodity prices
  wallet <provider> <addr>   Check wallet balance
  trade <marketId> YES|NO    Manual trade (amount=10)
  status                     System status
  logs [n]                   Show last n log entries (default 10)
  clear                      Clear terminal`);
      return;
    }

    case 'agents': {
      const sub    = parts[1];
      const agList = AgentManager.getAll();
      if (sub === 'list' || !sub) {
        response = !agList.length ? 'No agents running.' :
          agList.map(a =>
            `  [${a.shortId}] ${a.strategy.padEnd(16)} ${a.status.padEnd(10)} T:${String(a.tradeCount).padStart(3)} P&L:${a.pnl >= 0 ? '+' : ''}${a.pnl.toFixed(4)} $${a.remaining.toFixed(0)} left`
          ).join('\n');
      } else if (sub === 'spawn') {
        const strat = parts[2] || 'momentum';
        if (!AgentManager.STRATEGIES[strat]) {
          response = `Unknown strategy: ${strat}\nValid: ${Object.keys(AgentManager.STRATEGIES).join(', ')}`;
        } else {
          AgentManager.spawn({ strategy: strat });
          response = `Spawning ${strat} agent...`;
        }
      } else if (sub === 'kill')   { AgentManager.kill(parts[2]);   response = parts[2] ? `Agent ${parts[2].slice(0,8)} terminated.` : 'Usage: agents kill <id>'; }
      else if  (sub === 'pause')   { AgentManager.pause(parts[2]);  response = parts[2] ? `Agent ${parts[2].slice(0,8)} paused.` : 'Usage: agents pause <id>'; }
      else if  (sub === 'resume')  { AgentManager.resume(parts[2]); response = parts[2] ? `Agent ${parts[2].slice(0,8)} resumed.` : 'Usage: agents resume <id>'; }
      else { response = 'Usage: agents [list|spawn|kill|pause|resume]'; }
      break;
    }

    case 'markets': {
      if (parts[1] === 'refresh') {
        polymarket.getMarkets().then(m => { state.markets = m; broadcast({ type: 'MARKETS_UPDATE', payload: m }); });
        response = 'Refreshing markets from Polymarket...';
      } else {
        response = !state.markets.length ? 'No markets loaded. Run: markets refresh' :
          state.markets.slice(0, 10).map(m =>
            `  ${m.question.slice(0, 52).padEnd(52)} YES:${(parseFloat(m.yes) * 100).toFixed(1).padStart(5)}%`
          ).join('\n');
      }
      break;
    }

    case 'predictions': {
      response = !state.predictions.length ? 'No predictions loaded.' :
        state.predictions.slice(0, 10).map(p =>
          `  [${p.signal.padEnd(12)}] ${p.direction} ${(p.confidence * 100).toFixed(1).padStart(5)}% — ${p.market.slice(0, 40)}`
        ).join('\n');
      break;
    }

    case 'news': {
      const cat      = parts[1]?.toUpperCase();
      const filtered = cat ? state.news.filter(n => n.category === cat) : state.news;
      const items    = filtered.length ? filtered : state.news;
      response = !items.length ? 'No news loaded.' :
        items.slice(0, 8).map(n =>
          `  [${n.category.padEnd(12)}] ${n.title}\n    ↳ ${n.source} | ${n.sentiment}`
        ).join('\n\n');
      break;
    }

    case 'prices': {
      response = !state.prices.length ? 'No price data.' :
        'LIVE PRICES\n' + state.prices.map(p =>
          `  ${p.symbol.padEnd(7)} ${(p.formattedPrice || '').padStart(14)}  ${p.change24h >= 0 ? '+' : ''}${parseFloat(p.change24h || 0).toFixed(2)}%`
        ).join('\n');
      break;
    }

    case 'wallet': {
      walletModule.getWallet({
        provider: parts[1] || 'polymarket',
        address:  parts[2] || '',
        apiKey:   parts[3] || '',
      }).then(w => {
        const lines = [
          `\nWallet: ${w.provider} [${w.status}]`,
          `Address: ${w.address}`,
          `Total:   $${w.totalUsd}`,
          `24h:     ${w.change24h >= 0 ? '+' : ''}${w.change24h}%`,
          '',
        ];
        (w.balances || []).forEach(b =>
          lines.push(`  ${b.token.padEnd(8)} ${String(b.amount).padStart(12)}  ≈ $${b.usdValue}`)
        );
        sendOut(lines.join('\n'));
      }).catch(e => sendOut('Wallet error: ' + e.message));
      return;
    }

    case 'trade': {
      const marketId = parts[1];
      const side     = (parts[2] || '').toUpperCase();
      if (!marketId || !['YES', 'NO'].includes(side)) {
        response = 'Usage: trade <marketId> YES|NO';
      } else {
        polymarket.placeTrade({ marketId, side, amount: 10, agentId: 'MANUAL' })
          .then(r => sendOut(`Trade executed: ${side} $10\nStatus: ${r.status}\nPrice: ${r.price}\nShares: ${r.shares}`))
          .catch(e => sendOut('Trade failed: ' + e.message));
        return;
      }
      break;
    }

    case 'status': {
      const sec    = Math.floor((Date.now() - state.uptime) / 1000);
      const agents = AgentManager.getAll();
      response = `AGENTIC CLAW v2.2 — SYSTEM STATUS
  Uptime:      ${Math.floor(sec/3600)}h ${Math.floor((sec%3600)/60)}m ${sec%60}s
  Agents:      ${agents.length} running (${agents.filter(a=>a.status==='RUNNING').length} active, ${agents.filter(a=>a.status==='PAUSED').length} paused)
  Markets:     ${state.markets.length} loaded
  Predictions: ${state.predictions.length} (${state.predictions.filter(p=>p.signal!=='HOLD').length} active signals)
  News:        ${state.news.length} articles
  Prices:      ${state.prices.length} feeds
  Trades:      ${state.trades.length} recorded
  Clients:     ${state.connected} connected
  Server:      http://localhost:${PORT}
  Created by:  Joon Nyip Koh (OpenClaw Researcher)`;
      break;
    }

    case 'logs': {
      const n = Math.min(parseInt(parts[1]) || 10, 50);
      response = state.logs.slice(0, n)
        .map(l => `  [${l.level.padEnd(7)}] ${l.ts.split('T')[1].split('.')[0]} ${l.source}: ${l.message}`)
        .join('\n');
      break;
    }

    case 'clear': {
      ws.send(JSON.stringify({ type: 'TERMINAL_CLEAR' }));
      return;
    }

    default: {
      response = `Unknown command: "${command}". Type 'help' for all commands.`;
    }
  }

  sendOut(response);
}

// ── REST Routes ───────────────────────────────────────────
// FIX: individual routes BEFORE gateway router to avoid middleware order issues
app.get('/api/state',       (req, res) => res.json({ ...state, agents: AgentManager.getAll().reduce((m,a)=>{m[a.id]=a;return m;},{}) }));
app.get('/api/agents',      (req, res) => res.json(AgentManager.getAll()));
app.get('/api/trades',      (req, res) => res.json(state.trades.slice(0, 200)));
app.get('/api/logs',        (req, res) => res.json(state.logs.slice(0, 100)));
app.get('/api/markets',     (req, res) => res.json(state.markets));
app.get('/api/predictions', (req, res) => res.json(state.predictions));
app.get('/api/news',        (req, res) => res.json(state.news));
app.get('/api/prices',      (req, res) => res.json(state.prices));

app.post('/api/wallet', async (req, res) => {
  try { res.json(await walletModule.getWallet(req.body)); }
  catch (e) { res.status(400).json({ error: e.message }); }
});

app.post('/api/agents/spawn',  (req, res) => res.json(AgentManager.spawn(req.body)));
app.delete('/api/agents/:id',  (req, res) => { AgentManager.kill(req.params.id); res.json({ ok: true }); });

// Gateway router handles /api/* sub-routes (polymarket, mirofish, combined, etc.)
app.use('/api', gateway.router);

// ── Global trade recorder ─────────────────────────────────
global.recordTrade = (trade) => {
  const entry = { ...trade, id: uuidv4(), ts: new Date().toISOString() };
  state.trades.unshift(entry);
  if (state.trades.length > 1000) state.trades.pop();
  broadcast({ type: 'TRADE', payload: entry });
};

// ── Boot ──────────────────────────────────────────────────
server.listen(PORT, async () => {
  log('INFO', 'SERVER', `╔════════════════════════════════════════════╗`);
  log('INFO', 'SERVER', `║  AGENTIC CLAW v2.2 — MISSION CONTROL      ║`);
  log('INFO', 'SERVER', `║  Created by Joon Nyip Koh (OpenClaw)       ║`);
  log('INFO', 'SERVER', `║  http://localhost:${PORT}                     ║`);
  log('INFO', 'SERVER', `╚════════════════════════════════════════════╝`);

  // FIX #4: all boot fetches wrapped in individual try/catch
  const safe = async (label, fn) => {
    try { const r = await fn(); log('INFO', label, `Loaded ${r.length} items`); return r; }
    catch (e) { log('WARN', label, `Fallback to simulated: ${e.message}`); return []; }
  };

  state.markets     = await safe('POLYMARKET', () => polymarket.getMarkets());
  state.predictions = await safe('MIROFISH',   () => mirofish.getPredictions());
  state.news        = await safe('NEWS',        () => newsModule.getNews());
  state.prices      = await safe('PRICES',      () => pricesModule.getPrices());

  // FIX #4: intervals have try/catch + FIX #2: prices NOT broadcast inside getPrices()
  setInterval(async () => {
    try {
      state.markets     = await polymarket.getMarkets();
      state.predictions = await mirofish.getPredictions();
      state.prices      = await pricesModule.getPrices();
      // Broadcast each update once (prices.js no longer self-broadcasts)
      broadcast({ type: 'MARKETS_UPDATE',     payload: state.markets });
      broadcast({ type: 'PREDICTIONS_UPDATE', payload: state.predictions });
      broadcast({ type: 'PRICES_UPDATE',      payload: state.prices });
      broadcast({ type: 'AGENTS_UPDATE',      payload: AgentManager.getAll() });
    } catch (e) {
      log('ERROR', 'REFRESH', 'Interval refresh failed: ' + e.message);
    }
  }, 30000);

  setInterval(async () => {
    try {
      state.news = await newsModule.getNews();
      broadcast({ type: 'NEWS_UPDATE', payload: state.news });
    } catch (e) {
      log('ERROR', 'NEWS_REFRESH', e.message);
    }
  }, 180000);

  // FIX #30 — ping every 30s; terminate sockets that didn't pong back.
  // Also re-syncs state.connected so the counter reflects reality.
  const heartbeat = setInterval(() => {
    let alive = 0;
    wss.clients.forEach(ws => {
      if (ws.isAlive === false) {
        log('INFO', 'WS', 'Terminating stale socket (no pong)');
        return ws.terminate();
      }
      ws.isAlive = false;
      alive++;
      try { ws.ping(); } catch (e) { ws.terminate(); }
    });
    if (state.connected !== alive) {
      state.connected = alive;
      broadcast({ type: 'SYSTEM', payload: { connected: state.connected } });
    }
  }, 30000);
  wss.on('close', () => clearInterval(heartbeat));

  log('INFO', 'SERVER', `Server ready — all systems online`);
});

module.exports = { app, state, log };
