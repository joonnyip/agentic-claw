// ============================================================
//  AGENTIC CLAW — Agent Manager v2.2
//  BUG FIXES: log schema, toJSON bloat, timer leak on resume,
//             calcTradeSize floor, broadcastState serialization
// ============================================================

const { v4: uuidv4 } = require('uuid');
const polymarket = require('../polymarket');
const mirofish = require('../mirofish');
const persistence = require('../persistence');  // v2.3 — SQLite persistence

const agents = {};

const STRATEGIES = {
  momentum:       { name: 'Momentum Trader',  description: 'Follows price momentum and volume trends',               tradeSize: { min: 5,  max: 50  }, interval: 15000, riskLevel: 'MEDIUM' },
  mirofish_signal:{ name: 'Mirofish Signal',  description: 'Trades based on Mirofish AI predictions',               tradeSize: { min: 10, max: 100 }, interval: 20000, riskLevel: 'LOW'    },
  arbitrage:      { name: 'Arbitrage Hunter', description: 'Exploits pricing inefficiencies between markets',         tradeSize: { min: 20, max: 200 }, interval: 10000, riskLevel: 'LOW'    },
  contrarian:     { name: 'Contrarian',       description: 'Bets against overextended markets',                      tradeSize: { min: 5,  max: 30  }, interval: 25000, riskLevel: 'HIGH'   },
  scalper:        { name: 'Scalper',          description: 'High-frequency small trades on volatile markets',         tradeSize: { min: 2,  max: 15  }, interval: 8000,  riskLevel: 'HIGH'   },
  value:          { name: 'Value Investor',   description: 'Buys undervalued probabilities with high confidence',    tradeSize: { min: 25, max: 150 }, interval: 45000, riskLevel: 'LOW'    },
};

class TradingAgent {
  constructor({ strategy = 'momentum', name, budget = 200 }) {
    this.id          = uuidv4();
    this.shortId     = this.id.slice(0, 8);
    this.strategy    = strategy;
    this.strategyConfig = STRATEGIES[strategy] || STRATEGIES.momentum;
    this.name        = name || `${this.strategyConfig.name} #${this.shortId}`;
    this.status      = 'BOOTING';
    this.budget      = budget;
    this.remaining   = budget;
    this.tradeCount  = 0;
    this.winCount    = 0;
    this.pnl         = 0;
    this.timer       = null;
    this.createdAt   = new Date().toISOString();
    this.lastAction  = 'Initializing...';
    // FIX #1: logs stored separately, NOT sent in every broadcast
    this._logs       = [];
  }

  // FIX #1: log schema now uses {source, message} to match frontend expectations
  log(level, message, data = null) {
    const entry = {
      id: uuidv4(),
      ts: new Date().toISOString(),
      level,
      source: `AGENT:${this.shortId}`,
      message,
      data,
    };
    this._logs.unshift(entry);
    if (this._logs.length > 100) this._logs.pop();
    // Also push to global log
    if (global.agenticLog) global.agenticLog(level, `AGENT:${this.shortId}`, `[${this.strategy}] ${message}`, data);
    // Broadcast individual log entry (uses correct schema)
    if (global.broadcast) global.broadcast({ type: 'AGENT_LOG', payload: { agentId: this.id, entry } });
  }

  async start() {
    // FIX #11: clear any existing timer before creating new one
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    this.status = 'RUNNING';
    this.log('AGENT', `Agent started — Strategy: ${this.strategy} | Budget: $${this.budget}`);
    this.broadcastState();
    this.timer = setInterval(() => this.tick(), this.strategyConfig.interval);
    setTimeout(() => this.tick(), 2000 + Math.random() * 1000);
  }

  async tick() {
    if (this.status !== 'RUNNING') return;
    if (this.remaining < 2) {
      this.log('WARN', 'Budget exhausted — agent stopping');
      this.stop();
      return;
    }
    try {
      this.status = 'ANALYZING';
      this.broadcastState();
      await this.runStrategy();
    } catch (e) {
      this.log('ERROR', 'Tick error: ' + e.message);
    } finally {
      // FIX #25 — only reset to RUNNING if we're still ANALYZING.
      // If pause() or stop() fired during runStrategy(), status is already
      // PAUSED/STOPPED and we must not clobber it back to RUNNING.
      if (this.status === 'ANALYZING') {
        this.status = 'RUNNING';
        this.broadcastState();
      }
    }
  }

  async runStrategy() {
    const markets     = await polymarket.getMarkets(20);
    const predictions = await mirofish.getPredictions(markets);
    switch (this.strategy) {
      case 'mirofish_signal': return this.executeMirofishSignal(markets, predictions);
      case 'momentum':        return this.executeMomentum(markets);
      case 'contrarian':      return this.executeContrarian(markets);
      case 'scalper':         return this.executeScalper(markets);
      case 'value':           return this.executeValue(markets, predictions);
      case 'arbitrage':       return this.executeArbitrage(markets, predictions);
      default:                return this.executeMomentum(markets);
    }
  }

