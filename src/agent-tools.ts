import { getPortfolio, getTokenPrice, getB20Address, formatUSD, formatBalance, B20TokenSymbol, B20_TOKENS } from './base.js';
import { getSwapQuote, parseAmount, formatAmount } from './swap.js';
import { getTradingMemory, setTradingMemory, TradingMemory } from './letta.js';
import { analyzePortfolio, PortfolioAnalytics } from './analytics.js';
import { checkStopLosses, getActiveStopLosses, StopLossConfig } from './automation.js';
import { checkRebalanceNeeded } from './automation.js';
import { getUserWalletAddress } from './wallet.js';
import { addTransaction, Transaction } from './history.js';
import { type Address } from 'viem';

// Tool result types
export interface ToolResult<T = any> {
  success: boolean;
  data?: T;
  error?: string;
}

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

    // Store quote ID for execution (in production, use a proper quote store)
    const quoteId = `quote_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    
    // Store quote in user memory for later execution
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
    };
    await setTradingMemory(userId, memory as any);

    return {
      success: true,
      data: {
        quoteId,
        fromToken: fromTokenUpper,
        toToken: toTokenUpper,
        fromAmount: fromAmountFormatted,
        toAmount: toAmountFormatted,
        estimatedGas: quote.estimatedGas,
        priceImpact: '~0.1%', // Would come from quote in production
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

    const walletAddress = await getUserWalletAddress(userId);
    if (!walletAddress) {
      return { success: false, error: 'Wallet not connected.' };
    }

    // In demo mode, simulate the trade
    const { fromTokenSymbol, toTokenSymbol, fromAmount, toAmount } = pendingQuote;
    
    // Simulate trade execution
    await new Promise(r => setTimeout(r, 1500));

    // Record transaction
    const tx: Omit<Transaction, 'id'> = {
      timestamp: Date.now(),
      type: fromTokenSymbol === 'USDC' ? 'buy' : 'sell',
      fromToken: fromTokenSymbol,
      toToken: toTokenSymbol,
      fromAmount: BigInt(fromAmount),
      toAmount: BigInt(toAmount),
      fromAmountFormatted: formatAmount(BigInt(fromAmount), fromTokenSymbol === 'USDC' ? 6 : 18),
      toAmountFormatted: formatAmount(BigInt(toAmount), toTokenSymbol === 'USDC' ? 6 : 18),
      priceUSD: Number(toAmount) / Number(fromAmount), // Simplified
      txHash: `0x${'demo'.padStart(62, '0')}`,
      status: 'confirmed',
      gasUsed: BigInt(pendingQuote.estimatedGas || 150000),
      gasPrice: 1000000000n,
    };
    
    await addTransaction(userId, tx);

    // Clear pending quote
    delete (memory as any).pendingQuote;
    await setTradingMemory(userId, memory as any);

    return {
      success: true,
      data: {
        transaction: tx,
        message: `Trade executed: ${tx.fromAmountFormatted} ${tx.fromToken} → ${tx.toAmountFormatted} ${tx.toToken}`
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
    default:
      return { success: false, error: `Unknown tool: ${name}` };
  }
}
