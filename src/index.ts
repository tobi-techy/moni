import { createServer, IncomingMessage, ServerResponse } from 'http';
import { Spectrum } from 'spectrum-ts';
import { imessage, terminal } from 'spectrum-ts/providers';
import { typing, markdown, richlink, poll, option } from 'spectrum-ts';
import { sanitizeOutgoingText, sanitizeSpace } from './text.js';
import { extractBasescanTokenUrls, stripBasescanTokenUrls, pollChoiceToToken } from './rich.js';
import { PROJECT_ID, PROJECT_SECRET, validateEnv, SPECTRUM_WEBHOOK_SECRET, WEBHOOK_PORT } from './env.js';
import { BASE_RPC_URL } from './env.js';
import { startProactiveMonitoring } from './proactive.js';
import { getUserWalletAddress, resolveParaUser } from './wallet.js';
import { startHealthServer } from './health.js';
import { type Address } from 'viem';
import { getPortfolio, getTokenPrice, getB20ExplorerLink, formatBalance, formatUSD, B20TokenSymbol, B20_TOKENS } from './base.js';
import { B20_DECIMALS } from './constants.js';
import { getSwapQuote, getSwapTransaction, parseAmount, formatAmount } from './swap.js';
import { sendAgentMessage, getTradingMemory, setTradingMemory, isFirstContact, getAIConfig, TradingMemory } from './ai.js';
import { analyzePortfolio, formatAnalytics, getPriceChanges } from './analytics.js';
import { getTransactionHistory, formatTransactionHistory, addTransaction, Transaction } from './history.js';
import { handleStopLoss, handleRebalance, handleSentiment, checkStopLosses } from './automation.js';

// Markdown builder that strips em-dashes before the text is captured in the
// builder closure (spectrum's markdown() bakes the string in at build time).
const md = (s: string) => markdown(sanitizeOutgoingText(s));

// Structured logging
const log = {
  info: (msg: string, meta?: Record<string, any>) => console.log(JSON.stringify({ level: 'info', msg, ...meta, timestamp: new Date().toISOString() })),
  warn: (msg: string, meta?: Record<string, any>) => console.warn(JSON.stringify({ level: 'warn', msg, ...meta, timestamp: new Date().toISOString() })),
  error: (msg: string, meta?: Record<string, any>) => console.error(JSON.stringify({ level: 'error', msg, ...meta, timestamp: new Date().toISOString() })),
};

// ─── Rich iMessage sends (Spectrum content builders) ────────────────────────
// Real Spectrum spaces accept ContentBuilder values (markdown, app cards,
// typing indicators). The CLI mock only prints strings, so it's tagged
// with `_moniCli` and rich sends degrade to their plain-text fallback.

function isCliSpace(space: any): boolean {
  return !!(space && (space as any)._moniCli);
}

async function showTyping(space: any): Promise<void> {
  if (isCliSpace(space)) return;
  try {
    await space.send(typing());
  } catch {
    /* best effort */
  }
}

async function hideTyping(space: any): Promise<void> {
  if (isCliSpace(space)) return;
  try {
    await space.send(typing('stop'));
  } catch {
    /* best effort */
  }
}

async function sendRich(space: any, builder: any, plain?: string): Promise<void> {
  if (isCliSpace(space)) {
    await space.send(plain ?? '');
    return;
  }
  await space.send(builder);
}

// Basescan token URLs (B20 explorer) become platform-native rich-link every
// time they leave the bot, so an asset's details render as a clean image
// preview instead of a raw URL bubble. CLI/plain spaces keep the original
// text untouched (the bare URL is the degraded presentation).
async function sendWithRichLinks(space: any, text: string): Promise<void> {
  if (isCliSpace(space)) {
    await space.send(text);
    return;
  }
  const urls = extractBasescanTokenUrls(text);
  if (urls.length === 0) {
    await space.send(text);
    return;
  }
  const cleaned = stripBasescanTokenUrls(text);
  if (cleaned) await space.send(cleaned);
  for (const url of urls) {
    await space.send(richlink(url));
  }
}

// A tap-to-answer confirmation poll. Plain spaces fall back to the text
// instruction; the inbound poll_option handler routes the answer back through
// handleMessage, so the agent replies in both cases.
async function sendConfirmationPoll(space: any, question: string): Promise<void> {
  const plain = `Reply "confirm" to execute or "cancel" to abort.`;
  try {
    if (isCliSpace(space)) {
      await space.send(plain);
      return;
    }
    await space.send(poll(question, option('Confirm'), option('Cancel')));
  } catch {
    // Best-effort: if the poll can't be sent the text instruction still
    // exists in the quote message the user already saw. No crash.
  }
}

// Best-effort phone number for a chat (kept for future on-ramp/identity use).
function getPhoneFromSpace(space: any): string | undefined {
  const address = space?.user?.address;
  if (typeof address === 'string' && (address.startsWith('+') || /^\d{7,15}$/.test(address))) {
    return address;
  }
  const id = space?.user?.id ?? space?.id;
  if (typeof id === 'string' && id.startsWith('+')) {
    return id;
  }
  return undefined;
}

// Start health check server for AtlasFlow/container orchestration
await startHealthServer();

// Validate environment on startup. All credentials are required — Moni is
// live-only. RPC is locked to Base mainnet because the tokenized stocks Moni
// trades only exist there (a testnet RPC is fatal).
const envValidation = validateEnv();
if (!envValidation.valid) {
  log.error('Environment validation failed', {
    missing: envValidation.missing,
    errors: envValidation.errors,
  });
  process.exit(1);
}

