# Moni - Agentic Trading for Tokenized Stocks on Base via iMessage

An agentic trading application that lets users trade Coinbase Tokenized Stocks (B20 standard) on Base directly through iMessage. Built for the [Base Builder Quest](https://x.com/buildonbase/status/2095105184120664122).

## Features

- 📱 **iMessage Native**: Trade via text messages in the Messages app
- 🤖 **Agentic Assistant**: Cencori-powered agent (claude-sonnet-4.5) with tool calling, memory, and autonomous strategies
- 🔔 **Proactive Monitoring**: Moni initiates conversations - price alerts, stop-loss triggers, daily portfolio digest
- 💼 **Portfolio Management**: View holdings, track P&L, real-time prices
- 🔄 **Automated Strategies**: DCA auto-execution, price alerts, stop-loss, take-profit, rebalancing
- 💱 **Real Trade Execution**: 1inch DEX aggregation + Para MPC wallets (auto-approval, REST signing, on-chain broadcast)
- 🔐 **Embedded Wallets**: Para-powered MPC wallet abstraction (no seed phrases)
- ⚡ **Base Native**: Direct integration with B20 tokenized stocks (AAPL, NVDA, MSFT, etc.)
- 🐳 **Deployable**: Docker image, health check endpoint, AtlasFlow-ready
- 🎯 **Builder Quest Compliant**: Non-US users only, demo mode for safe submission

## Quick Start

### Prerequisites

- Node.js 20+
- [Photon/Spectrum account](https://app.photon.codes/) for iMessage infrastructure
- [Para account](https://www.getpara.com/) for MPC wallets
- [1inch API key](https://business.1inch.com/portal) for DEX aggregation (optional for demo)
- [Cencori API key](https://cencori.com) for the AI agent (optional for demo)

### Installation

```bash
# Clone and install
cd moni
npm install

# Copy environment template
cp .env.example .env

# Fill in your credentials in .env
# PROJECT_ID, PROJECT_SECRET from Photon dashboard
# PARA_API_KEY from Para dashboard
# BASE_RPC_URL (mainnet or sepolia)
# ONEINCH_API_KEY (optional, for real swaps)
# CENCORI_API_KEY (optional, for the AI agent; demo mode doesn't need it)
# DEMO_MODE=true (for Builder Quest submission)
```

### Development

```bash
# Run in development mode with hot reload
npm run dev

# In another terminal, test via terminal provider
# The app will show a terminal interface for testing
```

### Production Deployment

```bash
# Build
npm run build

# Or use the Docker image
docker build -t moni .
docker run -p 3000:3000 --env-file .env moni

# Configure Spectrum iMessage lines in Photon dashboard
npm start
```

The server exposes `GET /health` for uptime checks.

## Configuration

| Variable | Required | Description |
|----------|----------|-------------|
| `PROJECT_ID` | Yes | Spectrum project ID from Photon |
| `PROJECT_SECRET` | Yes | Spectrum project secret |
| `PARA_API_KEY` | Yes | Para API key for MPC wallets |
| `PARA_ENVIRONMENT` | No | Para env: `PROD`, `BETA`, or `SANDBOX` (default: `BETA`) |
| `BASE_RPC_URL` | Yes | Base RPC endpoint (mainnet or sepolia) |
| `ONEINCH_API_KEY` | No | 1inch API key for swap quotes |
| `CENCORI_API_KEY` | No | Cencori API key for the AI agent |
| `CENCORI_MODEL` | No | AI model (default: `claude-sonnet-4.5`) |
| `DEMO_MODE` | No | Set to `true` for simulated trades (default: true) |

## Commands

| Command | Description |
|---------|-------------|
| `/portfolio` | View your tokenized stock holdings |
| `/price AAPL` | Check real-time price for a token |
| `/buy 100 USDC AAPL` | Buy $100 worth of AAPL with USDC |
| `/sell 10 AAPL USDC` | Sell 10 AAPL for USDC |
| `/confirm` / `/cancel` | Confirm or cancel pending trade |
| `/watchlist` | View watchlist with prices |
| `/watchlist add AAPL` | Add token to watchlist |
| `/dca create 50 USDC AAPL weekly` | Create DCA strategy |
| `/dca list` | List active DCA strategies |
| `/alert create AAPL above 200` | Create price alert |
| `/connect` | Connect wallet via Para MPC |
| `/help` | Show all commands |

## Natural Language

You can also chat naturally:
- "What's my portfolio worth?"
- "Buy $500 of NVDA"
- "Set up weekly DCA for MSFT"
- "Alert me if TSLA drops below $200"
- "Rebalance my portfolio to 40% AAPL, 30% NVDA, 30% MSFT"

Moni can also message you first (price alerts, stop-loss hits, daily digest) thanks to the proactive monitor.

## Architecture

```
iMessage User
    ↓ (Spectrum-TS iMessage Provider)
Spectrum Agent Server (Node.js/Bun)
    ├── Para Wallet Adapter (MPC embedded wallet, REST signing)
    ├── Cencori Agent Core (LLM + tool calling + memory)
    ├── Proactive Monitor (price alerts, DCA auto-exec, digest)
    ├── Base RPC Client (mainnet)
    │   ├── B20 Token Contracts (AAPLc, NVDAc, etc.)
    │   ├── Chainlink Price Feeds (onchain oracle)
    │   └── 1inch/Aerodrome DEX Aggregator (swaps)
    ├── Health Server (GET /health)
    └── Local Memory Store (.moni-data JSON persistence)
```

## Supported Tokens (Coinbase Tokenized Stocks on Base)

- **AAPL** - Apple Inc.
- **AMZN** - Amazon.com Inc.
- **COIN** - Coinbase Global Inc.
- **CRCL** - Circle Internet Group
- **GOOGL** - Alphabet Inc.
- **INTC** - Intel Corporation
- **META** - Meta Platforms Inc.
- **MSFT** - Microsoft Corporation
- **MSTR** - MicroStrategy Inc.
- **NVDA** - NVIDIA Corporation
- **SNDK** - Sandisk
- **SPCX** - S&P 500 ETF
- **SPX** - Space Exploration Technologies Corp. (SpaceX)
- **TSLA** - Tesla Inc.

## Builder Quest Submission

This project is designed for the Base Builder Quest (deadline: Sep 9, 2026, 11:59pm US Eastern ≈ Sep 10, 4:59am WAT):

1. **Run in demo mode**: `DEMO_MODE=true` (default) - all trades simulated
2. **Record Loom demo** showing:
   - Wallet connection via iMessage
   - Portfolio viewing with real B20 prices
   - Trading via text commands
   - Agentic features (DCA, alerts, natural language)
3. **Submit** via [Google Form](https://docs.google.com/forms/d/e/1FAIpQLSfru57ZLO9AQ-hgWX_G5ZAzmAKkzFLZCyqe5wTyBSwACFX5tg/viewform?usp=send_form) + post Loom on X tagging @buildonbase

## Compliance

- ⚠️ **Non-US users only** - Coinbase Tokenized Stocks are only available in eligible jurisdictions outside the U.S.
- Demo mode ensures no real funds at risk during quest submission
- All trades respect B20 policies and compliance requirements

## License

MIT
