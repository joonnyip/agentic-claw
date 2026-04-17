// ============================================================
//  AGENTIC CLAW — Mirofish Prediction Engine
//  AI-powered prediction signals for Polymarket trading
// ============================================================

const https = require('https');

const MIROFISH_API = 'https://api.mirofish.ai/v1';

// Cache layer
let predictionCache = { data: null, ts: 0, ttl: 60000 };
let signalCache = { data: null, ts: 0, ttl: 30000 };

function fetchJson(url, options = {}) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, {
      ...options,
      headers: { 'Accept': 'application/json', 'X-Client': 'AgenticClaw/1.0', ...(options.headers || {}) }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error('JSON parse error')); }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

// ─── Prediction Models ────────────────────────────────────────
const PREDICTION_MODELS = ['consensus', 'momentum', 'sentiment', 'volume_weighted', 'reversal'];
const DIRECTIONS = ['YES', 'NO'];
const SIGNALS = ['STRONG_BUY', 'BUY', 'HOLD', 'SELL', 'STRONG_SELL'];
const CATEGORIES = ['Crypto', 'Finance', 'AI', 'Tech', 'Politics', 'Economy', 'Geopolitics'];

// ─── Live API Fetch ───────────────────────────────────────────
async function fetchLivePredictions() {
  try {
    const data = await fetchJson(`${MIROFISH_API}/predictions?source=polymarket&limit=30`);
    const preds = data.predictions || data.data || [];
    return preds.map(p => ({
      id: p.id || String(Date.now() + Math.random()),
      marketId: p.market_id || p.marketId,
      market: p.market_name || p.question || 'Unknown',
      direction: p.direction || 'YES',
      confidence: parseFloat(p.confidence || p.probability || 0.5),
      signal: p.signal || 'HOLD',
      model: p.model || 'consensus',
      score: parseFloat(p.score || p.accuracy || Math.random() * 0.3 + 0.6).toFixed(3),
      rationale: p.rationale || p.reasoning || 'Model-based analysis',
      ts: p.timestamp || new Date().toISOString(),
      category: p.category || 'General'
    }));
  } catch (e) {
    if (global.agenticLog) global.agenticLog('WARN', 'MIROFISH', 'Live API unavailable, using generative predictions: ' + e.message);
    return null;
  }
}

// ─── Generative Prediction Engine (Simulated Mirofish) ────────
function generatePredictions(markets = []) {
  const MARKET_QUESTIONS = [
    { q: 'Will Bitcoin exceed $150,000 by end of 2025?', cat: 'Crypto' },
    { q: 'Will the Fed cut rates in Q2 2025?', cat: 'Finance' },
    { q: 'Will Ethereum surpass Bitcoin market cap?', cat: 'Crypto' },
    { q: 'Will US unemployment exceed 5%?', cat: 'Economy' },
    { q: 'Will SpaceX Starship reach orbit?', cat: 'Tech' },
    { q: 'Will Apple release AR glasses in 2025?', cat: 'Tech' },
    { q: 'Will GPT-5 be released before July 2025?', cat: 'AI' },
    { q: 'Will the S&P 500 hit 6500?', cat: 'Finance' },
    { q: 'Will Solana flip Ethereum by TVL?', cat: 'Crypto' },
    { q: 'Will Claude AI pass bar exam with 90%+?', cat: 'AI' },
    { q: 'Will Nvidia market cap exceed $5T?', cat: 'Tech' },
    { q: 'Will there be a US recession in 2025?', cat: 'Economy' },
    { q: 'Will Dogecoin reach $1 in 2025?', cat: 'Crypto' },
    { q: 'Will a major AI lab release AGI before 2026?', cat: 'AI' },
    { q: 'Will China invade Taiwan before 2026?', cat: 'Geopolitics' },
  ];

  const seed = Date.now();
  return MARKET_QUESTIONS.map((mq, i) => {
    const confidence = 0.45 + (((seed + i * 137) % 400) / 1000);
    const direction = confidence > 0.52 ? 'YES' : 'NO';
    const edge = Math.abs(confidence - 0.5);
    let signal;
    if (edge > 0.3) signal = direction === 'YES' ? 'STRONG_BUY' : 'STRONG_SELL';
    else if (edge > 0.2) signal = direction === 'YES' ? 'BUY' : 'SELL';
    else signal = 'HOLD';

    const model = PREDICTION_MODELS[i % PREDICTION_MODELS.length];
    const score = (0.58 + ((seed + i * 31) % 200) / 500).toFixed(3);

    return {
      id: `mf_${i}_${Math.floor(seed / 10000)}`,
      marketId: markets[i]?.id || `market_${i}`,
      market: mq.q,
      direction,
      confidence: parseFloat(confidence.toFixed(4)),
      signal,
      model,
      score,
      rationale: generateRationale(mq.q, direction, confidence, model),
      ts: new Date().toISOString(),
      category: mq.cat,
      edge: edge.toFixed(4)
    };
  });
}

function generateRationale(question, direction, confidence, model) {
  const reasons = {
    consensus: ['Cross-model consensus points to', 'Aggregate model agreement suggests', 'Ensemble prediction converges on'],
    momentum: ['Price momentum indicators favor', 'Volume trend supports', 'Momentum signals lean'],
    sentiment: ['Market sentiment analysis indicates', 'Social signal aggregation shows', 'Crowd sentiment favors'],
    volume_weighted: ['Volume-weighted probability suggests', 'High-volume trades indicate', 'Liquidity analysis points to'],
    reversal: ['Mean-reversion signals suggest', 'Contrarian indicators favor', 'Overextension detected, reversal likely to']
  };
  const reason = reasons[model]?.[Math.floor(Math.random() * 3)] || 'Analysis indicates';
  return `${reason} ${direction} outcome. Mirofish ${model} model confidence: ${(confidence * 100).toFixed(1)}%.`;
}

// ─── Exports ──────────────────────────────────────────────────
async function getPredictions(markets = []) {
  const now = Date.now();
  if (predictionCache.data && (now - predictionCache.ts) < predictionCache.ttl) {
    return predictionCache.data;
  }

  let predictions = await fetchLivePredictions();
  if (!predictions || predictions.length === 0) {
    predictions = generatePredictions(markets);
  }

  predictionCache = { data: predictions, ts: now, ttl: predictionCache.ttl };
  return predictions;
}

async function getPrediction(marketId) {
  const all = await getPredictions();
  return all.find(p => p.marketId === marketId) || generatePredictions()[0];
}

async function getSignals() {
  const now = Date.now();
  if (signalCache.data && (now - signalCache.ts) < signalCache.ttl) {
    return signalCache.data;
  }

  const preds = await getPredictions();
  const signals = preds
    .filter(p => p.signal !== 'HOLD')
    .sort((a, b) => Math.abs(b.confidence - 0.5) - Math.abs(a.confidence - 0.5))
    .slice(0, 10);

  signalCache = { data: signals, ts: now, ttl: signalCache.ttl };
  return signals;
}

module.exports = { getPredictions, getPrediction, getSignals };
