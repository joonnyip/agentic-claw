// ============================================================
//  AGENTIC CLAW — API Gateway
//  Central routing layer for all external service calls
// ============================================================

const express = require('express');
const router = express.Router();
const polymarket = require('./polymarket');
const mirofish = require('./mirofish');
const { v4: uuidv4 } = require('uuid');

// ─── Gateway Middleware ───────────────────────────────────────
const gatewayLog = [];

router.use((req, res, next) => {
  const entry = {
    id: uuidv4(),
    ts: new Date().toISOString(),
    method: req.method,
    path: req.path,
    ip: req.ip,
    status: null,
    duration: null
  };
  const start = Date.now();
  res.on('finish', () => {
    entry.status = res.statusCode;
    entry.duration = Date.now() - start;
    gatewayLog.unshift(entry);
    if (gatewayLog.length > 200) gatewayLog.pop();
    if (global.broadcast) {
      global.broadcast({ type: 'GATEWAY_REQUEST', payload: entry });
    }
    if (global.agenticLog) {
      global.agenticLog('GATEWAY', 'HTTP', `${req.method} ${req.path} → ${res.statusCode} (${entry.duration}ms)`);
    }
  });
  next();
});

// ─── Gateway Routes ───────────────────────────────────────────

// Health
router.get('/health', (req, res) => {
  res.json({
    status: 'ONLINE',
    service: 'Agentic Claw Gateway',
    version: '2.2.0',
    ts: new Date().toISOString(),
    uptime: process.uptime()
  });
});

// Gateway request log
router.get('/gateway/log', (req, res) => {
  res.json(gatewayLog.slice(0, 50));
});

// Gateway stats
router.get('/gateway/stats', (req, res) => {
  const total = gatewayLog.length;
  const errors = gatewayLog.filter(r => r.status >= 400).length;
  const avgDuration = total > 0
    ? gatewayLog.reduce((s, r) => s + (r.duration || 0), 0) / total
    : 0;
  res.json({
    total_requests: total,
    error_rate: total > 0 ? ((errors / total) * 100).toFixed(1) + '%' : '0%',
    avg_response_ms: avgDuration.toFixed(0),
    services: {
      polymarket: { status: 'CONNECTED', endpoint: 'https://gamma-api.polymarket.com' },
      mirofish: { status: 'CONNECTED', endpoint: 'https://api.mirofish.ai' }
    }
  });
});

// ─── Polymarket Routes ────────────────────────────────────────
router.get('/polymarket/markets', async (req, res) => {
  try {
    const { limit = 20, category } = req.query;
    const markets = await polymarket.getMarkets(parseInt(limit), category);
    res.json({ ok: true, data: markets, count: markets.length });
  } catch (e) {
    res.status(502).json({ ok: false, error: e.message });
  }
});

router.get('/polymarket/market/:id', async (req, res) => {
  try {
    const market = await polymarket.getMarket(req.params.id);
    res.json({ ok: true, data: market });
  } catch (e) {
    res.status(502).json({ ok: false, error: e.message });
  }
});

router.post('/polymarket/trade', async (req, res) => {
  try {
    const { marketId, side, amount, agentId } = req.body;
    if (!marketId || !side || !amount) {
      return res.status(400).json({ ok: false, error: 'marketId, side, and amount required' });
    }
    const result = await polymarket.placeTrade({ marketId, side, amount, agentId });
    res.json({ ok: true, data: result });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

router.get('/polymarket/positions', async (req, res) => {
  try {
    const positions = await polymarket.getPositions();
    res.json({ ok: true, data: positions });
  } catch (e) {
    res.status(502).json({ ok: false, error: e.message });
  }
});

// ─── Mirofish Routes ──────────────────────────────────────────
router.get('/mirofish/predictions', async (req, res) => {
  try {
    const predictions = await mirofish.getPredictions();
    res.json({ ok: true, data: predictions, count: predictions.length });
  } catch (e) {
    res.status(502).json({ ok: false, error: e.message });
  }
});

router.get('/mirofish/prediction/:marketId', async (req, res) => {
  try {
    const pred = await mirofish.getPrediction(req.params.marketId);
    res.json({ ok: true, data: pred });
  } catch (e) {
    res.status(502).json({ ok: false, error: e.message });
  }
});

router.get('/mirofish/signals', async (req, res) => {
  try {
    const signals = await mirofish.getSignals();
    res.json({ ok: true, data: signals });
  } catch (e) {
    res.status(502).json({ ok: false, error: e.message });
  }
});

// ─── Combined Route ───────────────────────────────────────────
router.get('/combined/opportunities', async (req, res) => {
  try {
    const [markets, predictions] = await Promise.all([
      polymarket.getMarkets(50),
      mirofish.getPredictions()
    ]);

    // Cross-reference: find markets where Mirofish prediction diverges from market price
    const opportunities = markets.map(market => {
      const pred = predictions.find(p => p.marketId === market.id);
      if (!pred) return null;
      const edge = Math.abs(pred.confidence - parseFloat(market.yes));
      return { market, prediction: pred, edge, signal: pred.confidence > market.yes ? 'BUY_YES' : 'BUY_NO' };
    }).filter(Boolean).sort((a, b) => b.edge - a.edge);

    res.json({ ok: true, data: opportunities.slice(0, 20), count: opportunities.length });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

module.exports = { router, gatewayLog };
