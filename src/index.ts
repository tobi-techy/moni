import { createServer, IncomingMessage, ServerResponse } from 'http';
import { Spectrum } from 'spectrum-ts';
import { imessage, terminal } from 'spectrum-ts/providers';
import { typing } from 'spectrum-ts';
import { PROJECT_ID, PROJECT_SECRET, validateEnv, DEMO_MODE, SPECTRUM_WEBHOOK_SECRET, WEBHOOK_PORT } from './env.js';
import { BASE_RPC_URL } from './env.js';
import { handleConversation, ensureWalletConnected } from './conversation.js';
import { startProactiveMonitoring } from './proactive.js';
import { getUserWalletAddress } from './wallet.js';
import { startHealthServer } from './health.js';
import { type Address } from 'viem';
import { getPortfolio, getTokenPrice, formatBalance, formatUSD, B20TokenSymbol, B20_TOKENS } from './base.js';
import { getSwapQuote, getSwapTransaction, parseAmount, formatAmount } from './swap.js';
import { sendAgentMessage, getTradingMemory, setTradingMemory, TradingMemory } from './letta.js';
import { analyzePortfolio, formatAnalytics, getPriceChanges } from './analytics.js';
import { getTransactionHistory, formatTransactionHistory, addTransaction, Transaction } from './history.js';
import { handleStopLoss, handleRebalance, handleSentiment, checkStopLosses } from './automation.js';
import { createPublicClient, http, type Address as ViemAddress } from 'viem';
import { base, baseSepolia } from 'viem/chains';

// Structured logging
const log = {
  info: (msg: string, meta?: Record<string, any>) => console.log(JSON.stringify({ level: 'info', msg, ...meta, timestamp: new Date().toISOString() })),
  warn: (msg: string, meta?: Record<string, any>) => console.warn(JSON.stringify({ level: 'warn', msg, ...meta, timestamp: new Date().toISOString() })),
  error: (msg: string, meta?: Record<string, any>) => console.error(JSON.stringify({ level: 'error', msg, ...meta, timestamp: new Date().toISOString() })),
};

// Start health check server for AtlasFlow/container orchestration
await startHealthServer();

// Validate environment on startup
const envValidation = validateEnv();
if (!envValidation.valid && DEMO_MODE !== 'true') {
  log.error('Missing required environment variables', { missing: envValidation.missing });
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

// Initialize wallet for user
async function initializeWallet(userId: string): Promise<Address | null> {
  const session = getSession(userId);
  
  if (session.walletAddress) {
    return session.walletAddress;
  }

  const walletAddress = await getUserWalletAddress(userId);
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
    const scaledFormatted = formatBalance(holding.scaledBalance, 18);
    const valueFormatted = formatUSD(holding.valueUSD);
    totalValue += holding.valueUSD;
    
    message += `**${holding.symbol}** (${holding.name})\n`;
    message += `  💎 ${scaledFormatted} shares\n`;
    message += `  💰 ${valueFormatted}\n\n`;
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
  
  return `💹 **${symbol} Price**: $${price.toFixed(2)}\n_Updated: ${updated}_`;
}

// Handle portfolio command
async function handlePortfolio(space: any, userId: string) {
  const walletAddress = await initializeWallet(userId);
  
  if (!walletAddress) {
    await space.send('🔐 Please connect your wallet first. Send "/connect" to get started.');
    return;
  }

  await space.send('📊 Fetching your portfolio...');
  
  try {
    const portfolio = await getPortfolio(walletAddress);
    const message = formatPortfolioMessage(portfolio);
    await space.send(message);
  } catch (error) {
    console.error('Portfolio error:', error);
    await space.send('❌ Error fetching portfolio. Please try again.');
  }
}

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
    await space.send(message);
  } catch (error) {
    console.error('Price error:', error);
    await space.send('❌ Error fetching price.');
  }
}

// Handle buy command
async function handleBuy(space: any, userId: string, args: string[]) {
  const session = getSession(userId);
  const walletAddress = await initializeWallet(userId);
  
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
  await space.send(`🔍 Getting quote for ${amount} ${fromToken} → ${toToken}...`);
  
  const quote = await getSwapQuote(fromTokenAddress, toTokenAddress, parseAmount(amount, 6).toString());
  
  if (!quote) {
    await space.send('❌ Could not get quote. Please try again.');
    return;
  }

  const toAmount = formatAmount(BigInt(quote.toAmount), 18);
  
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
    `⛽ Est. gas: ${quote.estimatedGas}\n\n` +
    `Reply **"confirm"** to execute or **"cancel"** to abort.`
  );
}

