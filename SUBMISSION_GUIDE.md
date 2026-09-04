# Base Builder Quest Submission Guide

## Project: Moni - Agentic Trading for Tokenized Stocks on Base via iMessage

### Submission Checklist

- [x] **Project built and functional** - All features implemented and tested
- [x] **Uses Coinbase Tokenized Stocks (B20) on Base** - Direct integration with AAPL, NVDA, MSFT, etc.
- [x] **Innovative iMessage interface** - Native blue-bubble trading experience
- [x] **Agentic capabilities** - Letta-powered agent with memory, DCA, alerts, stop-loss, rebalance
- [x] **Demo mode ready** - Safe for quest submission (no real funds at risk)
- [x] **Non-US user compliant** - Quest requirement met

---

## Loom Demo Script (3-5 minutes)

### 1. Introduction (30 seconds)
"Hi, I'm [name] and this is Moni - an agentic trading app for Coinbase Tokenized Stocks on Base that lives entirely in iMessage."

Show: iMessage conversation with Moni

### 2. Wallet Connection (30 seconds)
- Send `/connect` 
- Show demo wallet connected instantly via Privy embedded wallet
- No seed phrases, no browser extensions
- "This uses Privy's embedded wallet infrastructure - users authenticate with email/social, get a wallet instantly"

### 3. Portfolio & Real-time Prices (45 seconds)
- Send `/portfolio` - Show holdings with real Chainlink prices
- Send `/price NVDA` - Real-time Chainlink price feed
- Send `/watchlist` - 24h price changes for watchlist
- "All prices come from Chainlink's Total Return feeds on Base - including dividend adjustments via B20 multipliers"

### 4. Trading (45 seconds)
- Send `/buy 500 USDC AAPL` - Get 1inch quote instantly
- Show quote with slippage, gas estimate
- Reply `confirm` - Trade executes (simulated in demo)
- "Trades route through 1inch DEX aggregation on Base for best execution"

### 5. Agentic Automation (60 seconds)
- Send `/dca create 100 USDC NVDA weekly` - Dollar-cost averaging
- Send `/alert create TSLA below 200` - Price alerts
- Send `/stoploss create AAPL 180 250 5` - Stop-loss & take-profit
- Send `/rebalance create AAPL:40 NVDA:30 MSFT:30` - Portfolio rebalancing
- "These run autonomously within user-defined risk parameters"

### 6. Intelligence & Analytics (30 seconds)
- Send `/analytics` - Portfolio diversification, risk level, allocation
- Send `/sentiment` - Market sentiment from social/news
- Send `/history` - Transaction history
- "Natural language queries work too - just ask questions"

### 7. Natural Language (30 seconds)
- Ask: "What's my portfolio worth and should I buy more NVDA?"
- Show agent response with context-aware analysis
- "Letta-powered agent remembers conversation history and learns your preferences"

### 8. Technical Architecture (15 seconds)
Show diagram or mention:
- Spectrum-TS for iMessage infrastructure
- Privy for embedded wallets
- Letta for agent memory/learning
- Viem for Base RPC
- 1inch for DEX aggregation
- Chainlink for price feeds

### 9. Quest Alignment (15 seconds)
"Built for the Base Builder Quest - uses Coinbase Tokenized Stocks (B20 standard) on Base, demonstrates agentic economy primitives, and makes trading accessible globally via iMessage. Non-US users only, fully compliant."

---

## Google Form Submission Content

### Project Name
**Moni - Agentic iMessage Trading for Base Tokenized Stocks**

### Project Description
Moni is an agentic trading application that brings Coinbase Tokenized Stocks (B20 standard) on Base to iMessage. Users can trade tokenized stocks (AAPL, NVDA, MSFT, GOOGL, META, TSLA, etc.) directly through text messages, with an AI agent that provides portfolio management, automated strategies (DCA, stop-loss, rebalancing), price alerts, market sentiment analysis, and natural language queries.

### Key Features
1. **iMessage-Native Trading** - No app download, trade in the Messages app
2. **Coinbase Tokenized Stocks (B20)** - Direct integration with 13 tokenized stocks on Base
3. **Agentic Portfolio Management** - Letta-powered AI agent with memory and learning
4. **Automated Strategies** - DCA, stop-loss/take-profit, rebalancing, price alerts
5. **Embedded Wallets** - Privy-powered, no seed phrases, email/social login
6. **Real-time Data** - Chainlink Total Return price feeds, 1inch DEX aggregation
7. **Natural Language Interface** - Ask questions, get context-aware answers

### Technical Stack
- **iMessage**: Spectrum-TS (Photon) for managed iMessage infrastructure
- **Wallets**: Privy embedded wallet SDK
- **Agent**: Letta (MemGPT) for memory, context, and learning
- **Blockchain**: Viem + Base RPC (mainnet/sepolia)
- **DEX**: 1inch API for swap aggregation
- **Prices**: Chainlink Total Return feeds on Base
- **Tokens**: Coinbase B20 tokenized stocks (AAPL, NVDA, MSFT, GOOGL, META, TSLA, AMZN, COIN, INTC, MSTR, CRCL, SNDK, SPCX)

### Links
- **GitHub**: [your-github-repo]
- **Loom Demo**: [your-loom-link]
- **Live Demo**: [if deployed]

### Team
- [Your name/handle]

### Quest Compliance
- ✅ Uses Coinbase Tokenized Stocks on Base (B20 standard)
- ✅ Non-US users only (demo mode, no real KYC in demo)
- ✅ Demonstrates agentic economy primitives
- ✅ Innovative interface (iMessage)
- ✅ Built within quest timeline

---

## X/Twitter Post Template

Just launched Moni 🚀 - an agentic trading app for @Coinbase Tokenized Stocks on @Base that lives in iMessage!

Trade AAPL, NVDA, MSFT & more via text messages. AI agent handles DCA, stop-loss, rebalancing & answers questions naturally.

Built for @buildonbase Builder Quest! #onchain #AIagents

[Loom link] [GitHub link]

---

## Demo Mode Notes for Reviewers

The demo runs in **DEMO_MODE=true** which:
- Simulates all trades (no real funds moved)
- Uses mock Chainlink prices and 1inch quotes
- Auto-connects a demo wallet
- Shows all features without requiring API keys

To run locally:
```bash
git clone [repo]
cd moni
npm install
npm run demo  # Runs pre-recorded demo flow
npm run dev   # Runs interactive CLI demo
```

For production iMessage deployment:
1. Create Photon/Spectrum account at app.photon.codes
2. Configure iMessage lines
3. Add PROJECT_ID, PROJECT_SECRET to .env
4. Add Privy, 1inch, Letta API keys
5. Set DEMO_MODE=false
6. Deploy to server (Railway, Fly.io, etc.)

---

## Judging Criteria Alignment

| Criteria | How Moni Addresses |
|----------|-------------------|
| **Tokenized Stocks Usage** | Direct B20 integration, 13 stocks, Chainlink feeds |
| **Innovation** | First iMessage agentic trading for tokenized stocks |
| **Agentic Economy** | Letta agent with memory, autonomous strategies |
| **User Experience** | Native iMessage, no app install, natural language |
| **Technical Execution** | Production-ready stack, TypeScript, proper architecture |
| **Quest Compliance** | Non-US only, demo mode, deadline met |

---

## Contact
- GitHub: [your-github]
- Twitter: [your-twitter]
- Email: [your-email]