  async executeMirofishSignal(markets, predictions) {
    const signals = predictions
      .filter(p => p.signal === 'STRONG_BUY' || p.signal === 'BUY')
      .sort((a, b) => Math.abs(b.confidence - 0.5) - Math.abs(a.confidence - 0.5));
    if (!signals.length) { this.log('INFO', 'No strong Mirofish signals — holding'); this.lastAction = 'HOLD'; return; }
    const best   = signals[0];
    // FIX: more robust market matching — slice longer prefix
    const market = markets.find(m => m.question.toLowerCase().includes(best.market.toLowerCase().slice(0, 25))) || markets[0];
    this.log('AGENT', `Mirofish signal: ${best.signal} ${best.direction} @ ${(best.confidence * 100).toFixed(1)}%`);
    await this.executeTrade(market, best.direction, this.calcTradeSize());
  }

  async executeMomentum(markets) {
    const sorted = [...markets].sort((a, b) => parseFloat(b.volume) - parseFloat(a.volume));
    const market = sorted[Math.floor(Math.random() * Math.min(3, sorted.length))];
    const side   = parseFloat(market.yes) > 0.5 ? 'YES' : 'NO';
    this.log('AGENT', `Momentum: ${side} on high-volume market`);
    await this.executeTrade(market, side, this.calcTradeSize());
  }

  async executeContrarian(markets) {
    const extremes = markets.filter(m => parseFloat(m.yes) > 0.85 || parseFloat(m.yes) < 0.15);
    if (!extremes.length) { this.log('INFO', 'No contrarian setup found'); return; }
    const market = extremes[Math.floor(Math.random() * extremes.length)];
    const side   = parseFloat(market.yes) > 0.85 ? 'NO' : 'YES';
    this.log('AGENT', `Contrarian: ${side} — overextended market`);
    await this.executeTrade(market, side, this.calcTradeSize());
  }

  async executeScalper(markets) {
    const market = markets[Math.floor(Math.random() * markets.length)];
    const side   = Math.random() > 0.5 ? 'YES' : 'NO';
    const amount = Math.max(2, this.calcTradeSize() * 0.3);
    this.log('AGENT', `Scalp: ${side} $${amount.toFixed(2)}`);
    await this.executeTrade(market, side, amount);
  }

  async executeValue(markets, predictions) {
    const opps = markets.map(m => {
      const pred = predictions.find(p => p.market.toLowerCase().includes(m.question.toLowerCase().slice(0, 15)));
      if (!pred) return null;
      const mktPrice  = pred.direction === 'YES' ? parseFloat(m.yes) : parseFloat(m.no);
      const valueEdge = pred.confidence - mktPrice;
      return { market: m, pred, valueEdge };
    }).filter(o => o && o.valueEdge > 0.08).sort((a, b) => b.valueEdge - a.valueEdge);
    if (!opps.length) { this.log('INFO', 'No value opportunities'); return; }
    const best = opps[0];
    this.log('AGENT', `Value: ${best.pred.direction} — edge ${(best.valueEdge * 100).toFixed(1)}%`);
    await this.executeTrade(best.market, best.pred.direction, this.calcTradeSize());
  }

  async executeArbitrage(markets, predictions) {
    // FIX #7: parseFloat market.yes before arithmetic
    const opps = markets.map(m => {
      const pred = predictions.find(p => p.marketId === m.id);
      if (!pred) return null;
      const edge = Math.abs(pred.confidence - parseFloat(m.yes));
      return { market: m, pred, edge };
    }).filter(Boolean).sort((a, b) => b.edge - a.edge);
    if (!opps.length || opps[0].edge < 0.05) { this.log('INFO', 'No arbitrage edge'); return; }
    const { market, pred } = opps[0];
    const side = pred.confidence > parseFloat(market.yes) ? 'YES' : 'NO';
    this.log('AGENT', `Arbitrage: ${side} — edge ${(opps[0].edge * 100).toFixed(1)}%`);
    await this.executeTrade(market, side, this.calcTradeSize());
  }

  async executeTrade(market, side, amount) {
    if (!market) return;
    const actual = Math.min(amount, this.remaining);
    if (actual < 1) return;
    const result = await polymarket.placeTrade({ marketId: market.id, side, amount: actual, agentId: this.id });
    this.tradeCount++;
    this.remaining -= actual;
    const tradePnl = (Math.random() * 2 - 0.95) * actual * 0.1;
    this.pnl += tradePnl;
    if (tradePnl > 0) this.winCount++;
    this.lastAction = `${side} $${actual.toFixed(2)} @ ${result.price || '?'} → ${result.status}`;
    this.log('TRADE', `${side} $${actual.toFixed(2)} on "${market.question.slice(0, 40)}" | trade P&L: ${tradePnl >= 0 ? '+' : ''}${tradePnl.toFixed(4)}`);
    this.broadcastState();
    return result;
  }

  // FIX #3: calcTradeSize always returns at least 1
  calcTradeSize() {
    const { min, max } = this.strategyConfig.tradeSize;
    return Math.max(1, Math.min(this.remaining * 0.15, min + Math.random() * (max - min)));
  }

  pause() {
    this.status = 'PAUSED';
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    this.log('INFO', 'Agent paused');
    this.broadcastState();
  }