// User session storage (in production, use Redis or database)
interface UserSession {
  userId: string;
  walletAddress: Address | null;
  authenticated: boolean;
  state: 'idle' | 'awaiting_amount' | 'awaiting_confirmation' | 'awaiting_token' | 'awaiting_wallet';
  pendingTrade?: {
    type: 'buy' | 'sell';
    fromToken: string;
    toToken: string;
    amount: string;
  };
  tradingMemory: TradingMemory;
  lastActive: number;
  space?: any;
  /** Timestamp of the last wallet-resolution attempt (rate-limit guard; retries allowed after a cooldown). */
  lastResolutionAttempt?: number;
}

const userSessions = new Map<string, UserSession>();

// Get or create user session
function getSession(userId: string, space?: any): UserSession {
  let session = userSessions.get(userId);
  if (!session) {
    session = {
      userId,
      walletAddress: null,
      authenticated: false,
      state: 'idle',
      tradingMemory: {
        watchlist: ['AAPL', 'NVDA', 'MSFT'],
        riskParams: {
          maxPositionSizeUSD: 10000,
          maxDailyLossUSD: 1000,
          autoTradeEnabled: false,
        },
        activeStrategies: [],
        preferences: {
          defaultSlippage: 1.0,
          preferredTokens: ['AAPL', 'NVDA', 'MSFT'],
          notificationLevel: 'trades',
        },
      },
      lastActive: Date.now(),
      space: space || null,
    };
    userSessions.set(userId, session);
  }
  session.lastActive = Date.now();
  if (space) {
    session.space = space;
  }
  return session;
}

// Send a proactive message to a user via their stored Spectrum space
async function sendProactiveMessage(userId: string, message: string): Promise<void> {
  const session = userSessions.get(userId);
  if (!session?.space) {
    log.warn('Cannot send proactive message — no space for user', { userId });
    return;
  }
  try {
    // Belt-and-braces: the stored space is normally already sanitizeSpace-wrapped,
    // but sanitize here too so proactive text is clean regardless of how the
    // space was stored. Basescan links still become rich cards.
    await sendWithRichLinks(session.space, sanitizeOutgoingText(message));
  } catch (error) {
    log.error('Failed to send proactive message', { userId, error: (error as Error).message });
  }
}

// Periodic cleanup of stale sessions (keep sessions with spaces for proactive messaging)
const SESSION_TTL = 5 * 60 * 1000;
const CLEANUP_INTERVAL = 5 * 60 * 1000;

function startSessionCleanup(): NodeJS.Timeout {
  return setInterval(() => {
    const now = Date.now();
    let cleaned = 0;
    for (const [userId, session] of userSessions.entries()) {
      // Don't clean up sessions that have a space (needed for proactive messages)
      if (session.space && now - session.lastActive > SESSION_TTL * 6) {
        // Keep space sessions 6x longer (30 min) so proactive monitoring can reach them
        session.space = null;
        userSessions.delete(userId);
        cleaned++;
      } else if (!session.space && now - session.lastActive > SESSION_TTL) {
        userSessions.delete(userId);
        cleaned++;
      }
    }
    if (cleaned > 0) {
      log.info('Cleaned up stale sessions', { count: cleaned, remaining: userSessions.size });
    }
  }, CLEANUP_INTERVAL);
}

// Initialize wallet for user
async function initializeWallet(userId: string, phone?: string): Promise<Address | null> {
  const session = getSession(userId);
  
  if (session.walletAddress) {
    return session.walletAddress;
  }

  const walletAddress = await getUserWalletAddress(userId, { phone });
  if (walletAddress) {
    session.walletAddress = walletAddress;
    session.authenticated = true;
  }
  
  return walletAddress;
}

// Format portfolio for iMessage display
function formatPortfolioMessage(portfolio: Awaited<ReturnType<typeof getPortfolio>>): string {
  if (portfolio.length === 0) {
    return '📭 Your portfolio is empty. Start trading tokenized stocks!';
  }

  let totalValue = 0n;
  let message = '📊 **Your Portfolio**\n\n';

  for (const holding of portfolio) {
    const scaledFormatted = formatBalance(holding.scaledBalance, B20_DECIMALS);
    const valueFormatted = formatUSD(holding.valueUSD);
    totalValue += holding.valueUSD;
    
    message += `**${holding.symbol}** (${holding.name})\n`;
    message += `  💎 ${scaledFormatted} shares\n`;
    message += `  💰 ${valueFormatted}\n`;
    message += `  👀 ${holding.link}\n\n`;
  }

  message += `**Total Value: ${formatUSD(totalValue)}**`;
  return message;
}

// Format price message
function formatPriceMessage(symbol: B20TokenSymbol, priceData: Awaited<ReturnType<typeof getTokenPrice>>): string {
  if (!priceData) {
    return `❌ Could not fetch price for ${symbol}`;
  }

  const price = Number(priceData.price) / 10 ** priceData.decimals;
  const updated = new Date(Number(priceData.updatedAt) * 1000).toLocaleTimeString();
  
  return `💹 **${symbol} Price**: $${price.toFixed(2)}\n_Updated: ${updated}_\n👀 ${getB20ExplorerLink(symbol)}`;
}

