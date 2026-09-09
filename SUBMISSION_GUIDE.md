# Base Builder Quest Submission Guide

## Project: Moni - Agentic Trading for Tokenized Stocks on Base via iMessage

### Submission Checklist

- [x] **Project built and functional** - All features implemented and tested
- [x] **Uses Coinbase Tokenized Stocks (B20) on Base** - Direct integration with AAPL, NVDA, MSFT, etc.
- [x] **Innovative iMessage interface** - Native blue-bubble trading experience
- [x] **Agentic capabilities** - Cencori-powered agent with memory, proactive alerts, DCA auto-execution, stop-loss, rebalancing
- [x] **Real trade execution** - 1inch + Para MPC swap path (quote TTL, stale-quote and slippage guards)
- [x] **Live-only mode** - No simulated trades or fabricated data; every balance/price/trade is real on-chain
- [x] **Non-US user compliant** - Quest requirement met

**Deadline reminder:** submissions due **Sep 9, 2026, 11:59pm US Eastern** (≈ **Sep 10, 4:59am WAT**).

---

## Pre-Recording Verification Checklist

Run these **the day you record** — every one is a hard gate. Do not record until all green.

1. **`npm run lint`** — clean (exit 0).
2. **`npm run smoke`** — all green (exit 0). Exercises pure logic deterministically (amount parse/format round-trips, USD formatting, ERC-8021 builder-code attribution suffix, Para identifier namespacing, full B20 registry integrity with Chainlink feeds) and asserts the live-only invariants: with no keys, wallet resolution returns `null` — never a fabricated demo wallet. The conversational flows are verified live via `npm run live`.
3. **Fresh CLI walkthrough** (mirrors the iMessage UX exactly):
   ```
   npm run dev
   ```
   then type in order:
   - `help` → expect the 👋 welcome bubble (exactly once — it must NOT show a "Thinking..." bubble)
   - `What's my portfolio worth?` → holdings + $ value
   - `Buy $50 of TSLA with USDC` → quote with ~TSLA amount
   - `confirm` → "Done. 50 USDC → 50 TSLA. Tx: …"
   - `Show my transaction history` → the TSLA buy listed
   - `exit`
4. **Live rehearsal (the "speaks like a human" gate)** — with a real `CENCORI_API_KEY`:**
   ```
   npm run live
   ```
   It drives a 10-turn scripted conversation (greeting, portfolio, price, risk, buy request, "yeah go ahead", follow-up, DCA, alert, closing) and prints every reply **verbatim as the user would see it** + latency. Eyeball each reply:
   - Not a single raw JSON blob, `{...}`, doubled `\n\n`, or leaked `undefined`/`null`.
   - Replies are short (1–3 short lines, iMessage-sized), use contractions, and end with a next step — not bot-like paragraphs.
   - The trade appears ONLY after the user explicitly approves; the approval trigger reads naturally (`yeah go ahead`).
   - The follow-up "did that go through clean?" references the trade just executed (memory works), no re-explaining.
   - First message is warm; closing says goodbye naturally.
5. **Battery**: run the demo on a real SIM/hardware or the terminal CLI from a separate ssh session so texts genuinely arrive; keep your 1Password and browser login handy for a real `/connect`.

**Voice-tuning knob:** if replies feel stiff, raise Cencori `temperature` in `src/ai.ts` (`runAgentLoop` request) — 0.3 is safe for tool navigation; 0.5–0.6 reads more casual. Never go above ~0.7 for trading accuracy.

---

## Loom Demo Script (3-5 minutes)

### 1. Introduction (30 seconds)
"Hi, I'm [name] and this is Moni - an agentic trading app for Coinbase Tokenized Stocks on Base that lives entirely in iMessage. Just text it, and it trades for you."

Show: iMessage (or demo CLI) conversation with Moni

### 2. Wallet Connection (30 seconds)
- Text `/connect` (or simply ask "connect my wallet")
- Show demo wallet connected instantly via Para MPC wallet
- No seed phrases, no browser extensions
- "This uses Para's MPC wallet infrastructure - wallets are provisioned automatically server-side, transactions are signed via Para REST and broadcast on Base"

