import { getTradingMemory, setTradingMemory, TradingMemory } from './letta.js';
import { checkStopLosses, checkRebalanceNeeded } from './automation.js';
import { getUserWalletAddress } from './wallet.js';
import { getPortfolio, formatUSD, B20_TOKENS } from './base.js';
import { checkPriceAlerts } from './agent-tools.js';
import { getSwapQuote, parseAmount, formatAmount } from './swap.js';
import { addTransaction } from './history.js';
import { DEMO_MODE } from './env.js';

// Proactive monitoring configuration
const PROACTIVE_INTERVAL_MS = 60000; // 1 minute
const PRICE_ALERT_COOLDOWN_MS = 300000; // 5 minutes
const REBALANCE_COOLDOWN_MS = 3600000; // 1 hour
const STOP_LOSS_COOLDOWN_MS = 60000; // 1 minute

// Track last notification times per user
const lastNotifications = new Map<string, {
  stopLoss: number;
  priceAlert: number;
  rebalance: number;
  portfolioUpdate: number;
}>();

// Main proactive monitoring loop
export async function startProactiveMonitoring(
  sendMessage: (userId: string, message: string) => Promise<void>,
  getActiveUserIds?: () => string[]
): Promise<void> {
  console.log('🔄 Starting proactive monitoring loop...');
  
  setInterval(async () => {
    try {
      await runProactiveChecks(sendMessage, getActiveUserIds);
    } catch (error) {
      console.error('Proactive monitoring error:', error);
    }
  }, PROACTIVE_INTERVAL_MS);
}

// Run all proactive checks for all users
async function runProactiveChecks(
  sendMessage: (userId: string, message: string) => Promise<void>,
  getActiveUserIds?: () => string[]
): Promise<void> {
  const userIds = getActiveUserIds ? getActiveUserIds() : getDefaultUserIds();
  
  for (const userId of userIds) {
    await checkUserProactive(userId, sendMessage);
  }
}

// Default: return demo user (fallback when no callback provided)
function getDefaultUserIds(): string[] {
  return ['demo-user'];
}

// Check proactive conditions for a single user
async function checkUserProactive(
  userId: string,
  sendMessage: (userId: string, message: string) => Promise<void>
): Promise<void> {
  const now = Date.now();
  const lastNotif = lastNotifications.get(userId) || {
    stopLoss: 0,
    priceAlert: 0,
    rebalance: 0,
    portfolioUpdate: 0,
  };

  try {
    // 1. Check stop-losses (highest priority - immediate)
    const triggeredStopLosses = await checkStopLosses(userId);
    if (triggeredStopLosses.length > 0) {
      if (now - lastNotif.stopLoss > STOP_LOSS_COOLDOWN_MS) {
        for (const triggered of triggeredStopLosses) {
          await sendMessage(userId, `🔴 ${triggered}`);
        }
        lastNotif.stopLoss = now;
      }
    }

    // 2. Check price alerts
    const alertResult = await checkPriceAlerts(userId);
    if (alertResult.success && alertResult.data.triggered.length > 0) {
      if (now - lastNotif.priceAlert > PRICE_ALERT_COOLDOWN_MS) {
        for (const triggered of alertResult.data.triggered) {
          await sendMessage(userId, `🔔 ${triggered}`);
        }
        lastNotif.priceAlert = now;
      }
    }

    // 3. Check rebalance drift
    const rebalanceResult = await checkRebalanceNeeded(userId);
    if (rebalanceResult && rebalanceResult.needed) {
      if (now - lastNotif.rebalance > REBALANCE_COOLDOWN_MS) {
        const suggestions = rebalanceResult.suggestions.slice(0, 3);
        const summary = suggestions.map(s => 
          `${s.action === 'buy' ? 'Buy' : 'Sell'} ${s.symbol} (${s.currentPct.toFixed(0)}% → ${s.targetPct.toFixed(0)}%)`
        ).join(', ');
        
        await sendMessage(userId, 
          `⚖️ Your portfolio drifted from target allocations: ${summary}. ` +
          `Want me to show rebalance details or execute?`
        );
        lastNotif.rebalance = now;
      }
    }

    // 4. Check DCA strategies — execute if interval has elapsed
    await checkDcaStrategies(userId, sendMessage);

    // 5. Daily portfolio summary (optional - could be scheduled separately)
    // Check if it's a new day for this user
    const memory = await getTradingMemory(userId);
    const lastSummary = (memory as any).lastDailySummary || 0;
    const dayMs = 86400000;
    if (now - lastSummary > dayMs) {
      await sendDailySummary(userId, sendMessage);
      (memory as any).lastDailySummary = now;
      await setTradingMemory(userId, memory as any);
    }

  } catch (error) {
    console.error(`Proactive check failed for ${userId}:`, error);
  }

  lastNotifications.set(userId, lastNotif);
}