// Handle portfolio command
async function handlePortfolio(space: any, userId: string, phone?: string) {
  const walletAddress = await initializeWallet(userId, phone);
  
  if (!walletAddress) {
    await space.send('🔐 Please connect your wallet first. Send "/connect" to get started.');
    return;
  }

  try {
    const portfolio = await getPortfolio(walletAddress);
    const message = formatPortfolioMessage(portfolio);
    await sendWithRichLinks(space, message);
  } catch (error) {
    console.error('Portfolio error:', error);
    await space.send('❌ Error fetching portfolio. Please try again.');
  }}

// Handle price command
async function handlePrice(space: any, symbol: string) {
  const upperSymbol = symbol.toUpperCase() as B20TokenSymbol;
  
  if (!B20_TOKENS[upperSymbol]) {
    await space.send(`❌ Unknown token: ${symbol}. Available: ${Object.keys(B20_TOKENS).join(', ')}`);
    return;
  }

  try {
    const priceData = await getTokenPrice(upperSymbol);
    const message = formatPriceMessage(upperSymbol, priceData);
    await sendWithRichLinks(space, message);
  } catch (error) {
    console.error('Price error:', error);
    await space.send('❌ Error fetching price.');
  }
}

// Handle buy command
async function handleBuy(space: any, userId: string, args: string[], phone?: string) {
  const session = getSession(userId);
  const walletAddress = await initializeWallet(userId, phone);
  
  if (!walletAddress) {
    await space.send('🔐 Please connect your wallet first. Send "/connect" to get started.');
    return;
  }

  // Parse: /buy <amount> <token> [with <token>]
  // e.g., "/buy 100 USDC AAPL" or "/buy 100 AAPL"
  if (args.length < 2) {
    await space.send('Usage: `/buy <amount> <token> [with <token>]`\nExample: `/buy 100 USDC AAPL` or `/buy 0.5 AAPL`');
    return;
  }

  const amount = args[0];
  let fromToken = 'USDC'; // default
  let toToken = args[1].toUpperCase();

  // Check if "with" keyword used
  if (args.includes('with') || args.includes('for')) {
    const withIndex = args.indexOf('with') !== -1 ? args.indexOf('with') : args.indexOf('for');
    if (withIndex > 0 && withIndex < args.length - 1) {
      fromToken = args[withIndex + 1].toUpperCase();
      toToken = args[0].toUpperCase(); // first arg is the target token
    }
  }

  // Validate tokens
  const fromTokenAddress = toToken === 'USDC' ? '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' : B20_TOKENS[fromToken as B20TokenSymbol];
  const toTokenAddress = B20_TOKENS[toToken as B20TokenSymbol];

  if (!toTokenAddress) {
    await space.send(`❌ Unknown token: ${toToken}. Available: ${Object.keys(B20_TOKENS).join(', ')}`);
    return;
  }

  // Get quote
  const quote = await getSwapQuote(fromTokenAddress, toTokenAddress, parseAmount(amount, 6).toString());
  
  if (!quote) {
    await space.send(
      `❌ **Quote unavailable.** This pair can't be routed on-chain right now — ` +
      `COIN/INTC/CRCL aren't listed on 1inch. Check prices or your portfolio meanwhile.`
    );
    return;
  }

  const toAmount = formatAmount(BigInt(quote.toAmount), B20_DECIMALS);
  
  // Store pending trade
  session.state = 'awaiting_confirmation';
  session.pendingTrade = {
    type: 'buy',
    fromToken: fromTokenAddress,
    toToken: toTokenAddress,
    amount: parseAmount(amount, 6).toString(),
  };

  await space.send(
    `✅ **Quote Ready**\n\n` +
    `📥 You send: ${amount} ${fromToken}\n` +
    `📤 You receive: ~${toAmount} ${toToken}\n` +
    `⛽ Est. gas: ${quote.estimatedGas}`
  );
  await sendConfirmationPoll(space, `Execute this ${fromToken} → ${toToken} swap?`);
}

// Handle sell command
async function handleSell(space: any, userId: string, args: string[], phone?: string) {
  const session = getSession(userId);
  const walletAddress = await initializeWallet(userId, phone);
  
  if (!walletAddress) {
    await space.send('🔐 Please connect your wallet first. Send "/connect" to get started.');
    return;
  }

  if (args.length < 2) {
    await space.send('Usage: `/sell <amount> <token> [for <token>]`\nExample: `/sell 10 AAPL USDC`');
    return;
  }

  const amount = args[0];
  const fromToken = args[1].toUpperCase();
  let toToken = 'USDC';

  if (args.includes('for')) {
    const forIndex = args.indexOf('for');
    if (forIndex < args.length - 1) {
      toToken = args[forIndex + 1].toUpperCase();
    }
  }

  const fromTokenAddress = B20_TOKENS[fromToken as B20TokenSymbol];
  const toTokenAddress = toToken === 'USDC' ? '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' : B20_TOKENS[toToken as B20TokenSymbol];

  if (!fromTokenAddress) {
    await space.send(`❌ Unknown token: ${fromToken}. Available: ${Object.keys(B20_TOKENS).join(', ')}`);
    return;
  }

  // Check balance first
  const portfolio = await getPortfolio(walletAddress);
  const holding = portfolio.find((h: { symbol: string }) => h.symbol === fromToken);
  
  if (!holding || holding.scaledBalance < parseAmount(amount, B20_DECIMALS)) {
    await space.send(`❌ Insufficient ${fromToken} balance. You have ${formatBalance(holding?.scaledBalance || 0n, B20_DECIMALS)}`);
    return;
  }

  const quote = await getSwapQuote(fromTokenAddress, toTokenAddress, parseAmount(amount, B20_DECIMALS).toString());  
  if (!quote) {
    await space.send(
      `❌ **Quote unavailable.** This pair can't be routed on-chain right now — ` +
      `COIN/INTC/CRCL aren't listed on 1inch. Check prices or your portfolio meanwhile.`
    );
    return;
  }

  const toAmount = formatAmount(BigInt(quote.toAmount), toToken === 'USDC' ? 6 : B20_DECIMALS);
  
  session.state = 'awaiting_confirmation';
  session.pendingTrade = {
    type: 'sell',
    fromToken: fromTokenAddress,
    toToken: toTokenAddress,
    amount: parseAmount(amount, B20_DECIMALS).toString(),
  };

  await space.send(
    `✅ **Quote Ready**\n\n` +
    `📥 You send: ${amount} ${fromToken}\n` +
    `📤 You receive: ~${toAmount} ${toToken}\n` +
    `⛽ Est. gas: ${quote.estimatedGas}`
  );
  await sendConfirmationPoll(space, `Execute this ${fromToken} → ${toToken} swap?`);
}

