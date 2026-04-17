// ============================================================
//  AGENTIC CLAW — Price Module v2.2
//  FIXES: removed self-broadcast (double-send bug),
//         realistic change24h formula, added icon fallback
// ============================================================

const https = require('https');

let priceCache = { data: null, ts: 0, ttl: 30000 };

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: { 'User-Agent': 'AgenticClaw/2.2', 'Accept': 'application/json' },
      timeout: 8000,
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error('JSON parse failed: ' + data.slice(0, 60))); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Request timeout')); });
  });
}

// ── CoinGecko live data ────────────────────────────────────
async function fetchCryptoPrices() {
  const url = [
    'https://api.coingecko.com/api/v3/simple/price',
    '?ids=bitcoin,ethereum,solana,binancecoin,matic-network',
    '&vs_currencies=usd',
    '&include_24hr_change=true',
    '&include_24hr_vol=true',
    '&include_market_cap=true',
  ].join('');

  const data = await fetchJson(url);

  const META = {
    bitcoin:         { symbol: 'BTC', name: 'Bitcoin',  icon: '₿' },
    ethereum:        { symbol: 'ETH', name: 'Ethereum', icon: 'Ξ' },
    solana:          { symbol: 'SOL', name: 'Solana',   icon: '◎' },
    binancecoin:     { symbol: 'BNB', name: 'BNB Chain',icon: '⬡' },
    'matic-network': { symbol: 'POL', name: 'Polygon',  icon: '⬟' },
  };

  return Object.entries(data)
    .filter(([id]) => META[id])
    .map(([id, v]) => ({
      id,
      ...META[id],
      price:     v.usd,
      change24h: v.usd_24h_change ?? 0,
      volume24h: v.usd_24h_vol,
      marketCap: v.usd_market_cap,
      type:      'crypto',
      unit:      '',
    }));
}

// ── Simulated price state (random walk) ───────────────────
const BASE = { BTC: 104800, ETH: 3840, SOL: 187, BNB: 612, POL: 0.71, GOLD: 2781, OIL: 78.4, SILVER: 32.1 };
const VOL  = { BTC: 0.003,  ETH: 0.004, SOL: 0.006, BNB: 0.003, POL: 0.008, GOLD: 0.0008, OIL: 0.002, SILVER: 0.0015 };
const ps   = {}; // price state
Object.entries(BASE).forEach(([s, p]) => { ps[s] = { price: p, open: p }; });

function walk(sym) {
  const p     = ps[sym];
  const delta = p.price * (VOL[sym] || 0.003) * (Math.random() * 2 - 1);
  p.price     = Math.max(p.price * 0.9, p.price + delta);
  // FIX #9: realistic change24h — uses actual drift from open price
  const change24h = ((p.price - p.open) / p.open) * 100;
  return { price: p.price, change24h };
}

function generateSimulated() {
  const cryptos = [
    { id:'bitcoin',  symbol:'BTC', name:'Bitcoin',  icon:'₿',  type:'crypto',    unit:'' },
    { id:'ethereum', symbol:'ETH', name:'Ethereum', icon:'Ξ',  type:'crypto',    unit:'' },
    { id:'solana',   symbol:'SOL', name:'Solana',   icon:'◎',  type:'crypto',    unit:'' },
    { id:'bnb',      symbol:'BNB', name:'BNB Chain',icon:'⬡',  type:'crypto',    unit:'' },
    { id:'polygon',  symbol:'POL', name:'Polygon',  icon:'⬟',  type:'crypto',    unit:'' },
    { id:'gold',     symbol:'GOLD',name:'Gold',     icon:'🥇', type:'commodity', unit:'/oz' },
    { id:'oil',      symbol:'OIL', name:'Crude Oil',icon:'🛢', type:'commodity', unit:'/bbl' },
    { id:'silver',   symbol:'SILVER',name:'Silver', icon:'🪙', type:'commodity', unit:'/oz' },
  ];
  return cryptos.map(item => {
    const { price, change24h } = walk(item.symbol);
    return { ...item, price, change24h };
  });
}

// ── formatPrice ────────────────────────────────────────────
function formatPrice(price, type) {
  if (!price) return '$0.00';
  if (type === 'crypto' && price < 0.01) return '$' + price.toFixed(6);
  if (type === 'crypto' && price < 1)    return '$' + price.toFixed(4);
  if (type === 'crypto' && price < 100)  return '$' + price.toFixed(2);
  return '$' + price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// ── Public API ─────────────────────────────────────────────
// FIX #2: NO self-broadcast — caller in index.js handles that
async function getPrices() {
  const now = Date.now();
  if (priceCache.data && (now - priceCache.ts) < priceCache.ttl) return priceCache.data;

  let prices;
  try {
    const crypto     = await fetchCryptoPrices();
    const commodities = generateSimulated().filter(p => p.type === 'commodity');
    prices = [...crypto, ...commodities].map(p => ({
      ...p,
      change24h:     parseFloat((p.change24h || 0).toFixed(2)),
      direction:     (p.change24h || 0) >= 0 ? 'UP' : 'DOWN',
      formattedPrice: formatPrice(p.price, p.type),
    }));
  } catch (e) {
    if (global.agenticLog) global.agenticLog('WARN', 'PRICES', 'CoinGecko unavailable — simulated: ' + e.message);
    prices = generateSimulated().map(p => ({
      ...p,
      change24h:     parseFloat((p.change24h || 0).toFixed(2)),
      direction:     (p.change24h || 0) >= 0 ? 'UP' : 'DOWN',
      formattedPrice: formatPrice(p.price, p.type),
    }));
  }

  priceCache = { data: prices, ts: now, ttl: priceCache.ttl };
  return prices;
}

module.exports = { getPrices };
