import { getPortfolio, getTokenPrice, getB20Address, formatUSD, formatBalance, B20TokenSymbol, B20_TOKENS } from './base.js';
import { getSwapQuote, getSwapTransaction, parseAmount, formatAmount } from './swap.js';
import { getTradingMemory, setTradingMemory, TradingMemory } from './ai.js';
import { analyzePortfolio, PortfolioAnalytics } from './analytics.js';
import { checkStopLosses, getActiveStopLosses, StopLossConfig } from './automation.js';
import { checkRebalanceNeeded } from './automation.js';
import { getUserWalletAddress, getUserWalletClient } from './wallet.js';
import { addTransaction, Transaction, getTransactionHistory } from './history.js';
import { DEMO_MODE } from './env.js';
import { type Address, createPublicClient, http } from 'viem';
import { base, baseSepolia } from 'viem/chains';
import { BASE_RPC_URL } from './env.js';

// Tool result types
export interface ToolResult<T = any> {
  success: boolean;
  data?: T;
  error?: string;
}

const QUOTE_TTL_MS = 30_000;

// Portfolio & Market Data Tools
export async function get_portfolio(userId: string): Promise<ToolResult> {
  try {
    const walletAddress = await getUserWalletAddress(userId);
    if (!walletAddress) {
      return { success: false, error: 'Wallet not connected. Please connect your wallet first.' };
    }
    
    const portfolio = await getPortfolio(walletAddress);
    if (portfolio.length === 0) {
      return { 
        success: true, 
        data: { 
          holdings: [], 
          totalValue: 0n,
          message: 'Your portfolio is empty. Start trading tokenized stocks!' 
        } 
      };
    }

    let totalValue = 0n;
    const holdings = portfolio.map(h => {
      totalValue += h.valueUSD;
      return {
        symbol: h.symbol,
        name: h.name,
        shares: formatBalance(h.scaledBalance, 18),
        valueUSD: formatUSD(h.valueUSD),
        price: Number(h.price) / 10 ** 8,
        multiplier: Number(h.multiplier) / 10 ** 18,
      };
    });

    return {
      success: true,
      data: { holdings, totalValue: formatUSD(totalValue), totalValueRaw: totalValue }
    };
  } catch (error) {
    return { success: false, error: `Failed to fetch portfolio: ${error}` };
  }
}

export async function get_price(symbol: string): Promise<ToolResult> {
  try {
    const upperSymbol = symbol.toUpperCase() as B20TokenSymbol;
    if (!B20_TOKENS[upperSymbol]) {
      return { 
        success: false, 
        error: `Unknown token: ${symbol}. Available: ${Object.keys(B20_TOKENS).join(', ')}` 
      };
    }

    const priceData = await getTokenPrice(upperSymbol);
    if (!priceData) {
      return { success: false, error: `Could not fetch price for ${symbol}` };
    }

    const price = Number(priceData.price) / 10 ** priceData.decimals;
    const updated = new Date(Number(priceData.updatedAt) * 1000).toLocaleTimeString();

    return {
      success: true,
      data: { symbol: upperSymbol, price, priceRaw: priceData.price, updatedAt: priceData.updatedAt, updated }
    };
  } catch (error) {
    return { success: false, error: `Failed to fetch price: ${error}` };
  }
}

export async function get_watchlist_prices(userId: string): Promise<ToolResult> {
  try {
    const memory = await getTradingMemory(userId);
    const watchlist = memory.watchlist || ['AAPL', 'NVDA', 'MSFT'];
    
    const prices = await Promise.all(
      watchlist.map(async (symbol: string) => {
        const priceData = await getTokenPrice(symbol as B20TokenSymbol);
        if (priceData) {
          const price = Number(priceData.price) / 10 ** priceData.decimals;
          return { symbol, price, priceRaw: priceData.price };
        }
        return { symbol, price: null, priceRaw: null };
      })
    );

    return { success: true, data: { prices } };
  } catch (error) {
    return { success: false, error: `Failed to fetch watchlist prices: ${error}` };
  }
}