// Handle confirm
async function handleConfirm(space: any, userId: string) {
  const session = getSession(userId);
  
  if (session.state !== 'awaiting_confirmation' || !session.pendingTrade) {
    // Agent-created pending quote — let the agent resolve it
    await handleNaturalLanguage(space, userId, 'confirm');
    return;
  }

  // Real mode: execute through the Para-backed wallet (REST signing + broadcast).
  const { execute_trade } = await import('./agent-tools.js');
  const memory = await getTradingMemory(userId);
  let pendingQuote = (memory as any).pendingQuote;
  if (!pendingQuote?.id && session.pendingTrade) {
    // Slash-command flow (/buy then /confirm) has no LLM quote yet — build a
    // minimal quote so execute_trade refreshes and executes the real swap.
    const { fromToken, toToken, amount } = session.pendingTrade;
    const now = Date.now();
    pendingQuote = {
      id: `slash-${now}`,
      fromToken,
      toToken,
      fromTokenSymbol: Object.entries(B20_TOKENS).find(([_, v]) => v === fromToken)?.[0] || 'USDC',
      toTokenSymbol: Object.entries(B20_TOKENS).find(([_, v]) => v === toToken)?.[0] || 'USDC',
      fromAmount: amount,
      toAmount: '0',
      slippage: 1.0,
      createdAt: now,
      expiresAt: now + 30_000,
    };
    (memory as any).pendingQuote = pendingQuote;
    await setTradingMemory(userId, memory as any);
  }
  if (!pendingQuote?.id) {
    await space.send('❌ No pending quote to confirm. Ask me for a fresh quote first.');
    return;
  }
  await space.send('⏳ **Executing your trade on Base...**');
  const res = await execute_trade(userId, pendingQuote.id);
  if (res.success) {
    const tx = res.data?.transaction;
    const msg = res.data?.message || `✅ Trade executed — Tx: ${tx?.txHash ?? 'n/a'}`;
    await space.send(`✅ **Trade Executed**\n\n${msg}`);
  } else {
    await space.send(`❌ **Trade failed**\n\n${res.error}`);
  }

  session.state = 'idle';
  session.pendingTrade = undefined;
}

// Handle cancel
async function handleCancel(space: any, userId: string) {
  const session = getSession(userId);
  
  if (session.state !== 'awaiting_confirmation') {
    // Agent-created pending quote — let the agent clear it
    await handleNaturalLanguage(space, userId, 'cancel');
    return;
  }

  session.state = 'idle';
  session.pendingTrade = undefined;
  
  await space.send('❌ Trade cancelled.');
}

// Handle watchlist
async function handleWatchlist(space: any, userId: string, args: string[]) {
  const memory = await getTradingMemory(userId);
  
  if (args[0] === 'add' && args[1]) {
    const symbol = args[1].toUpperCase();
    if (B20_TOKENS[symbol as B20TokenSymbol]) {
      if (!memory.watchlist.includes(symbol)) {
        memory.watchlist.push(symbol);
        await setTradingMemory(userId, { watchlist: memory.watchlist });
        await space.send(`✅ Added ${symbol} to watchlist.`);
      } else {
        await space.send(`${symbol} is already in your watchlist.`);
      }
    } else {
      await space.send(`❌ Unknown token: ${symbol}`);
    }
  } else if (args[0] === 'remove' && args[1]) {
    const symbol = args[1].toUpperCase();
    memory.watchlist = memory.watchlist.filter((s: string) => s !== symbol);
    await setTradingMemory(userId, { watchlist: memory.watchlist });
    await space.send(`✅ Removed ${symbol} from watchlist.`);
  } else {
    // Show watchlist with prices
    const prices = await Promise.all(
      memory.watchlist.map(async (symbol: string) => {
        const priceData = await getTokenPrice(symbol as B20TokenSymbol);
        if (priceData) {
          const price = Number(priceData.price) / 10 ** priceData.decimals;
          return `• **${symbol}**: $${price.toFixed(2)}`;
        }
        return `• **${symbol}**: Price unavailable`;
      })
    );
    
    await space.send(`📋 **Your Watchlist**\n\n${prices.join('\n')}`);
  }
}