  // FIX #26 — resume only from PAUSED. Previously an API call against a
  // STOPPED agent (e.g. one that hit "Budget exhausted") would resurrect
  // it via start(), bypassing the stop guard. Also re-check budget on
  // resume — agent may have been paused while already low on funds.
  resume() {
    if (this.status !== 'PAUSED') {
      this.log('WARN', `Cannot resume — current status: ${this.status}`);
      return false;
    }
    if (this.remaining < 2) {
      this.log('WARN', 'Cannot resume — budget exhausted');
      this.stop();
      return false;
    }
    this.log('INFO', 'Agent resuming');
    this.start();
    return true;
  }

  stop() {
    this.status = 'STOPPED';
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    this.log('INFO', `Agent stopped — Trades: ${this.tradeCount} | Total P&L: ${this.pnl >= 0 ? '+' : ''}${this.pnl.toFixed(4)}`);
    this.broadcastState();
  }

  broadcastState() {
    // v2.3 — persist agent state on every state change
    persistence.saveAgent(this);
    if (global.broadcast) {
      global.broadcast({ type: 'AGENTS_UPDATE', payload: Object.values(agents).map(a => a.toJSON()) });
    }
  }

  // FIX #3: toJSON does NOT include logs array — reduces payload size drastically
  toJSON() {
    return {
      id:             this.id,
      shortId:        this.shortId,
      name:           this.name,
      strategy:       this.strategy,
      strategyConfig: this.strategyConfig,
      status:         this.status,
      budget:         this.budget,
      remaining:      parseFloat(this.remaining.toFixed(2)),
      tradeCount:     this.tradeCount,
      winCount:       this.winCount,
      winRate:        this.tradeCount > 0 ? ((this.winCount / this.tradeCount) * 100).toFixed(1) + '%' : 'N/A',
      pnl:            parseFloat(this.pnl.toFixed(4)),
      lastAction:     this.lastAction,
      createdAt:      this.createdAt,
    };
  }
}

function spawn(config = {}) {
  const agent = new TradingAgent(config);
  agents[agent.id] = agent;
  agent.start();
  if (global.agenticLog) global.agenticLog('AGENT', 'MANAGER', `Spawned: ${agent.name} [${agent.shortId}] — ${agent.strategy}`);
  return agent.toJSON();
}

function kill(id) {
  const agent = agents[id];
  if (!agent) return false;
  agent.stop();
  persistence.deleteAgent(id);  // v2.3 — remove from persistent store
  delete agents[id];
  if (global.agenticLog) global.agenticLog('AGENT', 'MANAGER', `Killed: ${id.slice(0, 8)}`);
  if (global.broadcast) global.broadcast({ type: 'AGENTS_UPDATE', payload: Object.values(agents).map(a => a.toJSON()) });
  return true;
}

function pause(id)  { const a = agents[id]; if (!a) return false; a.pause();  return true; }
function resume(id) { const a = agents[id]; if (!a) return false; a.resume(); return true; }
function getAll()   { return Object.values(agents).map(a => a.toJSON()); }

// v2.3 — Rehydrate agents from persistent storage on boot, OR auto-spawn
// starters if the DB is empty. Both paths are deferred so persistence.init()
// has time to run from index.js before we query.
setTimeout(() => {
  const saved = persistence.loadAgents();
  if (saved.length) {
    // Rehydrate each saved agent with its last-known state
    saved.forEach((row, i) => {
      setTimeout(() => {
        const agent = new TradingAgent({
          strategy: row.strategy,
          name:     row.name,
          budget:   row.budget,
        });
        // Restore persistent fields (override constructor defaults)
        agent.id          = row.id;
        agent.shortId     = row.shortId;
        agent.remaining   = row.remaining;
        agent.tradeCount  = row.tradeCount;
        agent.winCount    = row.winCount;
        agent.pnl         = row.pnl;
        agent.lastAction  = row.lastAction || 'Rehydrated from disk';
        agent.createdAt   = row.createdAt;
        agents[agent.id]  = agent;
        if (global.agenticLog) {
          global.agenticLog('AGENT', 'MANAGER', `Rehydrated: ${agent.name} [${agent.shortId}] — $${agent.remaining.toFixed(2)} remaining, P&L ${agent.pnl.toFixed(4)}`);
        }
        // If previously RUNNING/PAUSED, restart (paused stays paused)
        if (row.status === 'PAUSED') {
          agent.status = 'PAUSED';
          agent.broadcastState();
        } else {
          agent.start();
        }
      }, i * 600);  // stagger so logs are readable and ticks don't collide
    });
    if (global.agenticLog) {
      global.agenticLog('AGENT', 'MANAGER', `Rehydrating ${saved.length} agents from disk`);
    }
  } else {
    // First boot — spawn the two starter agents
    setTimeout(() => spawn({ strategy: 'mirofish_signal', budget: 200 }), 500);
    setTimeout(() => spawn({ strategy: 'momentum',        budget: 150 }), 2000);
  }
}, 1500);

module.exports = { spawn, kill, pause, resume, getAll, agents, STRATEGIES };
