# AGENTIC CLAW — Changelog

## v2.2.0 — Full Audit & Debug Release
*Comprehensive code audit: 18 bugs found and fixed across 7 files*

### 🔴 Critical Fixes
1. **AgentManager — Log schema mismatch** (`AgentManager.js`)
   - Server was sending `{msg}` in log entries; frontend expected `{message, source}`
   - All agent log entries appeared blank in the System Log panel
   - Fix: server now sends correct `{id, ts, level, source, message}` schema

2. **Prices double broadcast** (`prices.js` + `index.js`)
   - `getPrices()` called `global.broadcast()` internally AND the 30s interval broadcast again
   - Every refresh sent `PRICES_UPDATE` twice to all connected clients
   - Fix: removed self-broadcast from `prices.js`; caller owns the broadcast

3. **Agent payload bloat** (`AgentManager.js`)
   - `toJSON()` included `logs: this.logs.slice(0,20)` — sent on every state change
   - With 2+ agents ticking every 8–45s, this was hundreds of KB/s of wasted bandwidth
   - Fix: `toJSON()` no longer includes logs array

### 🟠 High Fixes
4. **Intervals without try/catch** (`index.js`)
   - Async errors in 30s/180s refresh intervals crashed silently with no recovery
   - Fix: wrapped in `try/catch` with `log('ERROR')` on failure

5. **Wallet unguarded throw** (`wallet.js`)
   - `if (!apiKey || !address) throw` was *outside* the try/catch block
   - Caused unguarded exception propagation instead of graceful fallback
   - Fix: guard moved inside try/catch

6. **Solana dead HTTP fetch** (`wallet.js`)
   - Made a broken RPC call (no POST body, wrong method), then always returned `simulateWallet()` regardless
   - Wasted 8 seconds per call waiting for timeout
   - Fix: removed dead fetch; always simulate for Solana

7. **Gateway string arithmetic** (`gateway.js`)
   - `pred.confidence - market.yes` where `market.yes = "0.4977"` (string from API)
   - JS coerced the subtraction but edge calculation was unreliable
   - Fix: `parseFloat(market.yes)` applied before arithmetic

8. **`const` in switch without braces** (`index.js`)
   - Lexical declarations (`const cat`, `const sec`, `const n`) inside switch cases
   - Without block braces, binding exists across the whole switch — scoping hazard
   - Fix: all cases now have explicit `{}` block scope

### 🟡 Medium Fixes
9. **Unrealistic `change24h` formula** (`prices.js`)
   - Formula: `((current - BASE) / BASE) * 100 * 3 + noise` amplified drift by 3×
   - Simulated prices showed ±60% changes after a few refreshes
   - Fix: uses actual drift from open price — realistic ±1–5% range

10. **Unused variable** (`news.js`)
    - `let newsRotationIdx = 0;` declared but never referenced
    - Fix: removed

11. **Timer leak on agent resume** (`AgentManager.js`)
    - `resume()` called `start()`, which created a new `setInterval` without clearing any existing timer
    - Fix: `start()` now calls `clearInterval(this.timer)` before creating a new one

12. **Frontend `AGENT_LOG` schema mismatch** (`index.html`)
    - `addLog(entry)` → `logHtml()` read `l.message` but agent entries had `l.msg`
    - Fix: AGENT_LOG handler normalizes entry; `logHtml()` supports both `message` and `msg`

13. **Canvas no resize handler** (`index.html`)
    - Chart canvas didn't adapt when browser window was resized
    - Fix: `window.addEventListener('resize', drawChart)` added

14. **`ft-port` updated every second** (`index.html`)
    - `tick()` wrote `PORT 3747` to DOM every 1000ms — pointless DOM write
    - Fix: port set once in `ws.onopen` callback

15. **`wsSend()` silent on disconnect** (`index.html`)
    - Messages sent while WS was closed were silently dropped with no user feedback
    - Fix: prints `⚠ Not connected` warning to the terminal panel

16. **Markets terminal: string multiplication** (`index.js`)
    - Terminal `markets list` command: `m.yes * 100` where `m.yes` is string → `NaN%`
    - Fix: `parseFloat(m.yes) * 100`

### 🟢 Low Fixes
17. **Agent Room port detection brittle** (`agent-room.html`)
    - `window.opener?.location?.port` fails in sandboxed/cross-origin windows
    - Fix: `detectPort()` tries URL param `?port=` → page port → opener port → `'3747'`
    - `openAgentRoom()` now passes `?port=${SERVER_PORT}` in the URL

18. **Gateway version stale** (`gateway.js`)
    - `/api/health` returned `"version": "1.0.0"` 
    - Fix: updated to `2.2.0`

---

## v2.1.0
- Added News Panel, Price Panel, Wallet Panel, Agent 2D Room
- Fixed WebSocket port hardcoding (was `ws://localhost:3747`, now uses `location.port`)
- Fixed news filter buttons
- Fixed wallet display handler

## v2.0.0
- Initial multi-panel Mission Control
- Node.js server + Express + WebSocket
- API Gateway for Polymarket + Mirofish
- 6 autonomous trading agent strategies
- Sci-Fi 2D Agent Room

---

*Created by Joon Nyip Koh (OpenClaw Researcher)*
*LinkedIn: https://www.linkedin.com/in/joon-nyip-koh-6a219234/*
