# Contributing to Agentic Claw

Thanks for your interest in contributing! This guide covers how to get set up and the kinds of contributions most welcome.

## Getting Started

```bash
git clone https://github.com/joonnyip/agentic-claw.git
cd agentic-claw
npm install
cp .env.example .env
npm start
```

Open http://localhost:3747 — changes to server files require a server restart; frontend changes auto-reflect on browser refresh.

## Project Structure

```
server/          Node.js backend (Express + WebSocket)
frontend/        Single-file HTML panels (no build step)
server/agents/   Autonomous trading agent strategies
```

## What to Contribute

**Great first issues:**
- Add a new trading strategy in `server/agents/AgentManager.js`
- Improve the simulated news articles in `server/news.js`
- Add a new commodity to `server/prices.js`
- Improve the Agent Room canvas visuals in `frontend/agent-room.html`
- Add a Docker / `docker-compose.yml`
- Windows installer script

**Bigger projects:**
- Live Polymarket trading with private key signing (CLOB API)
- Persistent agent state (SQLite or JSON file)
- Portfolio history charting
- Real Mirofish API integration
- Backtesting framework for strategies

## Code Style

- Plain Node.js — no TypeScript, no build step
- Frontend is intentionally single-file HTML (no bundler)
- Keep server modules focused — one file per external service
- Always add try/catch around external API calls
- Use `global.agenticLog(level, source, message)` for server logging

## Pull Request Checklist

- [ ] `node --check server/index.js` passes (syntax check)
- [ ] No API keys, tokens, or secrets in code
- [ ] `.env.example` updated if new env vars added
- [ ] Strategy changes tested with `npm start`
- [ ] CHANGELOG.md entry added

## Security

Never commit `.env` or any credentials. If you find a security issue, please email rather than opening a public issue.

## Disclaimer

This project is for educational purposes. Contributions should not encourage or enable reckless financial trading.

---

*Agentic Claw — OpenClaw Project*
