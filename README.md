<div align="center">

# 🦞 AGENTIC CLAW
### Mission Control — Polymarket Trading Intelligence

[![Node.js](https://img.shields.io/badge/Node.js-18%2B-339933?logo=node.js&logoColor=white)](https://nodejs.org)
[![Version](https://img.shields.io/badge/version-2.2.0-00e5ff?labelColor=050810)](CHANGELOG.md)
[![License](https://img.shields.io/badge/license-MIT-a855f7?labelColor=050810)](LICENSE)
[![macOS](https://img.shields.io/badge/macOS-12%2B-white?logo=apple&logoColor=black)](install.sh)

**A real-time, browser-based Mission Control for autonomous Polymarket trading agents — powered by Mirofish AI predictions.**

*Created by [Joon Nyip Koh](https://www.linkedin.com/in/joon-nyip-koh-6a219234/) 
---

</div>

## ✨ Features

| Panel | Description |
|---|---|
| 📊 **Mission Control** | Full 4-column real-time dashboard |
| 🤖 **Agent Manager** | Spawn, pause, kill autonomous trading bots |
| 📰 **News Feed** | Live AI, Crypto, Finance & World news with sentiment |
| 💰 **Price Panel** | Top 5 crypto + Gold, Oil, Silver with sparklines |
| 🔐 **Wallet Viewer** | Polymarket, Ethereum, Solana, Binance balances |
| 🚀 **Agent Room** | Sci-Fi 2D canvas trading floor with animated robot agents |
| 🖥️ **Agent Terminal** | Full CLI — agents, markets, prices, news, wallet |
| 📡 **Gateway Monitor** | Live API request log with latency |

### Trading Strategies
Six autonomous agent strategies built-in:

| Strategy | Risk | Description |
|---|---|---|
| `mirofish_signal` | 🟢 LOW | Trades on Mirofish AI signal confidence |
| `value` | 🟢 LOW | Buys underpriced probabilities |
| `arbitrage` | 🟢 LOW | Exploits Mirofish vs market price gaps |
| `momentum` | 🟡 MED | Follows volume and price trends |
| `contrarian` | 🔴 HIGH | Bets against overextended markets |
| `scalper` | 🔴 HIGH | High-frequency micro trades |

---

## 🚀 Quick Start

### Option A — One-Click macOS Install
```bash
git clone https://github.com/joonnyip/agentic-claw.git
cd agentic-claw
bash install.sh
```
The installer checks for Node.js (offers Homebrew install if missing), builds `AgenticClaw.app` on your Desktop, and opens Mission Control in your browser.

### Option B — Manual (all platforms)
```bash
git clone https://github.com/joonnyip/agentic-claw.git
cd agentic-claw
npm install
cp .env.example .env
npm start
```
Then open **http://localhost:3747**

### Requirements
- **Node.js 18+** — [nodejs.org](https://nodejs.org)
- **npm** (comes with Node.js)
- A modern browser (Chrome, Firefox, Safari, Edge)

---

## 🏗️ Architecture

```
agentic-claw/
├── server/
│   ├── index.js              # Express + WebSocket hub (port 3747)
│   ├── gateway.js            # API Gateway — all external calls routed here
│   ├── polymarket.js         # Polymarket market data & trade engine
│   ├── mirofish.js           # Mirofish AI prediction integration
│   ├── prices.js             # CoinGecko crypto + commodity prices
│   ├── news.js               # News aggregator (AI, Crypto, Finance, World)
│   ├── wallet.js             # Multi-chain wallet viewer
│   └── agents/
│       └── AgentManager.js   # Autonomous trading agent orchestrator
├── frontend/
│   ├── index.html            # Mission Control UI (served by Express)
│   └── agent-room.html       # Sci-Fi 2D Agent Room (canvas)
├── app-bundle/
│   └── AgenticClaw.app/      # macOS .app bundle template
├── install.sh                # macOS one-click installer
├── .env.example              # Environment config template
└── package.json
```

### Data Flow
```
Browser ←──WebSocket──→ index.js ←──→ gateway.js
                                    ├──→ polymarket.js  (Polymarket API)
                                    ├──→ mirofish.js    (Mirofish AI)
                                    ├──→ prices.js      (CoinGecko)
                                    ├──→ news.js        (News feeds)
                                    └──→ wallet.js      (Wallet APIs)
                            └──→ AgentManager.js (6 trading strategies)
```

---

## ⚙️ Configuration

Copy `.env.example` to `.env`:
```bash
cp .env.example .env
```

Key settings:
```env
PORT=3747
SIMULATE_TRADES=true       # false = real Polymarket trades
POLYMARKET_API_KEY=        # Optional: for live trading
MIROFISH_API_KEY=          # Optional: for live AI predictions
```

> **Simulation mode** is on by default — safe to explore without risking funds.

---

## 🖥️ Agent Terminal Commands

Open the terminal panel in Mission Control and type:

```
help                          Show all commands
agents list                   List all running agents
agents spawn <strategy>       Spawn a new agent
agents kill <id>              Kill agent by ID
agents pause <id>             Pause an agent
markets refresh               Fetch latest Polymarket markets
predictions list              Show Mirofish AI signals
news AI                       Filter news by category
prices                        Show live crypto & commodity prices
wallet polymarket <address>   Check wallet balance
trade <marketId> YES          Execute a manual trade
status                        Full system status
logs 20                       Show last 20 log entries
clear                         Clear terminal
```

---

## 📡 REST API

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/health` | Server health + version |
| GET | `/api/markets` | All Polymarket markets |
| GET | `/api/predictions` | Mirofish AI predictions |
| GET | `/api/news` | News feed |
| GET | `/api/prices` | Crypto + commodity prices |
| GET | `/api/agents` | All agent states |
| POST | `/api/agents/spawn` | Spawn a new agent |
| DELETE | `/api/agents/:id` | Kill an agent |
| POST | `/api/wallet` | Wallet balance lookup |
| GET | `/api/gateway/stats` | Gateway request statistics |
| GET | `/api/combined/opportunities` | Cross-referenced trade signals |
| POST | `/api/polymarket/trade` | Execute a trade |

---

## 🤝 WebSocket Events

Connect to `ws://localhost:3747` for real-time updates:

| Event | Direction | Description |
|---|---|---|
| `SNAPSHOT` | Server → Client | Full state on connect |
| `AGENTS_UPDATE` | Server → Client | Agent state changes |
| `TRADE` | Server → Client | New trade executed |
| `MARKETS_UPDATE` | Server → Client | Market data refresh |
| `PRICES_UPDATE` | Server → Client | Price feed update |
| `NEWS_UPDATE` | Server → Client | News feed refresh |
| `PREDICTIONS_UPDATE` | Server → Client | Mirofish signal refresh |
| `WALLET_DATA` | Server → Client | Wallet balance result |
| `LOG` | Server → Client | System log entry |
| `GATEWAY_REQUEST` | Server → Client | API request logged |
| `AGENT_SPAWN` | Client → Server | Spawn an agent |
| `AGENT_KILL` | Client → Server | Kill an agent |
| `MANUAL_TRADE` | Client → Server | Execute manual trade |
| `GET_WALLET` | Client → Server | Request wallet data |
| `REFRESH_MARKETS` | Client → Server | Force market refresh |
| `TERMINAL_CMD` | Client → Server | Execute terminal command |

---

## 🔌 Live API Integration

### Polymarket
Market data is fetched from the public [Polymarket Gamma API](https://gamma-api.polymarket.com) — no key needed for read access. Live trading requires a Polymarket account and API credentials.

### Mirofish AI
Prediction signals from [Mirofish](https://mirofish.ai). Add your `MIROFISH_API_KEY` in `.env` for live predictions. Simulated signals are generated when no key is provided.

### CoinGecko
Price data from the [CoinGecko free API](https://coingecko.com) — no key needed. Realistic simulated prices are used as fallback.

---

## 🗺️ Roadmap

- [ ] Live Polymarket trading (with private key signing)
- [ ] Persistent agent state across restarts
- [ ] Portfolio P&L tracking with history chart
- [ ] Telegram / Discord trade notifications
- [ ] More Mirofish prediction models
- [ ] Agent strategy backtesting
- [ ] Docker support
- [ ] Windows installer

---

## 📋 Changelog

See [CHANGELOG.md](CHANGELOG.md) for full version history.

**v2.2.0** — Full audit: 18 bugs fixed across 7 files  
**v2.1.0** — News, Price, Wallet panels + Sci-Fi Agent Room  
**v2.0.0** — Initial Mission Control release  

---

## ⚠️ Disclaimer

This project is for **educational and research purposes**. Prediction markets involve financial risk. Always trade responsibly. This is not financial advice. The simulation mode is recommended for exploration.

---

## 📄 License

MIT — see [LICENSE](LICENSE)

---

<div align="center">

**Created by [Joon Nyip Koh](https://www.linkedin.com/in/joon-nyip-koh-6a219234/)** — OpenClaw Researcher

*OpenClaw Project · Agentic Claw v2.2*

</div>