// Check DCA strategies and execute if interval has elapsed
async function checkDcaStrategies(
  userId: string,
  sendMessage: (userId: string, message: string) => Promise<void>
): Promise<void> {
  const memory = await getTradingMemory(userId);
  const dcaStrategies = memory.activeStrategies.filter(
    (s: any) => s.type === 'dca' && s.active
  );

  if (dcaStrategies.length === 0) return;

  const now = Date.now();

  for (const strategy of dcaStrategies) {
    const params = strategy.params;
    if (!params?.amount || !params?.token || !params?.frequency) continue;

    // Calculate interval in ms
    const intervalMs = getDcaIntervalMs(params.frequency);
    if (intervalMs === 0) continue;

    // Check if enough time has passed since last execution
    const lastExecuted = params.lastExecuted || 0;
    if (now - lastExecuted < intervalMs) continue;

    // Execute DCA: validate, refresh quote, and execute safely
    const usdcAddress = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
    const tokenSymbol = params.token.toUpperCase() as keyof typeof B20_TOKENS;
    const tokenAddress = B20_TOKENS[tokenSymbol];
    if (!tokenAddress) {
      await sendMessage(userId, `🔄 DCA: Unknown token ${params.token}. Please update your strategy.`);
      continue;
    }

    const parsedAmount = parseAmount(params.amount, 6);
    if (parsedAmount <= 0n) {
      await sendMessage(userId, `🔄 DCA: Invalid amount ${params.amount} USDC for ${params.token}.`);
      continue;
    }

    try {
      const quote = await getSwapQuote(usdcAddress, tokenAddress, parsedAmount.toString());
      if (!quote || BigInt(quote.toAmount) <= 0n) {
        await sendMessage(userId,
          `🔄 DCA: Couldn't get a valid quote for ${params.amount} USDC → ${params.token}. Will retry next cycle.`
        );
        continue;
      }

      const receivedAmount = formatAmount(BigInt(quote.toAmount), 18);
      const txHash = DEMO_MODE === 'true'
        ? `0xdca${Date.now().toString(16).padStart(58, '0')}`
        : undefined;

      if (txHash) {
        await addTransaction(userId, {
          timestamp: now,
          type: 'dca',
          fromToken: 'USDC',
          toToken: tokenSymbol,
          fromAmount: parsedAmount,
          toAmount: BigInt(quote.toAmount),
          fromAmountFormatted: params.amount,
          toAmountFormatted: receivedAmount,
          priceUSD: Number(quote.toAmount) / Number(parsedAmount),
          txHash,
          status: 'confirmed',
          gasUsed: 145000n,
          gasPrice: 1000000000n,
        });

        params.lastExecuted = now;
        await setTradingMemory(userId, { activeStrategies: memory.activeStrategies });

        await sendMessage(userId,
          `🔄 DCA executed: ${params.amount} USDC → ${receivedAmount} ${params.token}. ` +
          `Next ${params.frequency} DCA scheduled. Tx: ${txHash.slice(0, 10)}...`
        );
      } else {
        await sendMessage(userId,
          `🔄 DCA prepared ${params.amount} USDC → ~${receivedAmount} ${params.token}, ` +
          `but real execution isn't wired in proactive DCA yet. No transaction was submitted.`
        );
      }
    } catch (error) {
      console.error(`DCA execution failed for ${userId}:`, error);
      await sendMessage(userId,
        `🔄 DCA for ${params.token} failed: ${(error as Error).message}. Will retry next cycle.`
      );
    }
  }
}

// Convert frequency string to milliseconds
function getDcaIntervalMs(frequency: string): number {
  const intervals: Record<string, number> = {
    hourly: 3600000,
    daily: 86400000,
    weekly: 604800000,
    monthly: 2592000000, // 30 days
  };
  return intervals[frequency.toLowerCase()] || 0;
}

