import { getPortfolio, getTokenPrice, getTokenChangePct, formatUSD } from './base.js';
import { getTradingMemory, setTradingMemory } from './ai.js';
import type { B20TokenSymbol } from './constants.js';

// Portfolio Analytics
export interface PortfolioAnalytics {
  totalValueUSD: bigint;
  totalPositions: number;
  topHolding: { symbol: string; valueUSD: bigint; percentage: number } | null;
  diversificationScore: number; // 0-100
  riskLevel: 'low' | 'medium' | 'high';
  dailyPnL: bigint; // derived from real on-chain price changes, weighted by holding
  allocation: Array<{ symbol: string; percentage: number; valueUSD: bigint }>;
  recommendation?: string;
}

export async function analyzePortfolio(userId: string): Promise<PortfolioAnalytics> {
  const memory = await getTradingMemory(userId);
  const { getUserWalletAddress } = await import('./wallet.js');
  // A failed resolution (null) means "not provisioned" — analyze nothing rather
  // than silently analyzing a placeholder address as if it were real.
  const walletAddress = (await getUserWalletAddress(userId));

  if (!walletAddress) {
    return {
      totalValueUSD: 0n,
      totalPositions: 0,
      topHolding: null,
      diversificationScore: 0,
      riskLevel: 'low',
      dailyPnL: 0n,
      allocation: [],
      recommendation: 'Wallet is not provisioned yet — wallet provisioning has to succeed before portfolio analytics are available.',
    };
  }

  const portfolio = await getPortfolio(walletAddress as any);

  // Calculate total value and allocation
  let totalValue = 0n;
  const allocation: Array<{ symbol: string; percentage: number; valueUSD: bigint }> = [];

  for (const holding of portfolio) {
    totalValue += holding.valueUSD;
  }

  for (const holding of portfolio) {
    const percentage = totalValue > 0n 
      ? Number((holding.valueUSD * 10000n) / totalValue) / 100 
      : 0;
    allocation.push({
      symbol: holding.symbol,
      percentage,
      valueUSD: holding.valueUSD,
    });
  }

  // Sort by value
  allocation.sort((a, b) => Number(b.valueUSD - a.valueUSD));

  // Top holding
  const topHolding = allocation[0] 
    ? { symbol: allocation[0].symbol, valueUSD: allocation[0].valueUSD, percentage: allocation[0].percentage }
    : null;

  // Diversification score (based on number of positions and concentration)
  const hhi = allocation.reduce((sum, a) => sum + (a.percentage / 100) ** 2, 0);
  const diversificationScore = Math.max(0, Math.round((1 - hhi) * 100));

  // Risk level based on concentration and position count
  let riskLevel: 'low' | 'medium' | 'high' = 'low';
  if (portfolio.length === 1) riskLevel = 'high';
  else if (portfolio.length <= 2 || (topHolding && topHolding.percentage > 70)) riskLevel = 'medium';

// Daily PnL from real on-chain price change (Chainlink round-over-round),
  // weighted by each holding's share of the portfolio.
  let pnlRatioBps = 0n;
  if (totalValue > 0n) {
    for (const holding of portfolio) {
      const changePct = await getTokenChangePct(holding.symbol as B20TokenSymbol);
      if (changePct === null) continue;
      const weightBps = (holding.valueUSD * 10000n) / totalValue;
      pnlRatioBps += (BigInt(Math.round(changePct * 100)) * weightBps) / 10000n;
    }
  }
  const dailyPnL = (totalValue * pnlRatioBps) / 10000n;

  return {
    totalValueUSD: totalValue,
    totalPositions: portfolio.length,
    topHolding,
    diversificationScore,
    riskLevel,
    dailyPnL,
    allocation,
  };
}

// Format analytics for display
export function formatAnalytics(analytics: PortfolioAnalytics): string {
  if (analytics.totalPositions === 0) {
    return '📭 No portfolio data to analyze.';
  }

  const totalValueStr = formatUSD(analytics.totalValueUSD);
  const dailyPnLStr = analytics.dailyPnL >= 0n 
    ? `+${formatUSD(analytics.dailyPnL)}`
    : `-${formatUSD(-analytics.dailyPnL)}`;
  const pnlEmoji = analytics.dailyPnL >= 0n ? '📈' : '📉';

  let message = `📊 **Portfolio Analytics**\n\n`;
  message += `💰 **Total Value**: ${totalValueStr}\n`;
  message += `${pnlEmoji} **Daily P&L**: ${dailyPnLStr}\n`;
  message += `📦 **Positions**: ${analytics.totalPositions}\n`;
  message += `🎯 **Diversification**: ${analytics.diversificationScore}/100\n`;
  message += `⚠️ **Risk Level**: ${analytics.riskLevel.toUpperCase()}\n\n`;

  if (analytics.topHolding) {
    message += `🥇 **Top Holding**: ${analytics.topHolding.symbol} (${analytics.topHolding.percentage.toFixed(1)}%)\n\n`;
  }

  message += `**Allocation**:\n`;
  for (const a of analytics.allocation) {
    const bar = '█'.repeat(Math.max(1, Math.round(a.percentage / 5)));
    message += `  ${a.symbol.padEnd(6)} ${bar} ${a.percentage.toFixed(1)}% (${formatUSD(a.valueUSD)})\n`;
  }

  return message;
}

// Real 24h price changes (Chainlink round-over-round)
export async function getPriceChanges(userId: string): Promise<string> {
  const memory = await getTradingMemory(userId);
  const watchlist = memory.watchlist || ['AAPL', 'NVDA', 'MSFT'];
  
  let message = '📈 **24h Price Changes**\n\n';
  
  for (const symbol of watchlist) {
    const priceData = await getTokenPrice(symbol as any);
    if (priceData) {
      const price = Number(priceData.price) / 10 ** priceData.decimals;
      const change = await getTokenChangePct(symbol as B20TokenSymbol);
      const changeStr = change === null ? 'n/a' : `${change >= 0 ? '+' : ''}${change.toFixed(2)}%`;
      const changeEmoji = change === null ? '⚪' : change >= 0 ? '🟢' : '🔴';
      message += `${changeEmoji} **${symbol}**: $${price.toFixed(2)} (${changeStr})\n`;
    }
  }
  
  return message;
}