### 3. Chat Naturally (45 seconds)
- Ask: "What's my portfolio worth?"
- Ask: "How risky is my portfolio?"
- Show the agent answering conversationally with context-aware analysis
- "No command syntax needed - Moni is a financial expert you can just talk to. It remembers every conversation across sessions."

### 4. Trading (45 seconds)
- Say: "Buy $500 of AAPL with USDC"
- Show quote with price, slippage, and gas estimate
- Say "confirm" - Trade executes via 1inch (real swap on Base)
- "Trades route through 1inch DEX aggregation on Base with fresh-quote + slippage guards so you never execute on a stale price"
- Show `/history` - transaction log

### 5. Proactive Monitoring (45 seconds)
- Show Moni *initiating* the conversation (unsolicited iMessage)
- e.g. "NVDA dropped 4% below your stop-loss - want me to rebalance?" or a daily portfolio digest
- "Moni doesn't wait to be asked. It watches the market 24/7 and texts you when your portfolio needs attention - and can auto-execute DCA strategies within your risk limits"

### 6. Agentic Automation (45 seconds)
- Say: "Set up weekly DCA of $100 USDC into NVDA"
- Show DCA strategy listed and auto-executing at the next interval
- Say: "Alert me if TSLA drops below $200" and "Set a stop-loss on AAPL at 180 with take-profit at 250"
- Rebalancing: "Rebalance me to 40% AAPL, 30% NVDA, 30% MSFT"
- "These run autonomously within user-defined risk parameters"

### 7. Technical Architecture (15 seconds)
- Spectrum-TS for iMessage infrastructure
- Para for MPC wallets
- Cencori (gpt-4o-mini) for the agent - tool calling + persisted memory (`.moni-data`)
- Viem for Base RPC, 1inch for DEX aggregation, Chainlink for price feeds
- B20 tokenized stocks (AAPL, NVDA, MSFT, TSLA, etc.) on Base

### 8. Quest Alignment (15 seconds)
"Built for the Base Builder Quest - uses Coinbase Tokenized Stocks (B20 standard) on Base, demonstrates agentic economy primitives, and makes trading accessible globally via iMessage. Non-US users only, fully compliant."

---

## No-Funding Fallback (record with an empty wallet)

If the wallet is empty (0 USDC / 0 ETH / no B20), execute the swap segment as a **live quote** instead of a broadcast. Moni is live-only, so never fake the trade — show honesty instead. Everything below is $0 and real:

1. **"Hey"** → agent introduces itself.
2. **"Connect my wallet"** → provisions the real Para MPC wallet and shows the real address `0xe54e…423` (no seed phrases).
3. **"What's NVDA at?"** → real Chainlink price with the actual timestamp.
4. **"Quote me buying $50 of AAPL with USDC"** → **real 1inch quote**: amount out, price effect, slippage, gas, TTL. This works with a zero balance and is the strongest shot in the video — a genuine on-chain quote a reviewer can verify.
5. **Narration:** "That's a live quote from the actual market. Moni can't show a fake balance or a fake trade — it waits until you fund the wallet. Execution needs a little USDC plus a few cents of ETH for gas, and then 'confirm' broadcasts the real swap on Base."
6. **"Set a price alert when NVDA drops below 950"** / **"Start a $50 weekly DCA into TSLA"** → automation created; the DCA honestly reports "prepared — will execute once funded" (never simulates).
7. **"What's my portfolio worth?"** → empty-wallet answer stays honest and suggests the funding path.

Showcase the native iMessage UX while you're in there: portfolio/price lookups also render **BaseScan rich-link preview cards** per asset (tap to view token details on-chain), and quote confirmations arrive as **tap-to-answer polls** whose answer flows straight back into the agent (which then executes and narrates the result).

Closing line for the video: "Every number you've seen is real — live prices, live quotes, a live provisioned wallet. Moni is built so it physically cannot fabricate a trade, which is exactly what you want managing money."

---

## Google Form Submission Content

### Project Name
**Moni - Agentic iMessage Trading for Base Tokenized Stocks**

### Project Description
Moni is an agentic trading application that brings Coinbase Tokenized Stocks (B20 standard) on Base to iMessage. Users trade tokenized stocks (AAPL, NVDA, MSFT, GOOGL, META, TSLA, etc.) by simply texting an AI agent - no apps, no command syntax. The agent manages portfolios, runs autonomous strategies (DCA auto-execution, stop-loss/take-profit, rebalancing), sends proactive alerts when the market moves, and answers questions with full conversation memory.

