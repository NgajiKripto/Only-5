# Only-5

**Autonomous money-making agent starting with $5 of SOL**

Only-5 is a self-improving autonomous agent that uses multiple strategies to grow a starting balance of $5 in SOL. It combines on-chain trading, bounty hunting, content creation, and microtask completion with an AI-powered learning loop that adapts its behavior over time.

## Features

- **Multi-strategy revenue generation** - On-chain trading, GitHub bounties, airdrop farming, content creation, microtask platforms
- **Self-improving AI loop** - Periodically reviews past decisions, extracts patterns, and adjusts strategy parameters
- **Risk management** - Configurable daily loss limits, trade size caps, cooldown periods, and minimum balance protection
- **Telegram control interface** - Monitor, control, and receive alerts via Telegram bot
- **Persistent memory** - SQLite-backed decision history, learnings, and performance tracking
- **Graceful operation** - Handles crashes, restarts, and shutdowns without losing state

## Architecture

```
src/
├── index.ts              # Entry point - bootstrap and signal handling
├── config.ts             # Environment validation with Zod
├── core/
│   ├── agent.ts          # Main agent loop and orchestration
│   ├── learning.ts       # Self-improvement / learning cycle
│   ├── risk.ts           # Risk management module
│   ├── memory.ts         # SQLite persistence layer
│   ├── scheduler.ts      # Cron-based task scheduling
│   ├── wallet.ts         # Solana wallet management
│   └── logger.ts         # Winston logging
├── strategies/
│   ├── base.ts           # Abstract strategy class
│   ├── onchain.ts        # On-chain trading (Jupiter swaps)
│   ├── airdrop.ts        # Airdrop farming
│   ├── bounty.ts         # GitHub bounty hunting
│   ├── content.ts        # Content creation
│   └── microtask.ts      # Microtask platforms
├── integrations/
│   ├── openrouter.ts     # LLM provider (OpenRouter API)
│   ├── solana.ts         # Solana blockchain helpers
│   ├── jupiter.ts        # Jupiter DEX integration
│   └── github.ts         # GitHub API for bounties
├── telegram/
│   ├── bot.ts            # Grammy bot setup
│   ├── alerts.ts         # Alert system with rate limiting
│   ├── commands/         # Command handlers
│   └── index.ts          # Telegram module entry
└── types/
    └── index.ts          # Shared TypeScript types
```

## Prerequisites

