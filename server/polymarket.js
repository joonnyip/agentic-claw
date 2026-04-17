// ============================================================
//  AGENTIC CLAW — Polymarket Integration
//  Live market data + simulated trading engine
// ============================================================

const https = require('https');

const POLYMARKET_API = 'https://gamma-api.polymarket.com';
const CLOB_API = 'https://clob.polymarket.com';

// ─── Simulated State ─────────────────────────────────────────
let simulatedBalance = 1000.00;
const positions = {};
const tradeHistory = [];

// ─── HTTP Fetch Helper ────────────────────────────────────────
function fetchJson(url, options = {}) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, { ...options, headers: { 'Accept': 'application/json', ...(options.headers || {}) } }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error('JSON parse error: ' + data.slice(0, 100))); }
      });
    });
    req.on('error', reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

// ─── Market Data ─────────────────────────────────────────────
async function getMarkets(limit = 25, category) {
  try {
    let url = `${POLYMARKET_API}/markets?limit=${limit}&active=true&closed=false`;
    if (category) url += `&category=${category}`;
    const data = await fetchJson(url);
    const markets = Array.isArray(data) ? data : (data.data || data.markets || []);

    return markets.slice(0, limit).map(m => {
      // FIX #19 — Polymarket's live API returns outcomePrices as a JSON STRING,
      // e.g. '["0.62","0.38"]', not an array. Parse it defensively so
      // m.outcomePrices?.[0] no longer yields the character '[' → NaN.
      let op = m.outcomePrices;
      if (typeof op === 'string') {
        try { op = JSON.parse(op); } catch (e) { op = null; }
      }
      if (!Array.isArray(op)) op = [];

      const yesRaw = parseFloat(op[0] ?? m.yes_price);
      const noRaw  = parseFloat(op[1] ?? m.no_price);

      const yes = Number.isFinite(yesRaw) ? yesRaw : (Math.random() * 0.4 + 0.3);
      const no  = Number.isFinite(noRaw)  ? noRaw  : (1 - yes);

      const volRaw = parseFloat(m.volume ?? m.usdcLiquidity);
      const liqRaw = parseFloat(m.liquidity ?? m.usdcLiquidity);

      return {
        id: m.id || m.condition_id || String(Math.random()).slice(2),
        question: m.question || m.title || 'Unknown market',
        category: m.category || m.tags?.[0] || 'General',
        yes: yes.toFixed(4),
        no:  no.toFixed(4),
        volume:    (Number.isFinite(volRaw) ? volRaw : Math.random() * 100000).toFixed(2),
        liquidity: (Number.isFinite(liqRaw) ? liqRaw : Math.random() * 50000).toFixed(2),
        endDate: m.endDate || m.game_start_time || new Date(Date.now() + 86400000 * 30).toISOString(),
        active: true
      };
    });
  } catch (e) {
    if (global.agenticLog) global.agenticLog('WARN', 'POLYMARKET', 'API unavailable, using simulated markets');
    return generateSimulatedMarkets(limit);
  }
}

async function getMarket(id) {
  try {
    const data = await fetchJson(`${POLYMARKET_API}/markets/${id}`);
    return data;
  } catch (e) {
    return generateSimulatedMarkets(1)[0];
  }
}

async function getPositions() {
  return Object.values(positions);
}

// ─── Trade Execution ──────────────────────────────────────────
async function placeTrade({ marketId, side, amount, agentId = 'MANUAL' }) {
  const amountNum = parseFloat(amount);

  // FIX #32 — use the cached state.markets first. Previously every trade
  // triggered getMarkets(100) (potentially an HTTP fetch) just to look up
  // the market by id. With 6 agents ticking every 8-45s, that's dozens
  // of redundant round-trips. Only fall back to a fetch if the cache miss
  // is genuine (e.g. server was just booted).
  const cache = global.agenticState?.markets || [];
  let market = cache.find(m => m.id === marketId);
  if (!market) {
    market = (await getMarkets(100)).find(m => m.id === marketId) || generateSimulatedMarkets(1)[0];
  }
  const price = side === 'YES' ? parseFloat(market.yes) : parseFloat(market.no);
  const shares = amountNum / price;
  const slippage = (Math.random() * 0.005); // 0-0.5% slippage
  const fillPrice = price * (1 + slippage);
  const cost = shares * fillPrice;

  // Update simulated balance
  simulatedBalance -= cost;

  // Update position
  const posKey = `${marketId}_${side}`;
  if (positions[posKey]) {
    positions[posKey].shares += shares;
    positions[posKey].avgPrice = (positions[posKey].avgPrice + fillPrice) / 2;
  } else {
    positions[posKey] = {
      marketId,
      question: market.question,
      side,
      shares,
      avgPrice: fillPrice,
      currentPrice: price,
      pnl: 0
    };
  }

  const trade = {
    id: String(Date.now()),
    ts: new Date().toISOString(),
    marketId,
    question: market.question.slice(0, 60),
    side,
    amount: amountNum,
    shares: shares.toFixed(4),
    price: fillPrice.toFixed(4),
    slippage: (slippage * 100).toFixed(3) + '%',
    agentId,
    status: 'FILLED',
    balance: simulatedBalance.toFixed(2)
  };

  tradeHistory.unshift(trade);
  // FIX #33 — cap tradeHistory to prevent unbounded memory growth over
  // long-running sessions. State-side state.trades is capped at 1000;
  // match here so the module-level array doesn't leak.
  if (tradeHistory.length > 1000) tradeHistory.pop();
  if (global.recordTrade) global.recordTrade(trade);
  if (global.agenticLog) global.agenticLog('TRADE', 'POLYMARKET', `${side} ${shares.toFixed(2)} shares @ $${fillPrice.toFixed(4)} | Market: ${market.question.slice(0, 40)}`);

  return trade;
}

// ─── Simulated Market Generator ───────────────────────────────
const SAMPLE_MARKETS = [
  { q: 'Will Bitcoin exceed $150,000 by end of 2025?', cat: 'Crypto' },
  { q: 'Will the Fed cut rates in Q2 2025?', cat: 'Finance' },
  { q: 'Will Ethereum surpass Bitcoin market cap in 2025?', cat: 'Crypto' },
  { q: 'Will US unemployment exceed 5% in 2025?', cat: 'Economy' },
  { q: 'Will SpaceX Starship reach orbit by June 2025?', cat: 'Tech' },
  { q: 'Will Apple release AR glasses in 2025?', cat: 'Tech' },
  { q: 'Will GPT-5 be released before July 2025?', cat: 'AI' },
  { q: 'Will the S&P 500 hit 6500 in 2025?', cat: 'Finance' },
  { q: 'Will Trump win the 2024 US election?', cat: 'Politics' },
  { q: 'Will Solana flip Ethereum by TVL in 2025?', cat: 'Crypto' },
  { q: 'Will Tesla stock rise above $400 in 2025?', cat: 'Finance' },
  { q: 'Will Claude AI pass bar exam with 90%+ score?', cat: 'AI' },
  { q: 'Will US Congress pass a crypto regulation bill in 2025?', cat: 'Crypto' },
  { q: 'Will a major AI lab release AGI before 2026?', cat: 'AI' },
  { q: 'Will Nvidia market cap exceed $5T?', cat: 'Tech' },
  { q: 'Will the Euro achieve parity with the dollar in 2025?', cat: 'Finance' },
  { q: 'Will there be a US recession in 2025?', cat: 'Economy' },
  { q: 'Will Microsoft acquire a major game studio in 2025?', cat: 'Tech' },
  { q: 'Will China invade Taiwan before 2026?', cat: 'Geopolitics' },
  { q: 'Will Dogecoin reach $1 in 2025?', cat: 'Crypto' },
];

function generateSimulatedMarkets(limit = 20) {
  return SAMPLE_MARKETS.slice(0, limit).map((m, i) => {
    const yes = Math.random() * 0.6 + 0.2;
    const vol = Math.random() * 500000 + 10000;
    return {
      id: `sim_${i}_${Date.now()}`,
      question: m.q,
      category: m.cat,
      yes: yes.toFixed(4),
      no: (1 - yes).toFixed(4),
      volume: vol.toFixed(2),
      liquidity: (vol * 0.4).toFixed(2),
      endDate: new Date(Date.now() + 86400000 * (30 + i * 10)).toISOString(),
      active: true
    };
  });
}

module.exports = { getMarkets, getMarket, getPositions, placeTrade, get balance() { return simulatedBalance; } };