// Handle sell command
async function handleSell(space: any, userId: string, args: string[]) {
  const session = getSession(userId);
  const walletAddress = await initializeWallet(userId);
  
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
  
  if (!holding || holding.scaledBalance < parseAmount(amount, 18)) {
    await space.send(`❌ Insufficient ${fromToken} balance. You have ${formatBalance(holding?.scaledBalance || 0n, 18)}`);
    return;
  }

  await space.send(`🔍 Getting quote for ${amount} ${fromToken} → ${toToken}...`);
  
  const quote = await getSwapQuote(fromTokenAddress, toTokenAddress, parseAmount(amount, 18).toString());
  
  if (!quote) {
    await space.send('❌ Could not get quote.');
    return;
  }

  const toAmount = formatAmount(BigInt(quote.toAmount), toToken === 'USDC' ? 6 : 18);
  
  session.state = 'awaiting_confirmation';
  session.pendingTrade = {
    type: 'sell',
    fromToken: fromTokenAddress,
    toToken: toTokenAddress,
    amount: parseAmount(amount, 18).toString(),
  };

  await space.send(
    `✅ **Quote Ready**\n\n` +
    `📥 You send: ${amount} ${fromToken}\n` +
    `📤 You receive: ~${toAmount} ${toToken}\n` +
    `⛽ Est. gas: ${quote.estimatedGas}\n\n` +
    `Reply **"confirm"** to execute or **"cancel"** to abort.`
  );
}

// Handle confirm
async function handleConfirm(space: any, userId: string) {
  const session = getSession(userId);
  
  if (session.state !== 'awaiting_confirmation' || !session.pendingTrade) {
    await space.send('❌ No pending trade to confirm.');
    return;
  }

  const walletClient = await getUserWalletClient(userId);
  
  if (DEMO_MODE === 'true') {
    // Demo mode: simulate trade
    await space.send('⏳ **Executing trade (demo mode)...**');
    
    // Simulate delay
    await new Promise(r => setTimeout(r, 2000));
    
    const { fromToken, toToken, amount } = session.pendingTrade;
    const fromSymbol = Object.entries(B20_TOKENS).find(([_, v]) => v === fromToken)?.[0] || 'USDC';
    const toSymbol = Object.entries(B20_TOKENS).find(([_, v]) => v === toToken)?.[0] || 'USDC';
    
    await space.send(
      `✅ **Trade Executed (Demo)**\n\n` +
      `📥 Sent: ${formatAmount(BigInt(amount), fromSymbol === 'USDC' ? 6 : 18)} ${fromSymbol}\n` +
      `📥 Received: ~${formatAmount(BigInt(amount), toSymbol === 'USDC' ? 6 : 18)} ${toSymbol}\n` +
      `🔗 Tx: 0x${'demo'.padStart(64, '0')}\n\n` +
      `_This was a simulated trade. No real funds moved._`
    );
  } else {
    // Real trade execution would go here
    await space.send('⚠️ Real trading not yet implemented. Set DEMO_MODE=false and configure 1inch API.');
  }

  session.state = 'idle';
  session.pendingTrade = undefined;
}

// Handle cancel
async function handleCancel(space: any, userId: string) {
  const session = getSession(userId);
  
  if (session.state !== 'awaiting_confirmation') {
    await space.send('❌ No pending trade to cancel.');
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
    await space.send('📋 Fetching watchlist prices...');
    
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
    `**Portfolio & Prices**\n` +
    `• \`/portfolio\` - View your holdings\n` +
    `• \`/price <token>\` - Check token price\n` +
    `• \`/watchlist\` - View watchlist prices\n` +
    `• \`/analytics\` - Portfolio analytics & diversification\n` +
    `• \`/analytics changes\` - 24h price changes for watchlist\n` +
    `• \`/history\` - Transaction history\n\n` +
    `**Trading**\n` +
    `• \`/buy <amount> <token> [with <token>]\` - Buy tokens\n` +
    `  Example: \`/buy 100 USDC AAPL\`\n` +
    `• \`/sell <amount> <token> [for <token>]\` - Sell tokens\n` +
    `  Example: \`/sell 10 AAPL USDC\`\n` +
    `• \`/confirm\` / \`/cancel\` - Confirm or cancel pending trade\n\n` +
    `**Automation**\n` +
    `• \`/dca create <amount> <token> <frequency>\` - Dollar cost average\n` +
    `• \`/dca list\` - List DCA strategies\n` +
    `• \`/alert create <token> <above|below> <price>\` - Price alerts\n` +
    `• \`/stoploss create <token> <stop> <target> <amount>\` - Stop-loss/Take-profit\n` +
    `• \`/rebalance create <sym:pct> ...\` - Portfolio rebalancing\n` +
    `• \`/sentiment\` - Market sentiment for watchlist\n\n` +
    `**Wallet**\n` +
    `• \`/connect\` - Connect your wallet\n` +
    `• \`/wallet\` - Show wallet address\n\n` +
    `**Agent**\n` +
    `• Just chat naturally! Ask me anything about trading, markets, or your portfolio.`
  );
}