// Handle DCA (Dollar Cost Averaging)
async function handleDCA(space: any, userId: string, args: string[]) {
  const memory = await getTradingMemory(userId);
  
  if (args[0] === 'create' && args.length >= 4) {
    // /dca create <amount> <token> <frequency>
    // e.g., "/dca create 50 USDC AAPL weekly"
    const amount = args[1];
    const token = args[2].toUpperCase();
    const frequency = args[3].toLowerCase();
    
    if (!B20_TOKENS[token as B20TokenSymbol]) {
      await space.send(`❌ Unknown token: ${token}`);
      return;
    }

    const strategy = {
      type: 'dca' as const,
      params: { amount, token, frequency },
      active: true,
    };
    
    memory.activeStrategies.push(strategy);
    await setTradingMemory(userId, { activeStrategies: memory.activeStrategies });
    
    await space.send(
      `✅ **DCA Strategy Created**\n\n` +
      `💰 Amount: ${amount} USDC\n` +
      `📈 Token: ${token}\n` +
      `🔄 Frequency: ${frequency}\n` +
      `🟢 Status: Active`
    );
  } else if (args[0] === 'list') {
    const dcaStrategies = memory.activeStrategies.filter((s: { type: string }) => s.type === 'dca');
    
    if (dcaStrategies.length === 0) {
      await space.send('📭 No active DCA strategies. Create one with `/dca create <amount> <token> <frequency>`');
      return;
    }
    
    let message = '🔄 **Active DCA Strategies**\n\n';
    dcaStrategies.forEach((s: { params: { amount: string; token: string; frequency: string }; active: boolean }, i: number) => {
      message += `${i + 1}. ${s.params.amount} USDC → ${s.params.token} (${s.params.frequency}) - ${s.active ? '🟢 Active' : '🔴 Paused'}\n`;
    });
    
    await space.send(message);
  } else if (args[0] === 'pause' && args[1]) {
    const index = parseInt(args[1]) - 1;
    const dcaStrategies = memory.activeStrategies.filter((s: { type: string }) => s.type === 'dca');
    
    if (dcaStrategies[index]) {
      dcaStrategies[index].active = false;
      await setTradingMemory(userId, { activeStrategies: memory.activeStrategies });
      await space.send('⏸️ DCA strategy paused.');
    } else {
      await space.send('❌ Invalid strategy number.');
    }
  } else {
    await space.send(
      `🔄 **DCA Commands**\n\n` +
      `• \`/dca create <amount> <token> <frequency>\` - Create DCA\n` +
      `  Example: \`/dca create 50 USDC AAPL weekly\`\n` +
      `• \`/dca list\` - List active strategies\n` +
      `• \`/dca pause <number>\` - Pause a strategy`
    );
  }
}

// Handle alerts
async function handleAlert(space: any, userId: string, args: string[]) {
  if (args[0] === 'create' && args.length >= 3) {
    // /alert create <token> <above|below> <price>
    const token = args[1].toUpperCase();
    const direction = args[2].toLowerCase();
    const price = parseFloat(args[3]);
    
    if (!B20_TOKENS[token as B20TokenSymbol]) {
      await space.send(`❌ Unknown token: ${token}`);
      return;
    }
    
    if (!['above', 'below'].includes(direction)) {
      await space.send('❌ Direction must be "above" or "below"');
      return;
    }
    
    // Store alert (in production, use a proper alert system)
    const memory = await getTradingMemory(userId);
    const alert = {
      type: 'price_alert' as const,
      params: { token, direction, price },
      active: true,
    };
    
    // Type assertion to allow price_alert in activeStrategies
    (memory.activeStrategies as any[]).push(alert);
    await setTradingMemory(userId, { activeStrategies: memory.activeStrategies });
    
    await space.send(
      `🔔 **Price Alert Created**\n\n` +
      `📈 Token: ${token}\n` +
      `📊 Trigger: Price goes ${direction} $${price.toFixed(2)}\n` +
      `🟢 Status: Active`
    );
  } else if (args[0] === 'list') {
    const alerts = (await getTradingMemory(userId)).activeStrategies.filter((s: any) => s.type === 'price_alert');
    
    if (alerts.length === 0) {
      await space.send('📭 No active alerts. Create one with `/alert create <token> <above|below> <price>`');
      return;
    }
    
    let message = '🔔 **Active Alerts**\n\n';
    alerts.forEach((a: any, i: number) => {
      message += `${i + 1}. ${a.params.token} ${a.params.direction} $${a.params.price.toFixed(2)} - ${a.active ? '🟢' : '🔴'}\n`;
    });
    
    await space.send(message);
  } else {
    await space.send(
      `🔔 **Alert Commands**\n\n` +
      `• \`/alert create <token> <above|below> <price>\` - Create price alert\n` +
      `  Example: \`/alert create AAPL above 200\`\n` +
      `• \`/alert list\` - List active alerts`
    );
  }
}

// Handle analytics
async function handleAnalytics(space: any, userId: string, args: string[]) {
  if (args[0] === 'changes' || args[0] === 'price' || args[0] === '24h') {
    const message = await getPriceChanges(userId);
    await space.send(message);
    return;
  }
  
  // Default: full portfolio analytics
  const analytics = await analyzePortfolio(userId);
  const message = formatAnalytics(analytics);
  await space.send(message);
}

// Handle history
async function handleHistory(space: any, userId: string, args: string[]) {
  const limit = args[0] ? parseInt(args[0]) : 20;
  const txs = await getTransactionHistory(userId, limit);
  const message = formatTransactionHistory(txs);
  await space.send(message);
}

