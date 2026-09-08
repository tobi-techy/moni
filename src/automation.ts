import { getTradingMemory, setTradingMemory, TradingMemory } from './letta.js';
import { getTokenPrice, getPortfolio, formatUSD } from './base.js';
import { getUserWalletAddress } from './wallet.js';

// Stop-loss / Take-profit automation
export interface StopLossConfig {
  token: string;
  stopLossPrice: number;
  takeProfitPrice: number;
  amount: string; // amount of token to sell
  active: boolean;
}

export async function createStopLoss(
  userId: string,
  config: Omit<StopLossConfig, 'active'>
): Promise<void> {
  const memory = await getTradingMemory(userId);
  const stopLoss: StopLossConfig = { ...config, active: true };
  
  // Store in activeStrategies
  const strategy = {
    type: 'stop_loss' as const,
    params: stopLoss,
    active: true,
  };
  
  memory.activeStrategies.push(strategy);
  await setTradingMemory(userId, { activeStrategies: memory.activeStrategies });
}

export async function getActiveStopLosses(userId: string): Promise<StopLossConfig[]> {
  const memory = await getTradingMemory(userId);
  return memory.activeStrategies
    .filter((s: any) => s.type === 'stop_loss' && s.active)
    .map((s: any) => s.params);
}

export async function checkStopLosses(userId: string): Promise<string[]> {
  const stopLosses = await getActiveStopLosses(userId);
  const triggered: string[] = [];
  
  for (const sl of stopLosses) {
    const priceData = await getTokenPrice(sl.token as any);
    if (!priceData) continue;
    
    const currentPrice = Number(priceData.price) / 10 ** priceData.decimals;
    
    if (currentPrice <= sl.stopLossPrice) {
      triggered.push(`🔴 STOP LOSS TRIGGERED: ${sl.token} at $${currentPrice.toFixed(2)} (stop: $${sl.stopLossPrice})`);
      // In production, would execute sell order here
      sl.active = false;
    } else if (currentPrice >= sl.takeProfitPrice) {
      triggered.push(`🟢 TAKE PROFIT TRIGGERED: ${sl.token} at $${currentPrice.toFixed(2)} (target: $${sl.takeProfitPrice})`);
      sl.active = false;
    }
  }
  
  // Update memory with deactivated stop losses
  if (triggered.length > 0) {
    const memory = await getTradingMemory(userId);
    memory.activeStrategies = memory.activeStrategies.map((s: any) => {
      if (s.type === 'stop_loss') {
        const triggeredSl = stopLosses.find(t => t.token === s.params.token);
        if (triggeredSl && !triggeredSl.active) {
          return { ...s, active: false };
        }
      }
      return s;
    });
    await setTradingMemory(userId, { activeStrategies: memory.activeStrategies });
  }
  
  return triggered;
}

// Portfolio rebalancing
export interface RebalanceConfig {
  targetAllocation: Record<string, number>; // symbol -> percentage
  tolerance: number; // percentage deviation allowed
  active: boolean;
}

export async function createRebalanceStrategy(
  userId: string,
  config: Omit<RebalanceConfig, 'active'>
): Promise<void> {
  const memory = await getTradingMemory(userId);
  const strategy = {
    type: 'rebalance' as const,
    params: { ...config, active: true },
    active: true,
  };
  
  memory.activeStrategies.push(strategy);
  await setTradingMemory(userId, { activeStrategies: memory.activeStrategies });
}