// Trading Tools
export async function get_swap_quote(
  userId: string, 
  fromToken: string, 
  toToken: string, 
  amount: string
): Promise<ToolResult> {
  try {
    const walletAddress = await getUserWalletAddress(userId);
    if (!walletAddress) {
      return { success: false, error: 'Wallet not connected.' };
    }

    // Resolve token addresses
    const fromTokenUpper = fromToken.toUpperCase();
    const toTokenUpper = toToken.toUpperCase();
    
    const fromTokenAddress = fromTokenUpper === 'USDC' 
      ? '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' 
      : B20_TOKENS[fromTokenUpper as B20TokenSymbol];
    const toTokenAddress = toTokenUpper === 'USDC' 
      ? '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' 
      : B20_TOKENS[toTokenUpper as B20TokenSymbol];

    if (!fromTokenAddress || !toTokenAddress) {
      return { success: false, error: 'Invalid token(s). Check symbol spelling.' };
    }

    // Determine decimals for amount parsing
    const fromDecimals = fromTokenUpper === 'USDC' ? 6 : 18;
    const parsedAmount = parseAmount(amount, fromDecimals).toString();

    const quote = await getSwapQuote(fromTokenAddress, toTokenAddress, parsedAmount);
    
    if (!quote) {
      return { success: false, error: 'Could not get quote. Please try again.' };
    }

    const toDecimals = toTokenUpper === 'USDC' ? 6 : 18;
    const toAmountFormatted = formatAmount(BigInt(quote.toAmount), toDecimals);
    const fromAmountFormatted = formatAmount(BigInt(quote.fromAmount), fromDecimals);

    // Store quote in user memory for later execution
    const quoteId = `quote_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    const quoteExpiry = Date.now() + QUOTE_TTL_MS;

    const memory = await getTradingMemory(userId);
    (memory as any).pendingQuote = {
      id: quoteId,
      fromToken: fromTokenAddress,
      toToken: toTokenAddress,
      fromAmount: quote.fromAmount,
      toAmount: quote.toAmount,
      fromTokenSymbol: fromTokenUpper,
      toTokenSymbol: toTokenUpper,
      estimatedGas: quote.estimatedGas,
      slippage: 1.0,
      createdAt: Date.now(),
      expiresAt: quoteExpiry,
    };
    await setTradingMemory(userId, memory as any);

    return {
      success: true,
      data: {
        quoteId,
        expiresAt: quoteExpiry,
        fromToken: fromTokenUpper,
        toToken: toTokenUpper,
        fromAmount: fromAmountFormatted,
        toAmount: toAmountFormatted,
        estimatedGas: quote.estimatedGas,
        priceImpact: '~0.1%',
      }
    };
  } catch (error) {
    return { success: false, error: `Failed to get quote: ${error}` };
  }
}

export async function execute_trade(userId: string, quoteId: string): Promise<ToolResult> {
  try {
    const memory = await getTradingMemory(userId);
    const pendingQuote = (memory as any).pendingQuote;

    if (!pendingQuote || pendingQuote.id !== quoteId) {
      return { success: false, error: 'No pending quote found. Get a fresh quote first.' };
    }

    const now = Date.now();
    const quoteAgeMs = pendingQuote.createdAt ? now - pendingQuote.createdAt : 0;
    const quoteRemainingMs = pendingQuote.expiresAt ? pendingQuote.expiresAt - now : -1;

    if (quoteRemainingMs < 0) {
      delete (memory as any).pendingQuote;
      await setTradingMemory(userId, memory as any);
      return { success: false, error: 'Quote expired. Please request a new quote before trading.' };
    }

    if (quoteAgeMs > 5 * 60 * 1000) {
      return { success: false, error: `Stale quote detected. Please request a new quote.` };
    }

    const walletAddress = await getUserWalletAddress(userId);
    if (!walletAddress) {
      return { success: false, error: 'Wallet not connected.' };
    }

    const { fromTokenSymbol, toTokenSymbol, fromAmount, toAmount, fromToken, toToken } = pendingQuote;
    const fromDecimals = fromTokenSymbol === 'USDC' ? 6 : 18;
    const toDecimals = toTokenSymbol === 'USDC' ? 6 : 18;
    const fromAmountBigInt = BigInt(fromAmount);
    const toAmountBigInt = BigInt(toAmount);

    const parsedFromAmount = fromAmountBigInt.toString();
    const quotedToAmount = toAmountBigInt.toString();

    const freshQuote = await getSwapQuote(fromToken, toToken, parsedFromAmount, pendingQuote.slippage || 1.0);
    if (!freshQuote) {
      delete (memory as any).pendingQuote;
      await setTradingMemory(userId, memory as any);
      return { success: false, error: 'Could not refresh swap quote before execution. Try again.' };
    }

    const refreshedToAmount = BigInt(freshQuote.toAmount);
    if (refreshedToAmount <= 0n) {
      return { success: false, error: 'Refreshed quote returned zero output. Execution aborted.' };
    }

    const originalReceiveUnits = Number(toAmountBigInt) / 10 ** toDecimals;
    const refreshedReceiveUnits = Number(refreshedToAmount) / 10 ** toDecimals;
    const slippageBps = originalReceiveUnits > 0 ? ((originalReceiveUnits - refreshedReceiveUnits) / originalReceiveUnits) * 10_000 : 0;

    if (slippageBps > 250) {
      delete (memory as any).pendingQuote;
      await setTradingMemory(userId, memory as any);
      return {
        success: false,
        error: `Execution aborted: refreshed quote moved ${slippageBps.toFixed(1)} bps against you. Request a new quote.`,
      };
    }
    if (DEMO_MODE === 'true') {
      await new Promise(r => setTimeout(r, 1500));

      const tx: Omit<Transaction, 'id'> = {
        timestamp: Date.now(),
        type: fromTokenSymbol === 'USDC' ? 'buy' : 'sell',
        fromToken: fromTokenSymbol,
        toToken: toTokenSymbol,
        fromAmount: BigInt(fromAmount),
        toAmount: BigInt(toAmount),
        fromAmountFormatted: formatAmount(BigInt(fromAmount), fromTokenSymbol === 'USDC' ? 6 : 18),
        toAmountFormatted: formatAmount(BigInt(toAmount), toTokenSymbol === 'USDC' ? 6 : 18),
        priceUSD: Number(toAmount) / Number(fromAmount),
        txHash: `0x${Math.random().toString(16).slice(2).padStart(62, '0')}`,
        status: 'confirmed',
        gasUsed: BigInt(pendingQuote.estimatedGas || 150000),
        gasPrice: 1000000000n,
      };

      await addTransaction(userId, tx);
      delete (memory as any).pendingQuote;
      await setTradingMemory(userId, memory as any);

      return {
        success: true,
        data: {
          transaction: tx,
          message: `Trade executed (demo): ${tx.fromAmountFormatted} ${tx.fromToken} → ${tx.toAmountFormatted} ${tx.toToken}`
        }
      };
    }

    // ─── Production mode: real onchain execution ───
    const walletClient = await getUserWalletClient(userId);
    if (!walletClient) {
      return { success: false, error: 'Could not create wallet client. Check Privy configuration.' };
    }

    // Get swap transaction data from 1inch
    const swapTx = await getSwapTransaction(
      fromToken,
      toToken,
      freshQuote.fromAmount || fromAmount,
      walletAddress,
      pendingQuote.slippage || 1.0
    );

    if (!swapTx) {
      delete (memory as any).pendingQuote;
      await setTradingMemory(userId, memory as any);
      return { success: false, error: 'Could not get swap transaction data from 1inch.' };
    }

    // Submit transaction via wallet client
    const txHash = await walletClient.sendTransaction({
      account: walletAddress,
      to: swapTx.to as Address,
      data: swapTx.data as `0x${string}`,
      value: BigInt(swapTx.value || '0'),
      gas: BigInt(swapTx.gas || '200000'),
      gasPrice: BigInt(swapTx.gasPrice || '1000000000'),
      chain: walletClient.chain,
    });

    // Wait for transaction confirmation
    const chain = BASE_RPC_URL.includes('sepolia') ? baseSepolia : base;
    const publicClient = createPublicClient({ chain, transport: http(BASE_RPC_URL) });
    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });

    const effectiveToAmount = freshQuote.toAmount || toAmount;
    const effectiveFromAmount = freshQuote.fromAmount || fromAmount;

    const tx: Omit<Transaction, 'id'> = {
      timestamp: Date.now(),
      type: fromTokenSymbol === 'USDC' ? 'buy' : 'sell',
      fromToken: fromTokenSymbol,
      toToken: toTokenSymbol,
      fromAmount: BigInt(effectiveFromAmount),
      toAmount: BigInt(effectiveToAmount),
      fromAmountFormatted: formatAmount(BigInt(effectiveFromAmount), fromDecimals),
      toAmountFormatted: formatAmount(BigInt(effectiveToAmount), toDecimals),
      priceUSD: Number(effectiveToAmount) / Number(effectiveFromAmount),
      txHash: txHash,
      status: receipt.status === 'success' ? 'confirmed' : 'failed',
      gasUsed: receipt.gasUsed || BigInt(pendingQuote.estimatedGas || 150000),
      gasPrice: receipt.effectiveGasPrice || 1000000000n,
    };

    await addTransaction(userId, tx);
    delete (memory as any).pendingQuote;
    await setTradingMemory(userId, memory as any);

    if (tx.status === 'failed') {
      return {
        success: false,
        error: `Transaction failed onchain. Tx: ${txHash}`,
        data: { transaction: tx }
      };
    }

    return {
      success: true,
      data: {
        transaction: tx,
        message: `Trade executed onchain: ${tx.fromAmountFormatted} ${tx.fromToken} → ${tx.toAmountFormatted} ${tx.toToken}. Tx: ${txHash.slice(0, 10)}...`
      }
    };
  } catch (error) {
    return { success: false, error: `Trade execution failed: ${error}` };
  }
}

export async function check_balance(userId: string, token: string): Promise<ToolResult> {
  try {
    const walletAddress = await getUserWalletAddress(userId);
    if (!walletAddress) {
      return { success: false, error: 'Wallet not connected.' };
    }

    const upperToken = token.toUpperCase();
    const isKnownToken = upperToken in B20_TOKENS || upperToken === 'USDC';
    if (!isKnownToken) {
      return { success: false, error: `Unknown token: ${token}` };
    }

    // This would call the actual balance check
    // For now, return from portfolio
    const portfolio = await getPortfolio(walletAddress);
    const holding = portfolio.find(h => h.symbol === upperToken);
    
    if (holding) {
      return {
        success: true,
        data: {
          symbol: upperToken,
          balance: formatBalance(holding.scaledBalance, 18),
          balanceRaw: holding.scaledBalance,
          valueUSD: formatUSD(holding.valueUSD)
        }
      };
    }

    return {
      success: true,
      data: { symbol: upperToken, balance: '0', balanceRaw: 0n, valueUSD: '$0' }
    };
  } catch (error) {
    return { success: false, error: `Failed to check balance: ${error}` };
  }
}

// Automation & Risk Tools
export async function check_stop_losses(userId: string): Promise<ToolResult> {
  try {
    const triggered = await checkStopLosses(userId);
    return {
      success: true,
      data: { triggered, count: triggered.length }
    };
  } catch (error) {
    return { success: false, error: `Failed to check stop losses: ${error}` };
  }
}

export async function get_active_stop_losses(userId: string): Promise<ToolResult> {
  try {
    const stopLosses = await getActiveStopLosses(userId);
    return {
      success: true,
      data: { stopLosses }
    };
  } catch (error) {
    return { success: false, error: `Failed to get stop losses: ${error}` };
  }
}

export async function create_stop_loss(
  userId: string, 
  token: string, 
  stopLossPrice: number, 
  takeProfitPrice: number, 
  amount: string
): Promise<ToolResult> {
  try {
    const upperToken = token.toUpperCase();
    if (!B20_TOKENS[upperToken as B20TokenSymbol]) {
      return { success: false, error: `Unknown token: ${token}` };
    }

    const { createStopLoss } = await import('./automation.js');
    await createStopLoss(userId, { token: upperToken, stopLossPrice, takeProfitPrice, amount });

    return {
      success: true,
      data: { 
        token: upperToken, 
        stopLossPrice, 
        takeProfitPrice, 
        amount,
        message: `Stop-loss created for ${upperToken}: stop at $${stopLossPrice}, target at $${takeProfitPrice}`
      }
    };
  } catch (error) {
    return { success: false, error: `Failed to create stop-loss: ${error}` };
  }
}

// Named export for proactive monitoring
export async function checkPriceAlerts(userId: string): Promise<ToolResult> {
  return check_price_alerts(userId);
}

export async function check_price_alerts(userId: string): Promise<ToolResult> {
  try {
    const memory = await getTradingMemory(userId);
    const alerts = memory.activeStrategies
      .filter((s: any) => s.type === 'price_alert' && s.active);

    const triggered: string[] = [];
    
    for (const alert of alerts) {
      const { token, direction, price } = alert.params;
      const priceData = await getTokenPrice(token as B20TokenSymbol);
      if (!priceData) continue;
      
      const currentPrice = Number(priceData.price) / 10 ** priceData.decimals;
      
      if ((direction === 'above' && currentPrice >= price) || 
          (direction === 'below' && currentPrice <= price)) {
        triggered.push(`${token} hit $${currentPrice.toFixed(2)} (alert: ${direction} $${price})`);
        alert.active = false;
      }
    }

    if (triggered.length > 0) {
      await setTradingMemory(userId, { activeStrategies: memory.activeStrategies });
    }

    return {
      success: true,
      data: { triggered, count: triggered.length, active: alerts.length }
    };
  } catch (error) {
    return { success: false, error: `Failed to check price alerts: ${error}` };
  }
}

export async function check_rebalance_needed(userId: string): Promise<ToolResult> {
  try {
    const result = await checkRebalanceNeeded(userId);
    return {
      success: true,
      data: result || { needed: false, suggestions: [] }
    };
  } catch (error) {
    return { success: false, error: `Failed to check rebalance: ${error}` };
  }
}

export async function analyze_portfolio_risk(userId: string): Promise<ToolResult> {
  try {
    const analytics = await analyzePortfolio(userId);
    
    const riskFactors: string[] = [];
    if (analytics.riskLevel === 'high') riskFactors.push('High concentration in single position');
    if (analytics.riskLevel === 'medium') riskFactors.push('Moderate concentration risk');
    if (analytics.totalPositions < 3) riskFactors.push('Few positions - low diversification');
    if (analytics.topHolding && analytics.topHolding.percentage > 50) {
      riskFactors.push(`Top holding (${analytics.topHolding.symbol}) exceeds 50% of portfolio`);
    }

    return {
      success: true,
      data: {
        totalValue: formatUSD(analytics.totalValueUSD),
        positions: analytics.totalPositions,
        diversificationScore: analytics.diversificationScore,
        riskLevel: analytics.riskLevel,
        topHolding: analytics.topHolding,
        allocation: analytics.allocation,
        riskFactors,
        dailyPnL: formatUSD(analytics.dailyPnL >= 0n ? analytics.dailyPnL : -analytics.dailyPnL),
        dailyPnLPositive: analytics.dailyPnL >= 0n,
      }
    };
  } catch (error) {
    return { success: false, error: `Failed to analyze risk: ${error}` };
  }
}

// Memory & Context Tools
export async function get_user_memory(userId: string): Promise<ToolResult> {
  try {
    const memory = await getTradingMemory(userId);
    return {
      success: true,
      data: {
        watchlist: memory.watchlist,
        riskParams: memory.riskParams,
        activeStrategies: memory.activeStrategies,
        preferences: memory.preferences,
        transactionCount: (memory as any).transactionHistory?.length || 0,
      }
    };
  } catch (error) {
    return { success: false, error: `Failed to get memory: ${error}` };
  }
}

export async function update_user_memory(userId: string, updates: Partial<TradingMemory>): Promise<ToolResult> {
  try {
    await setTradingMemory(userId, updates);
    return { success: true, data: { message: 'Memory updated successfully' } };
  } catch (error) {
    return { success: false, error: `Failed to update memory: ${error}` };
  }
}

export async function add_to_watchlist(userId: string, symbol: string): Promise<ToolResult> {
  try {
    const upperSymbol = symbol.toUpperCase();
    if (!B20_TOKENS[upperSymbol as B20TokenSymbol]) {
      return { success: false, error: `Unknown token: ${symbol}` };
    }

    const memory = await getTradingMemory(userId);
    if (!memory.watchlist.includes(upperSymbol)) {
      memory.watchlist.push(upperSymbol);
      await setTradingMemory(userId, { watchlist: memory.watchlist });
      return { success: true, data: { message: `Added ${upperSymbol} to watchlist` } };
    }
    return { success: true, data: { message: `${upperSymbol} already in watchlist` } };
  } catch (error) {
    return { success: false, error: `Failed to add to watchlist: ${error}` };
  }
}

export async function remove_from_watchlist(userId: string, symbol: string): Promise<ToolResult> {
  try {
    const upperSymbol = symbol.toUpperCase();
    const memory = await getTradingMemory(userId);
    memory.watchlist = memory.watchlist.filter(s => s !== upperSymbol);
    await setTradingMemory(userId, { watchlist: memory.watchlist });
    return { success: true, data: { message: `Removed ${upperSymbol} from watchlist` } };
  } catch (error) {
    return { success: false, error: `Failed to remove from watchlist: ${error}` };
  }
}

// Portfolio Digest — comprehensive summary for on-demand or proactive delivery
export async function get_portfolio_digest(userId: string): Promise<ToolResult> {
  try {
    const walletAddress = await getUserWalletAddress(userId);
    if (!walletAddress) {
      return { success: false, error: 'Wallet not connected.' };
    }

    // Gather all data in parallel
    const [portfolio, analytics, memory, history] = await Promise.all([
      getPortfolio(walletAddress),
      analyzePortfolio(userId),
      getTradingMemory(userId),
      getTransactionHistory(userId, 5),
    ]);

    if (portfolio.length === 0) {
      return {
        success: true,
        data: {
          digest: 'Your portfolio is empty. Start trading tokenized stocks on Base!',
          totalValue: '$0',
          positions: 0,
        }
      };
    }

    // Build digest sections
    const sections: string[] = [];

    // 1. Portfolio overview
    const totalValue = formatUSD(analytics.totalValueUSD);
    const pnlSign = analytics.dailyPnL >= 0n ? '+' : '-';
    const pnlAbs = analytics.dailyPnL >= 0n ? analytics.dailyPnL : -analytics.dailyPnL;
    const pnlEmoji = analytics.dailyPnL >= 0n ? '📈' : '📉';
    sections.push(
      `💰 Portfolio: ${totalValue} | ${pnlEmoji} 24h P&L: ${pnlSign}${formatUSD(pnlAbs)} | 📦 ${analytics.totalPositions} positions`
    );

    // 2. Allocation
    if (analytics.allocation.length > 0) {
      const allocLines = analytics.allocation.map(a => {
        const bar = '█'.repeat(Math.max(1, Math.round(a.percentage / 5)));
        return `  ${a.symbol.padEnd(6)} ${bar} ${a.percentage.toFixed(1)}%`;
      });
      sections.push('📊 Allocation:\n' + allocLines.join('\n'));
    }

    // 3. Risk
    sections.push(
      `⚠️ Risk: ${analytics.riskLevel.toUpperCase()} | Diversification: ${analytics.diversificationScore}/100`
    );

    // 4. Active strategies
    const activeStrategies = memory.activeStrategies.filter((s: any) => s.active);
    if (activeStrategies.length > 0) {
      const strategyLines = activeStrategies.map((s: any) => {
        if (s.type === 'dca') {
          const p = s.params;
          const lastExec = p.lastExecuted ? new Date(p.lastExecuted).toLocaleDateString() : 'never';
          return `  🔄 DCA: ${p.amount} USDC → ${p.token} ${p.frequency} (last: ${lastExec})`;
        }
        if (s.type === 'stop_loss') {
          const p = s.params;
          return `  🛑 Stop-loss: ${p.token} stop $${p.stopLossPrice} / target $${p.takeProfitPrice}`;
        }
        if (s.type === 'price_alert') {
          const p = s.params;
          return `  🔔 Alert: ${p.token} ${p.direction} $${p.price}`;
        }
        if (s.type === 'rebalance') {
          const p = s.params;
          const targets = Object.entries(p.targetAllocation || {}).map(([k, v]) => `${k}:${v}%`).join(', ');
          return `  ⚖️ Rebalance: ${targets} (±${p.tolerance || 5}%)`;
        }
        return `  ${s.type}: active`;
      });
      sections.push(`🤖 Active strategies (${activeStrategies.length}):\n${strategyLines.join('\n')}`);
    }

    // 5. Recent transactions
    if (history.length > 0) {
      const txLines = history.slice(0, 3).map((tx: any) => {
        const date = new Date(tx.timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        const emoji = tx.type === 'buy' ? '🟢' : tx.type === 'sell' ? '🔴' : '🔵';
        return `  ${emoji} ${date} ${tx.type.toUpperCase()} ${tx.fromAmountFormatted} ${tx.fromToken} → ${tx.toAmountFormatted} ${tx.toToken}`;
      });
      sections.push(`📜 Recent trades:\n${txLines.join('\n')}`);
    }

    // 6. Watchlist
    if (memory.watchlist.length > 0) {
      sections.push(`👁️ Watchlist: ${memory.watchlist.join(', ')}`);
    }

    const digest = sections.join('\n\n');

    return {
      success: true,
      data: {
        digest,
        totalValue,
        positions: analytics.totalPositions,
        riskLevel: analytics.riskLevel,
        activeStrategies: activeStrategies.length,
        recentTransactions: history.length,
      }
    };
  } catch (error) {
    return { success: false, error: `Failed to generate digest: ${error}` };
  }
}

// Tool definitions for Letta function calling
export const TOOL_DEFINITIONS = [
  {
    name: 'get_portfolio',
    description: 'Get user\'s complete portfolio with holdings, values, and total',
    parameters: {
      type: 'object',
      properties: {
        userId: { type: 'string', description: 'User ID' }
      },
      required: ['userId']
    }
  },
  {
    name: 'get_price',
    description: 'Get real-time price for a tokenized stock',
    parameters: {
      type: 'object',
      properties: {
        symbol: { type: 'string', description: 'Token symbol (e.g., AAPL, NVDA, MSFT)' }
      },
      required: ['symbol']
    }
  },
  {
    name: 'get_watchlist_prices',
    description: 'Get prices for all tokens in user\'s watchlist',
    parameters: {
      type: 'object',
      properties: {
        userId: { type: 'string', description: 'User ID' }
      },
      required: ['userId']
    }
  },
  {
    name: 'get_swap_quote',
    description: 'Get a swap quote for trading between tokens',
    parameters: {
      type: 'object',
      properties: {
        userId: { type: 'string', description: 'User ID' },
        fromToken: { type: 'string', description: 'Token to sell (e.g., USDC, AAPL)' },
        toToken: { type: 'string', description: 'Token to buy (e.g., AAPL, USDC)' },
        amount: { type: 'string', description: 'Amount to sell (e.g., "100", "0.5")' }
      },
      required: ['userId', 'fromToken', 'toToken', 'amount']
    }
  },
  {
    name: 'execute_trade',
    description: 'Execute a previously quoted trade',
    parameters: {
      type: 'object',
      properties: {
        userId: { type: 'string', description: 'User ID' },
        quoteId: { type: 'string', description: 'Quote ID from get_swap_quote' }
      },
      required: ['userId', 'quoteId']
    }
  },
  {
    name: 'check_balance',
    description: 'Check balance of a specific token',
    parameters: {
      type: 'object',
      properties: {
        userId: { type: 'string', description: 'User ID' },
        token: { type: 'string', description: 'Token symbol' }
      },
      required: ['userId', 'token']
    }
  },
  {
    name: 'check_stop_losses',
    description: 'Check if any stop-loss or take-profit orders have been triggered',
    parameters: {
      type: 'object',
      properties: {
        userId: { type: 'string', description: 'User ID' }
      },
      required: ['userId']
    }
  },
  {
    name: 'get_active_stop_losses',
    description: 'Get all active stop-loss/take-profit orders',
    parameters: {
      type: 'object',
      properties: {
        userId: { type: 'string', description: 'User ID' }
      },
      required: ['userId']
    }
  },
  {
    name: 'create_stop_loss',
    description: 'Create a stop-loss and take-profit order',
    parameters: {
      type: 'object',
      properties: {
        userId: { type: 'string', description: 'User ID' },
        token: { type: 'string', description: 'Token symbol' },
        stopLossPrice: { type: 'number', description: 'Stop loss price in USD' },
        takeProfitPrice: { type: 'number', description: 'Take profit price in USD' },
        amount: { type: 'string', description: 'Amount of token to sell' }
      },
      required: ['userId', 'token', 'stopLossPrice', 'takeProfitPrice', 'amount']
    }
  },
  {
    name: 'check_price_alerts',
    description: 'Check if any price alerts have been triggered',
    parameters: {
      type: 'object',
      properties: {
        userId: { type: 'string', description: 'User ID' }
      },
      required: ['userId']
    }
  },
  {
    name: 'check_rebalance_needed',
    description: 'Check if portfolio rebalancing is needed based on target allocations',
    parameters: {
      type: 'object',
      properties: {
        userId: { type: 'string', description: 'User ID' }
      },
      required: ['userId']
    }
  },
  {
    name: 'analyze_portfolio_risk',
    description: 'Analyze portfolio risk: diversification, concentration, VaR, risk level',
    parameters: {
      type: 'object',
      properties: {
        userId: { type: 'string', description: 'User ID' }
      },
      required: ['userId']
    }
  },
  {
    name: 'get_user_memory',
    description: 'Get user preferences, risk params, watchlist, active strategies',
    parameters: {
      type: 'object',
      properties: {
        userId: { type: 'string', description: 'User ID' }
      },
      required: ['userId']
    }
  },
  {
    name: 'update_user_memory',
    description: 'Update user preferences, risk params, or other settings',
    parameters: {
      type: 'object',
      properties: {
        userId: { type: 'string', description: 'User ID' },
        updates: { type: 'object', description: 'Memory updates to apply' }
      },
      required: ['userId', 'updates']
    }
  },
  {
    name: 'add_to_watchlist',
    description: 'Add a token to user\'s watchlist',
    parameters: {
      type: 'object',
      properties: {
        userId: { type: 'string', description: 'User ID' },
        symbol: { type: 'string', description: 'Token symbol' }
      },
      required: ['userId', 'symbol']
    }
  },
  {
    name: 'remove_from_watchlist',
    description: 'Remove a token from user\'s watchlist',
    parameters: {
      type: 'object',
      properties: {
        userId: { type: 'string', description: 'User ID' },
        symbol: { type: 'string', description: 'Token symbol' }
      },
      required: ['userId', 'symbol']
    }
  },
  {
    name: 'get_portfolio_digest',
    description: 'Get a comprehensive portfolio digest: total value, P&L, allocation, risk, active strategies, recent trades, and watchlist',
    parameters: {
      type: 'object',
      properties: {
        userId: { type: 'string', description: 'User ID' }
      },
      required: ['userId']
    }
  }
] as const;

export type ToolName = typeof TOOL_DEFINITIONS[number]['name'];

// Tool executor - maps tool names to functions
export async function executeTool(name: ToolName, args: Record<string, any>): Promise<ToolResult> {
  switch (name) {
    case 'get_portfolio':
      return get_portfolio(args.userId);
    case 'get_price':
      return get_price(args.symbol);
    case 'get_watchlist_prices':
      return get_watchlist_prices(args.userId);
    case 'get_swap_quote':
      return get_swap_quote(args.userId, args.fromToken, args.toToken, args.amount);
    case 'execute_trade':
      return execute_trade(args.userId, args.quoteId);
    case 'check_balance':
      return check_balance(args.userId, args.token);
    case 'check_stop_losses':
      return check_stop_losses(args.userId);
    case 'get_active_stop_losses':
      return get_active_stop_losses(args.userId);
    case 'create_stop_loss':
      return create_stop_loss(args.userId, args.token, args.stopLossPrice, args.takeProfitPrice, args.amount);
    case 'check_price_alerts':
      return check_price_alerts(args.userId);
    case 'check_rebalance_needed':
      return check_rebalance_needed(args.userId);
    case 'analyze_portfolio_risk':
      return analyze_portfolio_risk(args.userId);
    case 'get_user_memory':
      return get_user_memory(args.userId);
    case 'update_user_memory':
      return update_user_memory(args.userId, args.updates);
    case 'add_to_watchlist':
      return add_to_watchlist(args.userId, args.symbol);
    case 'remove_from_watchlist':
      return remove_from_watchlist(args.userId, args.symbol);
    case 'get_portfolio_digest':
      return get_portfolio_digest(args.userId);
    default:
      return { success: false, error: `Unknown tool: ${name}` };
  }
}