// Handle help
async function handleHelp(space: any) {
  await space.send(
    `🤖 **Moni - Your iMessage Trading Agent**\n\n` +
    `**Just chat naturally** — e.g. "What's my portfolio worth?", "Buy $500 of AAPL", "How risky am I?", "Set a stop-loss on NVDA at $800". The agent handles it.\n\n` +
    `**Portfolio & Prices**\n` +
    `• \`/portfolio\` - View your holdings\n` +
    `• \`/price <token>\` - Check token price\n` +
    `• \`/watchlist\` - View watchlist prices\n` +
    `• \`/analytics\` - Portfolio analytics & diversification\n` +
    `• \`/history\` - Transaction history\n\n` +
    `**Trading**\n` +
    `• \`/buy <amount> <token> [with <token>]\` - Buy tokens\n` +
    `  Example: \`/buy 100 USDC AAPL\`\n` +
    `• \`/sell <amount> <token> [for <token>]\` - Sell tokens\n` +
    `• \`/confirm\` / \`/cancel\` - Confirm or cancel pending trade\n\n` +
    `**Automation**\n` +
    `• \`/dca create <amount> <token> <frequency>\` - Dollar cost average\n` +
    `• \`/alert create <token> <above|below> <price>\` - Price alerts\n` +
    `• \`/stoploss create <token> <stop> <target> <amount>\` - Stop-loss/Take-profit\n` +
    `• \`/rebalance create <sym:pct> ...\` - Portfolio rebalancing\n` +
    `• \`/sentiment\` - Market sentiment for watchlist\n\n` +
    `**Wallet**\n` +
    `• \`/connect\` - Connect your wallet\n` +
    `• \`/wallet\` - Show wallet address\n`
  );
}

// Handle connect
async function handleConnect(space: any, userId: string, phone?: string) {
  const session = getSession(userId);

  if (session.authenticated && session.walletAddress) {
    await showTyping(space);
    await sendRich(
      space,
      md(
        `**Wallet Connected**\n\n` +
        `Address: \`${session.walletAddress.slice(0, 6)}...${session.walletAddress.slice(-4)}\`\n\n` +
        `You're all set — want to see your portfolio or check a price?`
      ),
      `✅ Wallet Connected — Address: ${session.walletAddress.slice(0, 6)}...${session.walletAddress.slice(-4)}\n\nYou're all set — want to see your portfolio or check a price?`
    );
    await hideTyping(space);
    return;
  }

  // Real mode: the agent provisions the user's Para EVM wallet automatically
  // (REST wallet, works on Base for every country — no signup needed). The
  // resolve below finds or creates the wallet for this chat.
  try {
    const record = await resolveParaUser(userId);
    if (record?.walletAddress) {
      session.walletAddress = record.walletAddress;
      session.authenticated = true;
      await sendRich(
        space,
        md(
          `**Wallet Connected**\n\n` +
          `Address: \`${record.walletAddress.slice(0, 6)}...${record.walletAddress.slice(-4)}\`\n\n` +
          `Your on-chain wallet was created for you and your profile is linked — all set to trade.`
        ),
        `✅ Wallet Connected — Address: ${record.walletAddress.slice(0, 6)}...${record.walletAddress.slice(-4)}`
      );
      return;
    }
  } catch (error) {
    log.warn('Para resolve failed during connect', { userId, error: (error as Error).message });
  }

  // Provisioning failed (e.g., Para API key missing) — surface it so the
  // setup doesn't silently stall.
  await showTyping(space);
  await sendRich(
    space,
    md(
      `**Wallet setup needs attention**\n\n` +
      `I couldn't create your on-chain wallet just now — it's handled automatically server-side, so nothing for you to do. My devs should check the Para credentials, then try /connect again.`
    ),
    `❌ Couldn't create your wallet — check Para credentials, then send /connect again.`
  );
  await hideTyping(space);
}

// Natural language handling via the Moni agent
async function handleNaturalLanguage(space: any, userId: string, message: string, phone?: string) {
  const session = getSession(userId);
  const firstContact = await isFirstContact(userId);
  let walletConnected = !!(session.authenticated && session.walletAddress);

  // Provision the user's Para EVM wallet automatically on first contact (REST
  // wallet, country-agnostic — no signup needed). Resolution is cached and
  // persisted after the first success. Failed attempts retry after a short
  // cooldown so transient Para hiccups self-heal without hammering the API.
  const RESOLUTION_RETRY_MS = 60_000;
  const canAttemptResolution =
    !walletConnected &&
    (!session.lastResolutionAttempt || Date.now() - session.lastResolutionAttempt > RESOLUTION_RETRY_MS);

  if (canAttemptResolution) {
    session.lastResolutionAttempt = Date.now();
    try {
      const record = await resolveParaUser(userId);
      if (record?.walletAddress) {
        session.walletAddress = record.walletAddress;
        session.authenticated = true;
        walletConnected = true;
      }
    } catch (error) {
      log.warn('Para resolve failed during dialogue', { userId, error: (error as Error).message });
    }
  }

  await showTyping(space);

  // Remember any quote that predates this turn so we can tell whether the
  // agent produced a *new* quote (which gets a tap-to-answer poll).
  const priorQuoteId = ((await getTradingMemory(userId)) as any).pendingQuote?.id;

  // Single intro: the agent writes the welcome itself on first contact (the
  // context block flags it), so no hardcoded greeting is sent here. Sending
  // both was what produced the duplicate intro bubbles.
  try {
    const response = await sendAgentMessage(userId, message, {
      walletConnected,
      isFirstContact: firstContact,
    });
    await sendWithRichLinks(space, response);
    await hideTyping(space);

    // If this turn produced a fresh quote, attach a tap-to-answer poll so a
    // confirm/cancel routes straight back into the agent loop as text.
    const pendingQuote = ((await getTradingMemory(userId)) as any).pendingQuote;
    if (pendingQuote?.id && pendingQuote.id !== priorQuoteId) {
      await sendConfirmationPoll(
        space,
        `Execute this ${pendingQuote.fromTokenSymbol ?? ''} → ${pendingQuote.toTokenSymbol ?? ''} swap?`
      );
    }
  } catch (error) {
    console.error('Agent error:', error);
    await space.send("Sorry, I hit a snag there. Mind trying that again?");
    await hideTyping(space);
  }
}