export async function checkRebalanceNeeded(userId: string): Promise<{ 
  needed: boolean; 
  suggestions: Array<{ symbol: string; currentPct: number; targetPct: number; action: 'buy' | 'sell'; amount: string }> 
} | null> {
  const memory = await getTradingMemory(userId);
  const rebalanceStrategies = memory.activeStrategies
    .filter((s: any) => s.type === 'rebalance' && s.active);
  
  if (rebalanceStrategies.length === 0) return null;
  
  // For demo, just use the first strategy
  const strategy = rebalanceStrategies[0];
  const config = strategy.params as RebalanceConfig;
  
  // Get current portfolio from onchain data
  const walletAddress = await getUserWalletAddress(userId);
  if (!walletAddress) {
    return null;
  }

  const portfolio = await getPortfolio(walletAddress);
  if (portfolio.length === 0) {
    return null;
  }

  // Calculate total portfolio value
  let totalValue = 0n;
  for (const holding of portfolio) {
    totalValue += holding.valueUSD;
  }

  if (totalValue === 0n) {
    return null;
  }

  // Build current allocation map (symbol → percentage)
  const currentAllocation: Record<string, number> = {};
  for (const holding of portfolio) {
    const pct = Number((holding.valueUSD * 10000n) / totalValue) / 100;
    currentAllocation[holding.symbol] = pct;
  }

  const suggestions: Array<{ symbol: string; currentPct: number; targetPct: number; action: 'buy' | 'sell'; amount: string }> = [];
  
  let needed = false;
  for (const [symbol, targetPct] of Object.entries(config.targetAllocation)) {
    const currentPct = currentAllocation[symbol] || 0;
    const diff = currentPct - targetPct;
    
    if (Math.abs(diff) > config.tolerance) {
      needed = true;
      // Calculate dollar amount needed to rebalance
      const totalValueNum = Number(formatUSD(totalValue).replace(/[$,]/g, ''));
      const dollarAmount = (Math.abs(diff) / 100) * totalValueNum;
      suggestions.push({
        symbol,
        currentPct,
        targetPct,
        action: diff > 0 ? 'sell' : 'buy',
        amount: `${Math.abs(diff).toFixed(1)}% (~$${dollarAmount.toFixed(0)})`,
      });
    }
  }
  
  return { needed, suggestions };
}

// Market sentiment (simulated)
export interface SentimentData {
  symbol: string;
  sentiment: 'bullish' | 'bearish' | 'neutral';
  score: number; // -1 to 1
  sources: string[];
  timestamp: number;
}

export async function getMarketSentiment(symbols: string[]): Promise<SentimentData[]> {
  // In production, would fetch from Twitter, news APIs, etc.
  // For demo, simulate
  return symbols.map(symbol => ({
    symbol,
    sentiment: Math.random() > 0.5 ? 'bullish' : Math.random() > 0.5 ? 'bearish' : 'neutral',
    score: (Math.random() - 0.5) * 2,
    sources: ['Twitter', 'Reddit', 'News'],
    timestamp: Date.now(),
  }));
}

export function formatSentiment(sentiments: SentimentData[]): string {
  let message = '📰 **Market Sentiment**\n\n';
  
  for (const s of sentiments) {
    const emoji = s.sentiment === 'bullish' ? '🟢' : s.sentiment === 'bearish' ? '🔴' : '⚪';
    const bar = '█'.repeat(Math.max(1, Math.round((s.score + 1) * 5)));
    message += `${emoji} **${s.symbol}**: ${s.sentiment.toUpperCase()} (${s.score.toFixed(2)})\n`;
    message += `   ${bar}\n`;
    message += `   Sources: ${s.sources.join(', ')}\n\n`;
  }
  
  return message;
}

