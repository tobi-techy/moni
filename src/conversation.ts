import { sendAgentMessage, getTradingMemory, setTradingMemory, TradingMemory } from './ai.js';
import { checkStopLosses, checkRebalanceNeeded } from './automation.js';
import { getUserWalletAddress } from './wallet.js';
import { formatUSD, formatBalance, B20_TOKENS } from './base.js';
import { checkPriceAlerts } from './agent-tools.js';

// Natural language formatters - convert structured data to human speech
export function formatPortfolioHuman(data: any): string {
  if (!data.holdings || data.holdings.length === 0) {
    return "Your portfolio is empty. Ready to start trading tokenized stocks?";
  }

  const total = data.totalValue;
  const totalRaw = data.totalValueRaw;
  const lines = [`You're holding ${data.holdings.length} positions worth ${total} total:`];
  
  // Calculate total value in numeric form
  const totalValueNum = totalRaw ? Number(totalRaw.toString()) / 1e8 : 0;
  
  for (const h of data.holdings) {
    const holdingValue = parseUSD(h.valueUSD);
    const pct = totalValueNum > 0 ? Math.round((holdingValue / totalValueNum) * 100) : 0;
    lines.push(`  ${h.symbol}: ${h.shares} shares (${h.valueUSD}, ${pct}%)`);
  }
  
  // Add risk insight if concentrated
  const top = data.holdings[0];
  if (top && totalRaw) {
    const topValue = parseUSD(top.valueUSD);
    const totalValueNum = Number(totalRaw.toString()) / 1e8;
    const topPct = totalValueNum > 0 ? Math.round((topValue / totalValueNum) * 100) : 0;
    if (topPct > 50) {
      lines.push(`\n⚠️ Heads up: ${top.symbol} is ${topPct}% of your portfolio. That's concentrated risk.`);
    }
  }
  
  return lines.join('\n');
}

function parseUSD(usdString: string): number {
  // Parse "$20,400" or "$20400" to 20400
  return Number(usdString.replace('$', '').replace(/,/g, ''));
}

export function formatPriceHuman(data: any): string {
  if (!data.price) return `Couldn't fetch ${data.symbol} price.`;
  return `${data.symbol} is trading at $${data.price.toFixed(2)} (updated ${data.updated})`;
}

export function formatWatchlistHuman(data: any): string {
  if (!data.prices || data.prices.length === 0) return "Your watchlist is empty.";
  
  const lines = ["Your watchlist:"];
  for (const p of data.prices) {
    if (p.price) {
      lines.push(`  ${p.symbol}: $${p.price.toFixed(2)}`);
    } else {
      lines.push(`  ${p.symbol}: unavailable`);
    }
  }
  return lines.join('\n');
}

export function formatQuoteHuman(data: any): string {
  return `Quote: ${data.fromAmount} ${data.fromToken} → ~${data.toAmount} ${data.toToken} (est. gas: ${data.estimatedGas})`;
}

export function formatTradeResultHuman(data: any): string {
  if (data.transaction) {
    const t = data.transaction;
    return `Done. ${t.fromAmountFormatted} ${t.fromToken} → ${t.toAmountFormatted} ${t.toToken}. Tx: ${t.txHash.slice(0,10)}...`;
  }
  return data.message || "Trade executed.";
}

export function formatRiskAnalysisHuman(data: any): string {
  const lines = [
    `Portfolio: ${data.totalValue} across ${data.positions} positions`,
    `Diversification: ${data.diversificationScore}/100`,
    `Risk level: ${data.riskLevel}`,
    `Daily P&L: ${data.dailyPnLPositive ? '+' : '-'}${data.dailyPnL}`
  ];
  
  if (data.topHolding) {
    lines.push(`Top holding: ${data.topHolding.symbol} (${data.topHolding.percentage.toFixed(1)}%)`);
  }
  
  if (data.riskFactors && data.riskFactors.length > 0) {
    lines.push("\nRisk flags:");
    for (const f of data.riskFactors) {
      lines.push(`  • ${f}`);
    }
  }
  
  return lines.join('\n');
}

export function formatStopLossHuman(data: any): string {
  if (!data.stopLosses || data.stopLosses.length === 0) {
    return "No active stop-losses. Want to set one?";
  }
  
  const lines = ["Your stop-losses:"];
  for (const sl of data.stopLosses) {
    lines.push(`  ${sl.token}: stop $${sl.stopLossPrice} | target $${sl.takeProfitPrice} | ${sl.amount} ${sl.token}`);
  }
  return lines.join('\n');
}