// Handle connect
async function handleConnect(space: any, userId: string) {
  const session = getSession(userId);
  
  if (session.authenticated && session.walletAddress) {
    await space.send(
      `✅ **Wallet Connected**\n\n` +
      `Address: ${session.walletAddress.slice(0, 6)}...${session.walletAddress.slice(-4)}\n\n` +
      `You're ready to trade! Try \`/portfolio\` or \`/price AAPL\``
    );
    return;
  }

  if (DEMO_MODE === 'true') {
    // Demo mode: auto-connect
    const demoAddress = '0x742d35Cc6634C0532925a3b8D4C0532925a3b8D4' as Address;
    session.walletAddress = demoAddress;
    session.authenticated = true;
    
    await space.send(
      `✅ **Demo Wallet Connected**\n\n` +
      `Address: ${demoAddress.slice(0, 6)}...${demoAddress.slice(-4)}\n\n` +
      `You're in demo mode - all trades are simulated.\n` +
      `Try \`/portfolio\` or \`/buy 100 USDC AAPL\``
    );
  } else {
    // Real mode: send Privy connection link
    await space.send(
      `🔐 **Connect Your Wallet**\n\n` +
      `Click the link below to connect your wallet via Privy:\n` +
      `https://auth.privy.io/connect?app_id=${process.env.PRIVY_APP_ID}\n\n` +
      `After connecting, send \`/wallet\` to verify.`
    );
  }
}

// Handle natural language via Letta agent
async function handleNaturalLanguage(space: any, userId: string, message: string) {
  await space.send('🤔 Thinking...');
  
  try {
    const response = await sendAgentMessage(userId, message);
    await space.send(response);
  } catch (error) {
    const lettaConflict = error instanceof Error && /409 Conflict/.test(error.message);
    const waitingForApproval = error instanceof Error && /waiting for approval/.test(error.message);

    console.error('Agent error:', error);
    if (lettaConflict || waitingForApproval) {
      await space.send('⏳ My agent loop is waiting on a pending tool approval. I’ll continue as soon as that clears.');
      return;
    }
    await space.send('❌ Sorry, I had trouble processing that. Try a command or ask again.');
  }
}

// Main message handler
async function handleMessage(space: any, userId: string, text: string) {
  const session = getSession(userId, space);
  const trimmed = text.trim();
  const lower = trimmed.toLowerCase();
  console.log('📩 Message received:', JSON.stringify({ userId, text: trimmed }));

  // Handle commands
  if (lower.startsWith('/portfolio') || lower.startsWith('/holdings') || lower.startsWith('/balance')) {
    await handlePortfolio(space, userId);
    return;
  }
  
  if (lower.startsWith('/price ')) {
    const symbol = trimmed.split(' ')[1];
    await handlePrice(space, symbol);
    return;
  }
  
  if (lower.startsWith('/buy ')) {
    const args = trimmed.split(' ').slice(1);
    await handleBuy(space, userId, args);
    return;
  }
  
  if (lower.startsWith('/sell ')) {
    const args = trimmed.split(' ').slice(1);
    await handleSell(space, userId, args);
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
    await handleConnect(space, userId);
    return;
  }
  
  if (lower === '/help' || lower === '/commands') {
    await handleHelp(space);
    return;
  }

  // Default: natural language processing via Letta
  await handleNaturalLanguage(space, userId, text);
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
  const providers = DEMO_MODE === 'true'
    ? [imessage.config(), terminal.config()]
    : [imessage.config(), terminal.config()];

  const app = await Spectrum({
    projectId: PROJECT_ID,
    projectSecret: PROJECT_SECRET,
    providers,
    webhookSecret: SPECTRUM_WEBHOOK_SECRET || undefined,
  });

  log.info('Moni iMessage Trading Agent started', { demoMode: DEMO_MODE, baseRpc: BASE_RPC_URL });

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
              // Handle message (fire-and-forget)
              if (message.content?.type === 'text' && message.content.text) {
                const userId = space.user?.id || space.id || 'unknown';
                await handleMessage(space, userId, message.content.text);
              }
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
    
    if (message.content?.type === 'text' && message.content.text) {
      await handleMessage(space, userId, message.content.text);
    }
  }
} else if (isInteractive) {
  // CLI mode for demo/testing without Spectrum credentials (only in interactive TTY)
  log.info('Moni Trading Agent (CLI Demo Mode)', { demoMode: DEMO_MODE, baseRpc: BASE_RPC_URL });
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

  const demoUserId = 'demo-user';
  let space: any = {
    send: async (text: string) => console.log(`\n${text}\n`),
  };

  // Register demo user session with space for proactive monitoring
  getSession(demoUserId, space);

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
    () => [demoUserId]
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
      await handleMessage(space, demoUserId, trimmed);
    }
    rl.prompt();
  });
  
  // Handle CLI shutdown
  rl.on('close', () => {
    shutdown('CLI close');
  });
} else {
  // Production mode without Spectrum credentials - keep health server running
  log.info('Moni Trading Agent (Background Mode)', { demoMode: DEMO_MODE, baseRpc: BASE_RPC_URL });
  
  // Start session cleanup
  cleanupInterval = startSessionCleanup();

  // Keep process alive for health checks
  await new Promise(() => {}); // Never resolves - keeps process running
}