// Handle stop-loss command
export async function handleStopLoss(space: any, userId: string, args: string[]) {
  if (args[0] === 'create' && args.length >= 4) {
    // /stoploss create <token> <stop_price> <target_price> <amount>
    const token = args[1].toUpperCase();
    const stopLossPrice = parseFloat(args[2]);
    const takeProfitPrice = parseFloat(args[3]);
    const amount = args[4];
    
    await createStopLoss(userId, { token, stopLossPrice, takeProfitPrice, amount });
    
    await space.send(
      `🛑 **Stop-Loss / Take-Profit Created**\n\n` +
      `📈 Token: ${token}\n` +
      `🔴 Stop Loss: $${stopLossPrice.toFixed(2)}\n` +
      `🟢 Take Profit: $${takeProfitPrice.toFixed(2)}\n` +
      `📦 Amount: ${amount} ${token}\n` +
      `🟢 Status: Active`
    );
  } else if (args[0] === 'list') {
    const stopLosses = await getActiveStopLosses(userId);
    
    if (stopLosses.length === 0) {
      await space.send('📭 No active stop-losses. Create one with `/stoploss create <token> <stop> <target> <amount>`');
      return;
    }
    
    let message = '🛑 **Active Stop-Losses**\n\n';
    for (const sl of stopLosses) {
      message += `• ${sl.token}: Stop $${sl.stopLossPrice} | Target $${sl.takeProfitPrice} | ${sl.amount} ${sl.token}\n`;
    }
    await space.send(message);
  } else {
    await space.send(
      `🛑 **Stop-Loss Commands**\n\n` +
      `• \`/stoploss create <token> <stop_price> <target_price> <amount>\`\n` +
      `  Example: \`/stoploss create AAPL 180 250 10\`\n` +
      `• \`/stoploss list\` - List active stop-losses`
    );
  }
}

// Handle rebalance command
export async function handleRebalance(space: any, userId: string, args: string[]) {
  if (args[0] === 'create' && args.length >= 2) {
    // /rebalance create <symbol:percentage> ...
    // Example: /rebalance create AAPL:40 NVDA:30 MSFT:30
    const allocation: Record<string, number> = {};
    
    for (let i = 1; i < args.length; i++) {
      const [symbol, pct] = args[i].split(':');
      if (symbol && pct) {
        allocation[symbol.toUpperCase()] = parseFloat(pct);
      }
    }
    
    const total = Object.values(allocation).reduce((a, b) => a + b, 0);
    if (Math.abs(total - 100) > 0.1) {
      await space.send(`❌ Allocation must sum to 100% (currently ${total}%)`);
      return;
    }
    
    await createRebalanceStrategy(userId, { 
      targetAllocation: allocation, 
      tolerance: 5 
    });
    
    await space.send(
      `⚖️ **Rebalance Strategy Created**\n\n` +
      `Target Allocation:\n` +
      Object.entries(allocation).map(([s, p]) => `  ${s}: ${p}%`).join('\n') +
      `\n🔄 Tolerance: ±5%`
    );
  } else if (args[0] === 'check') {
    const result = await checkRebalanceNeeded(userId);
    
    if (!result) {
      await space.send('📭 No active rebalance strategy. Create one with `/rebalance create AAPL:40 NVDA:30 MSFT:30`');
      return;
    }
    
    if (!result.needed) {
      await space.send('✅ Portfolio is within tolerance. No rebalancing needed.');
      return;
    }
    
    let message = '⚖️ **Rebalance Suggested**\n\n';
    for (const s of result.suggestions) {
      const emoji = s.action === 'buy' ? '🟢' : '🔴';
      message += `${emoji} ${s.symbol}: ${s.currentPct.toFixed(1)}% → ${s.targetPct.toFixed(1)}% (${s.action} ${s.amount})\n`;
    }
    await space.send(message);
  } else {
    await space.send(
      `⚖️ **Rebalance Commands**\n\n` +
      `• \`/rebalance create <symbol:percentage> ...\` - Create rebalance strategy\n` +
      `  Example: \`/rebalance create AAPL:40 NVDA:30 MSFT:30\`\n` +
      `• \`/rebalance check\` - Check if rebalancing needed`
    );
  }
}

// Handle sentiment command
export async function handleSentiment(space: any, userId: string, args: string[]) {
  const memory = await getTradingMemory(userId);
  const watchlist = memory.watchlist || ['AAPL', 'NVDA', 'MSFT'];
  
  const symbols = args.length > 0 ? args.map(s => s.toUpperCase()) : watchlist;
  const sentiments = await getMarketSentiment(symbols);
  const message = formatSentiment(sentiments);
  
  await space.send(message);
}