- **Node.js** 22+ (recommended: 24)
- **Solana wallet** with a funded private key (minimum 0.1 SOL for rent)
- **Telegram bot token** from [@BotFather](https://t.me/BotFather)
- **OpenRouter API key** from [openrouter.ai](https://openrouter.ai)
- **GitHub token** (optional, for higher API rate limits on bounty searching)

## Quick Start

```bash
# Clone the repository
git clone https://github.com/your-username/Only-5.git
cd Only-5

# Install dependencies
npm install

# Configure environment
cp .env.example .env
# Edit .env with your actual keys

# Build
npm run build

# Run
npm start
```

For development with auto-reload:

```bash
npm run dev
```

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `TELEGRAM_BOT_TOKEN` | Yes | - | Telegram bot token from BotFather |
| `OPENROUTER_API_KEY` | Yes | - | API key for OpenRouter LLM access |
| `SOLANA_PRIVATE_KEY` | Yes | - | Base58-encoded Solana wallet private key |
| `SOLANA_RPC_URL` | No | `https://api.mainnet-beta.solana.com` | Solana RPC endpoint |
| `GITHUB_TOKEN` | No | - | GitHub personal access token for bounty search |
| `LOG_LEVEL` | No | `info` | Logging level: debug, info, warn, error |
| `DB_PATH` | No | `./data/only5.db` | Path to SQLite database file |
| `AGENT_NAME` | No | `Only-5` | Agent display name |

## Strategies

### On-Chain Trading (`onchain`)
Monitors token prices on Solana DEXes via Jupiter. Executes swaps when profitable opportunities are detected based on LLM analysis of market conditions.

- **Risk Level:** HIGH
- **Minimum Balance:** 0.1 SOL

### Airdrop Farming (`airdrop`)
Identifies and participates in airdrops and token distributions on Solana. Performs qualifying actions (swaps, staking) to become eligible.

- **Risk Level:** LOW
- **Minimum Balance:** 0.05 SOL

### Bounty Hunting (`bounty`)
Searches GitHub for issues with bounty rewards. Uses LLM to assess complexity and generates solution approaches. Targets smaller, well-defined bounties.

- **Risk Level:** LOW
- **Minimum Balance:** 0 SOL

### Content Creation (`content`)
Generates technical content and educational material using LLM capabilities. Targets platforms with creator reward programs.

- **Risk Level:** LOW
- **Minimum Balance:** 0 SOL

### Microtask Completion (`microtask`)
Completes small tasks on platforms that pay in crypto. Tasks include data labeling, testing, and simple development work.

- **Risk Level:** LOW
- **Minimum Balance:** 0 SOL

## Telegram Commands

| Command | Description |
|---------|-------------|
| `/status` | Show agent state, uptime, balance, active strategies |
| `/balance` | Show SOL and token balances with USD values |
| `/strategies` | List all strategies with performance stats |
| `/enable <name>` | Enable a strategy |
| `/disable <name>` | Disable a strategy |
| `/strategy <name>` | Detailed view of one strategy |
| `/report` | Generate daily P&L report with breakdown |
| `/pnl` | Quick profit/loss summary |
| `/pause` | Pause all agent activity |
| `/resume` | Resume operations |
| `/config` | Show current configuration |
| `/logs` | Show recent log entries |
| `/errors` | Show recent errors |

## Deployment

### PM2 on VPS

```bash
# Install PM2 globally
npm install -g pm2

# Build the project
npm run build

# Start with PM2
pm2 start ecosystem.config.cjs

# Monitor
pm2 monit

# View logs
pm2 logs only-5
```

### Docker

```bash
# Build image
docker build -t only-5 .

# Run container
docker run -d \
  --name only-5 \
  --env-file .env \
  -v ./data:/app/data \
  only-5
```

### Docker Compose

```bash
# Start in background
docker-compose up -d

# View logs
docker-compose logs -f

# Stop
docker-compose down
```

## Risk Management

The agent includes a built-in risk management system that prevents catastrophic losses:

- **Daily Loss Limit** (default 20%): Maximum loss per day as a percentage of starting balance. Once reached, all trading stops until the next day.
- **Max Trade Size** (default 10%): No single trade can exceed this percentage of current balance.
- **Max Exposure** (default 50%): Total open position value cannot exceed this percentage.
- **Cooldown After Loss** (default 30 min): After any loss, the agent pauses trading to prevent emotional/cascading trades.
- **Minimum Balance** (default 0.1 SOL): Balance never drops below this amount (needed for Solana rent exemption).

## Self-Improvement System

Every 6 hours (configurable), the agent runs a learning cycle:

1. Fetches recent decisions and their outcomes from memory
2. Groups decisions by strategy
3. Sends decision history to LLM for pattern analysis
4. Extracts structured insights (what worked, what failed, suggested adjustments)
5. Persists learnings as "skills" in the memory system
6. Updates confidence scores for each strategy

Over time, the agent learns which strategies work best under which conditions and adjusts its behavior accordingly.

## Configuration Tuning

Key parameters you can adjust:

- **Strategy evaluation interval**: Default 30 seconds. Increase for less aggressive trading.
- **Learning cycle interval**: Default 6 hours. Decrease for faster adaptation.
- **Risk limits**: Adjust in agent options for your risk tolerance.
- **LLM model**: Change in OpenRouter config for different cost/quality tradeoffs.

## Testing

```bash
# Run all tests
npm test

# Run specific test file
npx vitest run tests/core/risk.test.ts

# Run with coverage
npx vitest run --coverage
```

## Disclaimer

This software is provided for educational and experimental purposes. Cryptocurrency trading involves significant financial risk. By using this software, you acknowledge:

- You may lose some or all of your invested capital
- Past performance does not guarantee future results
- The agent makes autonomous decisions that may result in losses
- The developers are not responsible for any financial losses
- You should only invest what you can afford to lose completely

Always start with small amounts and monitor the agent's behavior carefully before increasing exposure.