// Send daily portfolio summary
async function sendDailySummary(
  userId: string,
  sendMessage: (userId: string, message: string) => Promise<void>
): Promise<void> {
  try {
    const walletAddress = await getUserWalletAddress(userId);
    if (!walletAddress) return;

    const portfolio = await getPortfolio(walletAddress);
    if (portfolio.length === 0) return;

    let totalValue = 0n;
    const changes: string[] = [];

    for (const holding of portfolio) {
      totalValue += holding.valueUSD;
      // In production, compare with 24h ago
      // For demo, simulate
      const changePct = (Math.random() - 0.5) * 10;
      const emoji = changePct >= 0 ? '📈' : '📉';
      changes.push(`${emoji} ${holding.symbol}: ${changePct >= 0 ? '+' : ''}${changePct.toFixed(1)}%`);
    }

    const topMovers = changes.slice(0, 3).join(' | ');
    
    await sendMessage(userId,
      `📊 Daily summary: Portfolio worth ${formatUSD(totalValue)}. ` +
      `Top movers: ${topMovers}. ` +
      `Reply "details" for full breakdown.`
    );
  } catch (error) {
    console.error('Daily summary error:', error);
  }
}

// Manual trigger for proactive check (e.g., user asks "any alerts?")
export async function triggerProactiveCheck(userId: string): Promise<string[]> {
  const messages: string[] = [];
  
  try {
    const triggeredStopLosses = await checkStopLosses(userId);
    if (triggeredStopLosses.length > 0) {
      messages.push(...triggeredStopLosses);
    }

    const alertResult = await checkPriceAlerts(userId);
    if (alertResult.success && alertResult.data.triggered.length > 0) {
      messages.push(...alertResult.data.triggered.map((t: string) => `🔔 ${t}`));
    }

    const rebalanceResult = await checkRebalanceNeeded(userId);
    if (rebalanceResult && rebalanceResult.needed) {
      const suggestions = rebalanceResult.suggestions.slice(0, 2);
      const summary = suggestions.map(s => 
        `${s.action === 'buy' ? 'Buy' : 'Sell'} ${s.symbol} (${s.currentPct.toFixed(0)}% → ${s.targetPct.toFixed(0)}%)`
      ).join(', ');
      messages.push(`⚖️ Rebalance drift: ${summary}`);
    }
  } catch (error) {
    console.error('Manual proactive check error:', error);
  }

  return messages;
}

// Notify user of trade execution (called after trade completes)
export async function notifyTradeExecuted(
  userId: string,
  sendMessage: (userId: string, message: string) => Promise<void>,
  trade: {
    type: 'buy' | 'sell';
    fromToken: string;
    toToken: string;
    fromAmount: string;
    toAmount: string;
    txHash: string;
  }
): Promise<void> {
  const action = trade.type === 'buy' ? 'Bought' : 'Sold';
  const emoji = trade.type === 'buy' ? '🟢' : '🔴';
  
  await sendMessage(userId,
    `${emoji} ${action} ${trade.fromAmount} ${trade.fromToken} → ${trade.toAmount} ${trade.toToken}. ` +
    `Tx: ${trade.txHash.slice(0,10)}...`
  );
}

// Notify user of strategy creation
export async function notifyStrategyCreated(
  userId: string,
  sendMessage: (userId: string, message: string) => Promise<void>,
  strategy: {
    type: 'dca' | 'stop_loss' | 'price_alert' | 'rebalance';
    details: string;
  }
): Promise<void> {
  const emojis = { dca: '🔄', stop_loss: '🛑', price_alert: '🔔', rebalance: '⚖️' };
  const emoji = emojis[strategy.type] || '✅';
  
  await sendMessage(userId, `${emoji} ${strategy.details}`);
}

// Check if user has any active automations
export async function getActiveAutomations(userId: string): Promise<{
  stopLosses: number;
  priceAlerts: number;
  dcaStrategies: number;
  rebalanceStrategies: number;
}> {
  const memory = await getTradingMemory(userId);
  
  return {
    stopLosses: memory.activeStrategies.filter(s => s.type === 'stop_loss' && s.active).length,
    priceAlerts: memory.activeStrategies.filter(s => s.type === 'price_alert' && s.active).length,
    dcaStrategies: memory.activeStrategies.filter(s => s.type === 'dca' && s.active).length,
    rebalanceStrategies: memory.activeStrategies.filter(s => s.type === 'rebalance' && s.active).length,
  };
}