// Normalize any inbound content (text or poll_option) into a chat message.
// A tapped poll answer maps Confirm/Cancel onto the existing confirmation flow
// and routes everything else to the agent as natural language, so the agent
// responds back in both cases.
async function handleInbound(space: any, message: any, userId: string): Promise<void> {
  const content = message?.content;
  if (content?.type === 'text' && content.text) {
    await handleMessage(space, userId, content.text);
    return;
  }
  if (content?.type === 'poll_option' && content.selected !== false) {
    const choice = content.option?.title ?? content.title ?? '';
    await handleMessage(space, userId, pollChoiceToToken(choice) ?? choice);
    return;
  }
}

// Main message handler
async function handleMessage(space: any, userId: string, text: string) {
  // Wrap the space so every outgoing message (agent replies, static strings,
  // proactive sends) has em-dashes stripped deterministically at the send
  // chokepoint. Idempotent: wrapping an already-wrapped space is a no-op.
  space = sanitizeSpace(space);
  const session = getSession(userId, space);
  const trimmed = text.trim();
  const lower = trimmed.toLowerCase();
  const phone = getPhoneFromSpace(space);
  console.log('📩 Message received:', JSON.stringify({ userId, text: trimmed }));

  // Handle commands
  if (lower.startsWith('/portfolio') || lower.startsWith('/holdings') || lower.startsWith('/balance')) {
    await handlePortfolio(space, userId, phone);
    return;
  }
  
  if (lower.startsWith('/price ')) {
    const symbol = trimmed.split(' ')[1];
    await handlePrice(space, symbol);
    return;
  }
  
  if (lower.startsWith('/buy ')) {
    const args = trimmed.split(' ').slice(1);
    await handleBuy(space, userId, args, phone);
    return;
  }
  
  if (lower.startsWith('/sell ')) {
    const args = trimmed.split(' ').slice(1);
    await handleSell(space, userId, args, phone);
    return;
  }
  
  if (lower === '/confirm' || lower === 'confirm') {
    await handleConfirm(space, userId);
    return;
  }
  
  if (lower === '/cancel' || lower === 'cancel') {
    await handleCancel(space, userId);
    return;
  }
  
  if (lower.startsWith('/watchlist')) {
    const args = trimmed.split(' ').slice(1);
    await handleWatchlist(space, userId, args);
    return;
  }
  
  if (lower.startsWith('/dca')) {
    const args = trimmed.split(' ').slice(1);
    await handleDCA(space, userId, args);
    return;
  }
  
  if (lower.startsWith('/alert')) {
    const args = trimmed.split(' ').slice(1);
    await handleAlert(space, userId, args);
    return;
  }
  
  if (lower.startsWith('/analytics') || lower.startsWith('/analyze')) {
    const args = trimmed.split(' ').slice(1);
    await handleAnalytics(space, userId, args);
    return;
  }
  
  if (lower.startsWith('/history') || lower.startsWith('/txs') || lower.startsWith('/transactions')) {
    const args = trimmed.split(' ').slice(1);
    await handleHistory(space, userId, args);
    return;
  }
  
  if (lower.startsWith('/stoploss') || lower.startsWith('/sl')) {
    const args = trimmed.split(' ').slice(1);
    await handleStopLoss(space, userId, args);
    return;
  }
  
  if (lower.startsWith('/rebalance') || lower.startsWith('/rb')) {
    const args = trimmed.split(' ').slice(1);
    await handleRebalance(space, userId, args);
    return;
  }
  
  if (lower.startsWith('/sentiment') || lower.startsWith('/sent')) {
    const args = trimmed.split(' ').slice(1);
    await handleSentiment(space, userId, args);
    return;
  }
  
  if (lower === '/connect' || lower === '/wallet' || lower === '/login') {
    await handleConnect(space, userId, phone);
    return;
  }
  
  if (lower === '/help' || lower === '/commands') {
    await handleHelp(space);
    return;
  }

  // Default: natural language processing via the Moni agent
  await handleNaturalLanguage(space, userId, text, phone);
}

// Graceful shutdown handler
let isShuttingDown = false;
let cleanupInterval: NodeJS.Timeout | null = null;