### Key Features
1. **iMessage-Native Trading** - Trade by texting; the agent initiates conversations too; asset links render as rich preview cards and confirmations use tap-to-answer polls
2. **Coinbase Tokenized Stocks (B20)** - 14 tokenized stocks on Base
3. **Conversational Financial Agent** - Cencori-powered (gpt-4o-mini) with tool calling and persistence
4. **Proactive Monitoring** - Unsolicited price/portfolio alerts and daily digest
5. **Automated Strategies** - DCA auto-execution, stop-loss/take-profit, rebalancing, price alerts
6. **Real Trade Execution** - 1inch DEX aggregation + Para MPC wallets, with quote-lifetime and slippage guards
7. **Natural Language Interface** - Just talk; the agent routes to wallet, pricing, swap, analytics, and automation tools

### Technical Stack
- **iMessage**: Spectrum-TS (Photon) for managed iMessage infrastructure
- **Wallets**: Para REST SDK (MPC, no private keys in app)
- **Agent**: Cencori (OpenAI-compatible, gpt-4o-mini) + local JSON memory store (`.moni-data`)
- **Blockchain**: Viem + Base RPC
- **DEX**: 1inch API for swap aggregation
- **Prices**: Chainlink Total Return feeds on Base
- **Ops**: Docker image, health check endpoint, AtlasFlow-ready
- **Tokens**: Coinbase B20 tokenized stocks (AAPL, NVDA, MSFT, GOOGL, META, TSLA, AMZN, COIN, INTC, MSTR, CRCL, SNDK, SPCX, SPX)

### Links
- **GitHub**: https://github.com/tobi-techy/moni
- **Loom Demo**: [your-loom-link]
- **Live Demo**: [if deployed]

### Team
- [Your name/handle]

### Quest Compliance
- ✅ Uses Coinbase Tokenized Stocks on Base (B20 standard)
- ✅ Non-US users only (per Quest eligibility)
- ✅ Demonstrates agentic economy primitives
- ✅ Innovative interface (iMessage)
- ✅ Built within quest timeline

---

## X/Twitter Post Template

Just launched Moni 🚀 - an agentic trading app for @Coinbase Tokenized Stocks on @Base that lives in iMessage!

Text "buy $500 of AAPL" and it trades for you. It watches the market proactively, auto-executes DCA, and protects positions with stop-losses.

Built for @buildonbase Builder Quest! #onchain #AIagents

[Loom link] [GitHub link]

---

## Live Mode Notes for Reviewers

Moni has **no demo mode** — it is live-only:
- Every balance, price, and trade reads from real on-chain data (Chainlink feeds, Base RPC, Para MPC wallets, 1inch aggregation)
- The agent always routes through its live tool set (portfolio, quotes, execution, automation, memory) backed by the real APIs
- No simulated trades or fabricated numbers, ever

To run locally:
```bash
git clone https://github.com/tobi-techy/moni.git
cd moni
npm install
npm run smoke   # Deterministic unit smoke (no keys needed)
npm run dev     # Interactive live CLI (needs .env keys)
```

For production iMessage deployment:
1. Create Photon/Spectrum account at app.photon.codes
2. Configure iMessage lines
3. Add PROJECT_ID, PROJECT_SECRET, PARA_API_KEY, CENCORI_API_KEY, BASE_RPC_URL to .env (all mandatory at startup)
4. Deploy to server (Docker, Railway, Fly.io, or AtlasFlow)
5. Health check: GET /health

---

## Judging Criteria Alignment

| Criteria | How Moni Addresses |
|----------|-------------------|
| **Tokenized Stocks Usage** | Direct B20 integration, 14 stocks, Chainlink feeds |
| **Innovation** | iMessage-native agentic trading with proactive outbound alerts |
| **Agentic Economy** | Cencori agent with memory, autonomous strategies, auto-executing DCA |
| **User Experience** | Native iMessage, no app install, pure natural language |
| **Technical Execution** | TypeScript, real 1inch+Para execution path, testable demo, Docker/AtlasFlow |
| **Quest Compliance** | Non-US only, deadline met |

---

## Contact
- GitHub: [your-github]
- Twitter: [your-twitter]
- Email: [your-email]