export function formatRebalanceHuman(data: any): string {
  if (!data.needed) {
    return "Portfolio's within your target allocations. No rebalance needed.";
  }
  
  const lines = ["Rebalance suggested:"];
  for (const s of data.suggestions) {
    const action = s.action === 'buy' ? 'Buy more' : 'Trim';
    lines.push(`  ${action} ${s.symbol}: ${s.currentPct.toFixed(1)}% → ${s.targetPct.toFixed(1)}%`);
  }
  return lines.join('\n');
}

export function formatAlertsHuman(data: any): string {
  if (data.triggered && data.triggered.length > 0) {
    return data.triggered.map((t: string) => `🔔 ${t}`).join('\n');
  }
  return `Checked ${data.active} active alerts. None triggered.`;
}

// Conversation context helpers
export async function updateConversationContext(userId: string, context: Partial<TradingMemory['conversationContext']>): Promise<void> {
  const memory = await getTradingMemory(userId);
  const currentContext = memory.conversationContext || {
    lastTopic: '',
    pendingDecision: '',
    discussedTokens: [],
  };
  
  await setTradingMemory(userId, {
    conversationContext: { ...currentContext, ...context }
  });
}

export async function getConversationContext(userId: string): Promise<TradingMemory['conversationContext']> {
  const memory = await getTradingMemory(userId);
  return memory.conversationContext || {
    lastTopic: '',
    pendingDecision: '',
    discussedTokens: [],
  };
}

// Main conversational handler - replaces command parser
export async function handleConversation(space: any, userId: string, message: string): Promise<void> {
  // Update conversation context
  await updateConversationContext(userId, {
    lastTopic: message.slice(0, 50),
    discussedTokens: extractTokens(message),
  });

  // Send to AI agent with tool access
  const response = await sendAgentMessage(userId, message);
  
  // Send response to user
  await space.send(response);
}

// Proactive monitoring - runs periodically
export async function runProactiveChecks(userId: string): Promise<string[]> {
  const messages: string[] = [];
  
  try {
    // Check stop-losses
    const triggeredStopLosses = await checkStopLosses(userId);
    if (triggeredStopLosses.length > 0) {
      for (const triggered of triggeredStopLosses) {
        messages.push(triggered);
      }
    }
    
    // Check price alerts
    const alertResult = await checkPriceAlerts(userId);
    if (alertResult.success && alertResult.data.triggered.length > 0) {
      for (const triggered of alertResult.data.triggered) {
        messages.push(`🔔 ${triggered}`);
      }
    }
    
    // Check rebalance
    const rebalanceResult = await checkRebalanceNeeded(userId);
    if (rebalanceResult && rebalanceResult.needed) {
      const suggestions = rebalanceResult.suggestions.slice(0, 2); // Top 2
      const summary = suggestions.map(s => 
        `${s.action === 'buy' ? 'Buy' : 'Sell'} ${s.symbol} (${s.currentPct.toFixed(0)}% → ${s.targetPct.toFixed(0)}%)`
      ).join(', ');
      messages.push(`⚖️ Portfolio drifted: ${summary}. Want me to rebalance?`);
    }
    
  } catch (error) {
    console.error('Proactive check error:', error);
  }
  
  return messages;
}

// Extract token symbols from natural language
function extractTokens(text: string): string[] {
  const tokens = Object.keys(B20_TOKENS);
  const found: string[] = [];
  const upper = text.toUpperCase();
  
  for (const token of tokens) {
    if (upper.includes(token) || upper.includes(token.toLowerCase())) {
      found.push(token);
    }
  }
  
  // Also check for USDC
  if (upper.includes('USDC') || upper.includes('usdc')) {
    found.push('USDC');
  }
  
  return [...new Set(found)];
}

// Wallet connection helper
export async function ensureWalletConnected(space: any, userId: string): Promise<boolean> {
  const walletAddress = await getUserWalletAddress(userId);
  
  if (!walletAddress) {
    await space.send("You'll need to connect your wallet first. Send me a message and I'll guide you through it, or use the connect link if you're on desktop.");
    return false;
  }
  
  return true;
}
