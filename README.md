<div align="center">

# Only-5

### Autonomous Revenue Agent for Solana

**Turn $5 into a self-sustaining income stream. No human intervention required.**

[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-3178C6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-22+-339933?style=flat-square&logo=node.js&logoColor=white)](https://nodejs.org/)
[![Solana](https://img.shields.io/badge/Solana-Mainnet-9945FF?style=flat-square&logo=solana&logoColor=white)](https://solana.com/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow?style=flat-square)](LICENSE)
[![Tests](https://img.shields.io/badge/Tests-217%20passing-success?style=flat-square)]()

---

*An AI-powered agent that autonomously discovers, evaluates, and executes revenue opportunities across multiple strategies on the Solana blockchain.*

[Quick Start](#quick-start) · [Strategies](#strategies) · [Architecture](#architecture) · [Deployment](#deployment) · [Configuration](#configuration)

</div>

---

## Overview

Only-5 is a fully autonomous agent that operates 24/7 on a VPS, starting with just **$5 worth of SOL**. It uses LLM-guided decision making to identify and execute revenue opportunities across multiple domains — from on-chain arbitrage to security bounty hunting to paid scanning services.

The agent learns from every action it takes. A self-improvement loop analyzes past decisions every 6 hours, extracts patterns, and adjusts strategy confidence scores. Over time, it converges on the most profitable strategies for current market conditions.

### Key Capabilities

| Capability | Description |
|:-----------|:------------|
| **Multi-Strategy Engine** | 7 revenue strategies operating in parallel, each with independent risk profiles |
| **Self-Improvement** | LLM-driven learning cycle extracts patterns from decision history |
| **Risk Management** | Daily loss limits, position sizing, exposure caps, cooldown periods |
| **MCP Execution Layer** | All actions pass through a controlled gatekeeper with audit trail |
| **Security Scanner** | Built-in vulnerability assessment for paid scanning services |
| **Telegram Interface** | Full monitoring, control, and alert system via bot commands |
| **Persistent Memory** | SQLite-backed decision history, skills, and observations |

---

## How It Works

```
┌─────────────────────────────────────────────────────────────────────┐
│                          Only-5 Agent Loop                           │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│   ┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐    │
│   │ Evaluate │───>│   Rank   │───>│   Risk   │───>│ Execute  │    │
│   │Strategies│    │  (LLM)   │    │  Check   │    │          │    │
│   └──────────┘    └──────────┘    └──────────┘    └──────────┘    │
│         │                                               │          │
│         │              ┌──────────┐                     │          │
│         └──────────────│  Learn   │<────────────────────┘          │
│                        │ (6h loop)│                                 │
│                        └──────────┘                                 │
│                                                                     │
├─────────────────────────────────────────────────────────────────────┤
│  MCP Execution Layer: Permission · Rate Limit · Sanitize · Audit   │
└─────────────────────────────────────────────────────────────────────┘
```

Every 30 seconds, the agent:

1. **Evaluates** all enabled strategies for opportunities
2. **Ranks** opportunities using LLM analysis (confidence, reward, risk)
3. **Validates** against risk manager (daily limits, exposure caps, cooldowns)
4. **Executes** through the MCP gatekeeper with full audit logging
5. **Records** outcomes for the learning system to analyze

---

## Strategies

### Revenue Strategies

| Strategy | Type | Risk | Min Balance | Description |
|:---------|:-----|:-----|:------------|:------------|
| `onchain` | Trading | HIGH | 0.1 SOL | Round-trip arbitrage via Jupiter DEX with retry logic |
| `airdrop` | Farming | LOW | 0.05 SOL | Automated DeFi interactions to qualify for token airdrops |
| `security-bounty` | Bounty | LOW | 0 SOL | Scan targets on HackerOne, Immunefi, Code4rena for vulnerabilities |
| `security-service` | Service | LOW | 0 SOL | Paid security scanning service via Telegram (SOL per scan) |
| `github-bounty` | Bounty | LOW | 0 SOL | Find and assess GitHub issues with bounty rewards |
| `content` | Creation | LOW | 0 SOL | Generate crypto/DeFi analysis content for monetization |
| `microtask` | Tasks | LOW | 0 SOL | Complete paid micro-tasks on crypto-native platforms |

### Strategy Lifecycle

```
Disabled ──> Enabled ──> Evaluating ──> Opportunity Found ──> Risk Check ──> Execute ──> Record
                ^                                                                          │
                └──────────────────── Learning Loop Adjusts ───────────────────────────────┘
```

---

## Architecture

```
src/
├── core/
│   ├── agent.ts          # Main orchestration loop (30s cycle)
│   ├── mcp.ts            # MCP execution layer (gatekeeper)
│   ├── risk.ts           # Risk management (limits, exposure, cooldown)
│   ├── learning.ts       # Self-improvement cycle (6h)
│   ├── memory.ts         # SQLite persistence + pruning
│   ├── wallet.ts         # Solana wallet (encapsulated signing)
│   ├── scheduler.ts      # Cron-based task scheduling
│   └── logger.ts         # Structured logging (Winston)
├── strategies/
│   ├── base.ts           # Abstract strategy interface
│   ├── onchain.ts        # Jupiter round-trip arbitrage
│   ├── airdrop.ts        # Protocol interaction farming
│   ├── security-bounty.ts # Bug bounty platform hunting
│   ├── security-service.ts # Paid scanning service
│   ├── bounty.ts         # GitHub bounty hunting
│   ├── content.ts        # Content monetization
│   └── microtask.ts      # Micro-task completion
├── integrations/
│   ├── openrouter.ts     # LLM client (rate-limited, retries)
│   ├── solana.ts         # Blockchain helpers
│   ├── jupiter.ts        # DEX (quotes, swaps, retry on blockhash expiry)
│   ├── github.ts         # GitHub API
│   └── security-scanner.ts # Header/SSL/port/vuln scanning
├── telegram/
│   ├── bot.ts            # Grammy bot + passphrase auth
│   ├── alerts.ts         # Rate-limited notifications
│   └── commands/         # /status, /scan, /bounties, /security, etc.
└── types/
    └── index.ts          # Shared type definitions
```

### Security Design

- **Encapsulated signing** — Private key never leaves `WalletManager`; signing is internal-only
- **MCP gatekeeper** — All tool executions pass through permission checks, rate limiting, and input sanitization
- **Telegram auth** — Passphrase-based with 5-minute expiry, persisted to SQLite, revocable
- **Input sanitization** — Shell injection pattern detection on all MCP parameters
- **Audit trail** — Every action logged to SQLite for forensic review

---

## Quick Start

### Prerequisites

- Node.js 22+
- Solana wallet with $5+ SOL
- [Telegram bot token](https://t.me/BotFather)
- [OpenRouter API key](https://openrouter.ai)

### Install & Run

```bash
git clone https://github.com/NgajiKripto/Only-5.git
cd Only-5
npm install
cp .env.example .env    # Edit with your keys
npm run build
npm start
```

### Development

```bash
npm run dev             # Run with tsx (auto-reload)
npm test               # Run test suite (217 tests)
npm run build          # TypeScript compilation
```

---

## Configuration

### Required Environment Variables

```env
TELEGRAM_BOT_TOKEN=         # From @BotFather
OPENROUTER_API_KEY=         # From openrouter.ai
SOLANA_PRIVATE_KEY=         # Base58-encoded wallet private key
```

### Optional Environment Variables

| Variable | Default | Description |
|:---------|:--------|:------------|
| `SOLANA_RPC_URL` | `https://api.mainnet-beta.solana.com` | Solana RPC endpoint (Helius recommended) |
| `GITHUB_TOKEN` | — | GitHub PAT for higher rate limits |
| `HACKERONE_API_TOKEN` | — | HackerOne API access |
| `IMMUNEFI_API_KEY` | — | Immunefi platform access |
| `SECURITY_SCAN_PRICE_SOL` | `0.1` | Price per scan in SOL |
| `LOG_LEVEL` | `info` | Logging verbosity |
| `DB_PATH` | `./data/only5.db` | SQLite database path |
| `AGENT_NAME` | `Only-5` | Display name in logs/alerts |

---

## Telegram Commands

### Monitoring

| Command | Description |
|:--------|:------------|
| `/status` | Agent state, uptime, balance, active strategies |
| `/balance` | SOL and token balances with USD values |
| `/pnl` | Profit/loss summary |
| `/report` | Detailed daily P&L report |
| `/logs` | Recent log entries (tail-read, memory-safe) |
| `/errors` | Recent error entries |

### Strategy Control

| Command | Description |
|:--------|:------------|
| `/strategies` | List all strategies with performance stats |
| `/enable <name>` | Enable a strategy |
| `/disable <name>` | Disable a strategy |
| `/pause` | Pause all agent activity |
| `/resume` | Resume operations |

### Security

| Command | Description |
|:--------|:------------|
| `/scan <url>` | Queue a paid security scan |
| `/bounties` | Bug bounty monitoring status |
| `/security` | Combined security strategy statistics |

---

## Deployment

### PM2 (Recommended for VPS)

```bash
npm install -g pm2
npm run build
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup
```

### Docker

```bash
docker build -t only-5 .
docker run -d --name only-5 --env-file .env -v ./data:/app/data only-5
```

### Docker Compose

```bash
docker-compose up -d
docker-compose logs -f    # Monitor
docker-compose down       # Stop
```

---

## Risk Management

The agent enforces strict risk boundaries to prevent catastrophic losses:

| Parameter | Default | Description |
|:----------|:--------|:------------|
| Daily Loss Limit | 20% | Max daily loss as % of starting balance |
| Max Trade Size | 10% | No single trade exceeds this % of balance |
| Max Exposure | 50% | Total open positions capped at this % |
| Cooldown After Loss | 30 min | Trading pause after any loss event |
| Minimum Balance | 0.1 SOL | Floor balance (Solana rent exemption) |

The risk manager tracks open positions in real-time and blocks any trade that would violate these constraints.

---

## Self-Improvement System

The learning loop runs every 6 hours:

```
Fetch Decisions → Group by Strategy → LLM Pattern Analysis → Extract Insights → Persist Skills → Update Confidence
```

**What it learns:**
- Which strategies perform best under current conditions
- Optimal timing for different opportunity types
- Risk patterns that precede losses
- Market conditions that correlate with success

Confidence scores adjust strategy selection priority over time.

---

## MCP Execution Layer

Inspired by the [Dark-Moon](https://github.com/ASCIT31/Dark-Moon) security platform architecture, all tool execution passes through a controlled gatekeeper:

```
Strategy → MCP Layer → [Permission Check] → [Rate Limit] → [Sanitize] → [Execute] → [Audit]
```

- **Per-strategy permissions** — Each strategy registers its allowed tools
- **Sliding window rate limiting** — Prevents abuse and API exhaustion
- **Input sanitization** — Blocks shell injection and suspicious patterns
- **Timeout management** — AbortController-based timeouts on all operations
- **Full audit trail** — Every action logged with strategy, params, result, timing

---

## Testing

```bash
npm test                              # All 217 tests
npx vitest run tests/core/risk.test.ts    # Specific file
npx vitest run --coverage             # Coverage report
```

Test coverage includes:
- Core modules (memory, scheduler, wallet, risk, learning)
- Strategy evaluation and execution
- MCP execution layer (permissions, rate limiting, sanitization)
- Telegram command handlers
- Integration agent lifecycle

---

## Inspiration

Only-5 draws architectural inspiration from:

- **[Charon](https://github.com/yunus-0x/charon)** — Strategy-based trading, Telegram-first UX, position monitoring
- **[Hermes Agent](https://github.com/nousresearch/hermes-agent)** — Self-improvement loop, skill memory, scheduled automations
- **[MiroFish](https://github.com/666ghj/MiroFish)** — Multi-agent decision making, prediction capabilities
- **[Dark-Moon](https://github.com/ASCIT31/Dark-Moon)** — MCP execution gatekeeper, security scanning, sub-agent orchestration

---

## Disclaimer

This software is experimental. Cryptocurrency operations involve financial risk.

- You may lose some or all of your invested capital
- The agent makes autonomous decisions that may result in losses
- Past performance does not guarantee future results
- The developers assume no liability for financial losses
- Only deploy with capital you can afford to lose entirely
- Security scanning features should only target systems you have authorization to test

**Start small. Monitor closely. Scale gradually.**

---

<div align="center">

**Built with autonomy in mind.**

[Report Bug](https://github.com/NgajiKripto/Only-5/issues) · [Request Feature](https://github.com/NgajiKripto/Only-5/issues)

</div>
