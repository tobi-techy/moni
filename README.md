# Moni - Agentic Trading for Tokenized Stocks on Base via iMessage

An agentic trading application that lets users trade Coinbase Tokenized Stocks (B20 standard) on Base directly through iMessage. Built for the [Base Builder Quest](https://x.com/buildonbase/status/2095105184120664122).

## Features

- 📱 **iMessage Native**: Trade via text messages in the Messages app
- 🤖 **Agentic Assistant**: Letta-powered agent with memory, learning, and autonomous strategies
- 💼 **Portfolio Management**: View holdings, track P&L, real-time prices
- 🔄 **Automated Strategies**: DCA, price alerts, stop-loss, take-profit
- 🔐 **Embedded Wallets**: Privy-powered wallet abstraction (no seed phrases)
- ⚡ **Base Native**: Direct integration with B20 tokenized stocks (AAPL, NVDA, MSFT, etc.)
- 🎯 **Builder Quest Compliant**: Non-US users only, demo mode for safe submission

## Quick Start

### Prerequisites

- Node.js 20+
- [Photon/Spectrum account](https://app.photon.codes/) for iMessage infrastructure
- [Privy account](https://privy.io/) for embedded wallets
- [1inch API key](https://portal.1inch.dev/) for DEX aggregation (optional for demo)
- [Letta API key](https://www.letta.com/) for agent memory (optional for demo)

### Installation

```bash
# Clone and install
cd moni
npm install

# Copy environment template
cp .env.example .env

# Fill in your credentials in .env
# PROJECT_ID, PROJECT_SECRET from Photon dashboard
# PRIVY_APP_ID, PRIVY_APP_SECRET from Privy dashboard
# BASE_RPC_URL (mainnet or sepolia)
# ONEINCH_API_KEY (optional, for real swaps)
# LETTA_API_KEY (optional, for agent memory)
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

# Deploy to your server (Docker, Railway, Fly.io, etc.)
# Configure Spectrum iMessage lines in Photon dashboard
npm start
```

## Configuration

| Variable | Required | Description |
|----------|----------|-------------|
| `PROJECT_ID` | Yes | Spectrum project ID from Photon |
| `PROJECT_SECRET` | Yes | Spectrum project secret |
| `PRIVY_APP_ID` | Yes | Privy App ID |
| `PRIVY_APP_SECRET` | Yes | Privy App Secret |
| `BASE_RPC_URL` | Yes | Base RPC endpoint (mainnet or sepolia) |
| `ONEINCH_API_KEY` | No | 1inch API key for swap quotes |
| `LETTA_API_KEY` | No | Letta API key for agent memory |
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
| `/connect` | Connect wallet via Privy |
| `/help` | Show all commands |

## Natural Language

You can also chat naturally:
- "What's my portfolio worth?"
- "Buy $500 of NVDA"
- "Set up weekly DCA for MSFT"
- "Alert me if TSLA drops below $200"
- "Rebalance my portfolio to 40% AAPL, 30% NVDA, 30% MSFT"

## Architecture

```
iMessage User
    ↓ (Spectrum-TS iMessage Provider)
Spectrum Agent Server (Node.js/Bun)
    ├── Privy Wallet Adapter (embedded wallet)
    ├── Letta Agent Core (memory/context/learning)
    ├── Base RPC Client (mainnet)
    │   ├── B20 Token Contracts (AAPLc, NVDAc, etc.)
    │   ├── Chainlink Price Feeds (onchain oracle)
    │   └── 1inch/Aerodrome DEX Aggregator (swaps)
    └── Letta Memory Service (Git-based context)
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

This project is designed for the Base Builder Quest (deadline: Sep 9, 2026):

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