async function shutdown(signal: string) {
  if (isShuttingDown) return;
  isShuttingDown = true;
  
  log.info(`Received ${signal}, starting graceful shutdown...`);
  
  // Stop session cleanup
  if (cleanupInterval) {
    clearInterval(cleanupInterval);
  }
  
  // Clear sessions
  userSessions.clear();
  
  log.info('Shutdown complete');
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('unhandledRejection', (reason) => {
  log.error('Unhandled rejection', { reason: String(reason) });
});
process.on('uncaughtException', (error) => {
  log.error('Uncaught exception', { error: error.message, stack: error.stack });
  shutdown('uncaughtException');
});

// Check if we have valid Spectrum credentials
const hasSpectrumCredentials = PROJECT_ID && PROJECT_SECRET && PROJECT_ID.length > 10;

// Check if we're in an interactive TTY (for CLI mode)
const isInteractive = process.stdin.isTTY;

// Create Spectrum app or run in appropriate mode
if (hasSpectrumCredentials) {
  const providers = [imessage.config(), terminal.config()];

  const app = await Spectrum({
    projectId: PROJECT_ID,
    projectSecret: PROJECT_SECRET,
    providers,
    webhookSecret: SPECTRUM_WEBHOOK_SECRET || undefined,
  });

  log.info('Moni iMessage Trading Agent started', {
    baseRpc: BASE_RPC_URL,
    cencoriModel: getAIConfig().model,
    cencoriTransport: getAIConfig().transport,
    toolCount: getAIConfig().toolCount,
  });

  // Start session cleanup
  cleanupInterval = startSessionCleanup();

  // Start proactive monitoring in background
  startProactiveMonitoring(
    sendProactiveMessage,
    () => Array.from(userSessions.keys()).filter(id => userSessions.get(id)?.space)
  ).catch(err => {
    log.error('Proactive monitoring failed to start', { error: err.message });
  });
  log.info('Proactive monitoring started', { interval: '60s' });

  // Start webhook server if webhook secret is configured
  if (SPECTRUM_WEBHOOK_SECRET) {
    const webhookServer = createServer(async (req: IncomingMessage, res: ServerResponse) => {
      if (req.method === 'POST' && req.url?.endsWith('/spectrum/webhook')) {
        // Collect raw body for HMAC verification
        const chunks: Buffer[] = [];
        for await (const chunk of req) {
          chunks.push(chunk);
        }
        const body = Buffer.concat(chunks);
        
        const headers: Record<string, string> = {};
        for (const [key, value] of Object.entries(req.headers)) {
          if (value) headers[key] = Array.isArray(value) ? value[0] : value;
        }
        
        try {
          const result = await app.webhook(
            { body, headers },
            async (space: any, message: any) => {
              // Handle message (fire-and-forget). Text and poll_option (a
              // tapped poll answer) both enter the same handler.
              const userId = space.user?.id || space.id || 'unknown';
              await handleInbound(space, message, userId);
            }
          );
          
          res.writeHead(result.status, result.headers);
          res.end(Buffer.from(result.body));
        } catch (error) {
          console.error('Webhook error:', error);
          res.writeHead(500, { 'Content-Type': 'text/plain' });
          res.end('Internal Server Error');
        }
        return;
      }
      
      // Health check endpoint
      if (req.method === 'GET' && req.url?.endsWith('/health')) {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('OK');
        return;
      }
      
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not Found');
    });
    
    webhookServer.listen(WEBHOOK_PORT, () => {
      log.info(`Webhook server listening`, { port: WEBHOOK_PORT, path: '/spectrum/webhook' });
      log.info(`Health check`, { path: '/health' });
    });
  }

  // Handle incoming messages via streaming (FIXED: proper destructuring)
  for await (const [space, message] of app.messages) {
    // Skip outbound messages (our own responses)
    if (message.direction === 'outbound') continue;
    
    // @ts-ignore - Spectrum space types
    const userId = space.user?.id || space.id || 'unknown';

    await handleInbound(space, message, userId);
  }
} else if (isInteractive) {
  // CLI mode for local interaction without Spectrum credentials (only in interactive TTY)
  log.info('Moni Trading Agent (CLI Mode)', { baseRpc: BASE_RPC_URL });
  console.log('\nJust chat naturally. Examples:');
  console.log('  "What\'s my portfolio?"');
  console.log('  "Buy $100 of AAPL with USDC"');
  console.log('  "Set stop-loss for NVDA at $800"');
  console.log('  "How risky is my portfolio?"');
  console.log('Type "exit" to quit\n');

  const readline = await import('readline');
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: 'moni> '
  });

  const cliUserId = 'cli-user';
  let space: any = {
    _moniCli: true,
    send: async (text: string) => console.log(`\n${text}\n`),
  };

  // Register the CLI session with a space so proactive monitoring can reach it
  getSession(cliUserId, space);

  // Start proactive monitoring in CLI mode too
  startProactiveMonitoring(
    async (userId: string, message: string) => {
      const session = userSessions.get(userId);
      if (session?.space) {
        await session.space.send(message);
      } else {
        console.log(`\n📱 [Proactive → ${userId}]: ${message}\n`);
      }
    },
    () => [cliUserId]
  ).catch(err => {
    log.error('Proactive monitoring failed to start', { error: err.message });
  });

  rl.prompt();

  rl.on('line', async (input: string) => {
    const trimmed = input.trim();
    if (trimmed === 'exit' || trimmed === 'quit') {
      console.log('👋 Goodbye!');
      rl.close();
      process.exit(0);
    }
    if (trimmed) {
      await handleMessage(space, cliUserId, trimmed);
    }
    rl.prompt();
  });
  
  // Handle CLI shutdown
  rl.on('close', () => {
    shutdown('CLI close');
  });
} else {
  // Production mode without Spectrum credentials - keep health server running
  log.info('Moni Trading Agent (Background Mode)', { baseRpc: BASE_RPC_URL });
  
  // Start session cleanup
  cleanupInterval = startSessionCleanup();

  // Keep process alive for health checks
  await new Promise(() => {}); // Never resolves - keeps process running
}

