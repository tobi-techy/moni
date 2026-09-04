import { LETTA_API_KEY, LETTA_BASE_URL, DEMO_MODE } from './env.js';
import { TOOL_DEFINITIONS, ToolName } from './agent-tools.js';
import { B20_TOKENS } from './constants.js';

// Letta Agent Types
export interface LettaAgent {
  id: string;
  name: string;
  persona: string;
  human: string;
  system: string;
  created_at: string;
  tools?: any[];
  tool_rules?: string[];
}

export interface LettaMessage {
  role: 'user' | 'assistant' | 'system' | 'function' | 'tool';
  content: string;
  name?: string;
  tool_call_id?: string;
  tool_calls?: Array<{
    id: string;
    type: 'function';
    function: { name: string; arguments: string };
  }>;
}

export interface LettaResponse {
  messages: LettaMessage[];
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

// Enhanced System Prompt for Financial Expert & Auditor Persona
const MONI_SYSTEM_PROMPT = `You are Moni, a CFA-level portfolio manager and auditor specializing in Coinbase Tokenized Stocks (B20 standard) on Base network. You operate via iMessage with a conversational, human tone.

## CORE IDENTITY
- **Expertise**: 15+ years institutional trading, risk management, portfolio construction
- **Role**: Trusted advisor, not a button-pusher. You reason, explain, and flag risks.
- **Tone**: Natural, concise, human. No markdown unless asked. No robotic formatting.
- **Fiduciary mindset**: User's interests first. Flag concentration, fees, tax implications, compliance.

## CAPABILITIES (via tools)
1. **Portfolio & Market Data**: get_portfolio, get_price, get_watchlist_prices, check_balance
2. **Trading**: get_swap_quote, execute_trade (always confirm first)
3. **Risk & Automation**: check_stop_losses, get_active_stop_losses, create_stop_loss, check_price_alerts, check_rebalance_needed, analyze_portfolio_risk
4. **Memory & Context**: get_user_memory, update_user_memory, add_to_watchlist, remove_from_watchlist

## REASONING APPROACH
- **Think step-by-step**: User says "buy apple" → check portfolio → check balance → get quote → confirm → execute
- **Explain your reasoning**: "You're 80% in NVDA. Adding more increases concentration risk. Want me to show diversification options?"
- **Proactive flags**: Stop-losses hit, rebalance drift, position limits, correlation risks
- **Ask clarifying questions**: "How much USDC do you want to allocate?" not "Use /buy command"

## COMMUNICATION STYLE
✅ "Your AAPL position is up 12% this week — worth $22k now. Total portfolio $47k."
❌ "📊 **Portfolio**\n\n**AAPL**\n  💎 100 shares\n  💰 $22,000"

✅ "That'd put you at 85% in tech. Your risk limit is 70%. Want to trim NVDA first?"
❌ "❌ Error: Max position size exceeded. Use /rebalance command."

✅ "I see your stop-loss for AAPL at $180 triggered. Sold 10 shares at $179.50. Want to set a new one?"
❌ "🔴 STOP LOSS TRIGGERED: AAPL at $179.50"

## CONSTRAINTS & COMPLIANCE
- **Never execute without explicit confirmation** (unless auto-trade enabled with user-set limits)
- **Respect risk parameters**: max position size, max daily loss, sector limits
- **Base mainnet only**: Coinbase B20 tokens (AAPL, NVDA, MSFT, GOOGL, META, TSLA, AMZN, COIN, INTC, MSTR, CRCL, SNDK, SPCX)
- **US users not supported** (compliance) — demo mode simulates
- **Tax awareness**: Flag wash sales, short-term vs long-term, cost basis tracking
- **No financial advice disclaimer**: You're an expert assistant, not a licensed advisor

## TOOL USAGE RULES
- Chain tools naturally: portfolio → risk analysis → suggestion
- Batch related calls: get prices for multiple tokens in one turn
- Cache results within a conversation turn
- If tool fails, explain why and offer alternative

## CONVERSATION MEMORY
- Remember user preferences, discussed topics, pending decisions
- Recall: "Last time you mentioned reducing NVDA exposure..."
- Track: risk tolerance changes, new watchlist additions, strategy adjustments`;

const MONI_PERSONA = `I'm Moni, your portfolio manager and auditor for tokenized stocks on Base. I help you trade, manage risk, and build wealth — conversationally. No commands, just talk to me.`;

const MONI_HUMAN_TEMPLATE = (userId: string) => `User ID: ${userId}. They trade Coinbase Tokenized Stocks (B20) on Base via iMessage. They want a conversational expert who reasons about their portfolio, flags risks, executes trades on confirmation, and proactively monitors their positions. They may be new to DeFi or experienced — adapt accordingly.`;

// Letta API Client
class LettaClient {
  private baseUrl: string;
  private apiKey: string;

  constructor() {
    this.baseUrl = LETTA_BASE_URL;
    this.apiKey = LETTA_API_KEY;
  }

  private async request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    if (DEMO_MODE === 'true') {
      return this.getMockResponse<T>(endpoint, options);
    }

    const response = await fetch(`${this.baseUrl}${endpoint}`, {
      ...options,
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });

    if (!response.ok) {
      throw new Error(`Letta API error: ${response.status} ${response.statusText}`);
    }

    return response.json() as Promise<T>;
  }

  private getMockResponse<T>(endpoint: string, options: RequestInit = {}): T {
    if (endpoint.includes('/agents') && options.method === 'POST') {
      return {
        id: 'demo-agent-id',
        name: 'Moni Trading Agent',
        persona: MONI_PERSONA,
        human: MONI_HUMAN_TEMPLATE('demo'),
        system: MONI_SYSTEM_PROMPT,
        tools: TOOL_DEFINITIONS,
        tool_rules: [
          'Always use tools for portfolio, trading, and risk data — never hallucinate',
          'Chain tools for multi-step reasoning (portfolio → analyze → suggest)',
          'Confirm before execute_trade',
          'Explain tool results in natural language'
        ],
        created_at: new Date().toISOString(),
      } as T;
    }
    if (endpoint.includes('/messages')) {
      // In demo mode, we'll handle tool calling manually in the conversation handler
      return {
        messages: [
          { role: 'assistant', content: 'I\'ll help you with that. Let me check your portfolio first.' }
        ]
      } as T;
    }
    if (endpoint.includes('/memory')) {
      return {
        trading: {
          watchlist: ['AAPL', 'NVDA', 'MSFT'],
          riskParams: { maxPositionSizeUSD: 10000, maxDailyLossUSD: 1000, autoTradeEnabled: false },
          activeStrategies: [],
          preferences: { defaultSlippage: 1.0, preferredTokens: ['AAPL', 'NVDA', 'MSFT'], notificationLevel: 'trades' },
          transactionHistory: [],
        }
      } as T;
    }
    return {} as T;
  }

  // Create or get agent for a user
  async getOrCreateAgent(userId: string): Promise<LettaAgent> {
    const agentConfig = {
      name: `Moni Trading Agent - ${userId}`,
      persona: MONI_PERSONA,
      human: MONI_HUMAN_TEMPLATE(userId),
      system: MONI_SYSTEM_PROMPT,
      tools: TOOL_DEFINITIONS,
      tool_rules: [
        'Always use tools for portfolio, trading, and risk data — never hallucinate',
        'Chain tools for multi-step reasoning (portfolio → analyze → suggest)',
        'Confirm before execute_trade',
        'Explain tool results in natural language',
        'Flag risks: concentration, correlation, leverage, fees, tax',
        'Ask clarifying questions when intent is ambiguous'
      ],
    };

    return this.request<LettaAgent>('/v1/agents/', {
      method: 'POST',
      body: JSON.stringify(agentConfig),
    });
  }

  // Send message to agent with tool support
  async sendMessage(agentId: string, message: string, tools?: any[]): Promise<LettaResponse> {
    return this.request<LettaResponse>(`/v1/agents/${agentId}/messages`, {
      method: 'POST',
      body: JSON.stringify({
        messages: [{ role: 'user', content: message }],
        tools: tools || TOOL_DEFINITIONS,
        tool_choice: 'auto',
      }),
    });
  }

  // Send message with tool results (for multi-turn tool calling)
  async sendMessageWithTools(agentId: string, messages: LettaMessage[]): Promise<LettaResponse> {
    return this.request<LettaResponse>(`/v1/agents/${agentId}/messages`, {
      method: 'POST',
      body: JSON.stringify({
        messages,
        tools: TOOL_DEFINITIONS,
        tool_choice: 'auto',
      }),
    });
  }

  // Get agent memory
  async getMemory(agentId: string): Promise<any> {
    return this.request(`/v1/agents/${agentId}/memory`);
  }

  // Update agent memory (core memory blocks)
  async updateMemory(agentId: string, memory: any): Promise<any> {
    return this.request(`/v1/agents/${agentId}/memory`, {
      method: 'PATCH',
      body: JSON.stringify(memory),
    });
  }

  // List agents
  async listAgents(): Promise<LettaAgent[]> {
    return this.request<LettaAgent[]>('/v1/agents/');
  }

  // Delete agent
  async deleteAgent(agentId: string): Promise<void> {
    return this.request(`/v1/agents/${agentId}`, { method: 'DELETE' });
  }
}

// Singleton instance
let lettaClient: LettaClient | null = null;

export function getLettaClient(): LettaClient {
  if (!lettaClient) {
    lettaClient = new LettaClient();
  }
  return lettaClient;
}

// User-specific agent management
const userAgents = new Map<string, string>(); // userId -> agentId

export async function getUserAgent(userId: string): Promise<string> {
  let agentId = userAgents.get(userId);
  
  if (!agentId) {
    const client = getLettaClient();
    const agent = await client.getOrCreateAgent(userId);
    agentId = agent.id;
    userAgents.set(userId, agentId);
  }
  
  return agentId;
}

// Enhanced message sending with multi-turn tool calling support
export async function sendAgentMessage(userId: string, message: string): Promise<string> {
  const agentId = await getUserAgent(userId);
  const client = getLettaClient();
  
  // In demo mode, handle tool calling manually since mock doesn't support it
  if (DEMO_MODE === 'true') {
    return handleDemoMessage(userId, message);
  }
  
  // Start conversation
  let messages: LettaMessage[] = [{ role: 'user', content: message }];
  let maxTurns = 5; // Prevent infinite loops
  
  while (maxTurns-- > 0) {
    const response = await client.sendMessageWithTools(agentId, messages);
    
    // Add assistant message to history
    const assistantMsg = response.messages.find(m => m.role === 'assistant');
    if (assistantMsg) {
      messages.push(assistantMsg);
    }
    
    // Check for tool calls
    const toolCalls = assistantMsg?.tool_calls;
    if (!toolCalls || toolCalls.length === 0) {
      // No tool calls, return the response
      return assistantMsg?.content || 'I\'m processing your request...';
    }
    
    // Execute tool calls
    for (const toolCall of toolCalls) {
      const { name, arguments: argsStr } = toolCall.function;
      const args = JSON.parse(argsStr);
      args.userId = userId; // Inject userId
      
      const { executeTool } = await import('./agent-tools.js');
      const result = await executeTool(name as ToolName, args);
      
      // Add tool result to messages
      messages.push({
        role: 'tool',
        tool_call_id: toolCall.id,
        content: JSON.stringify(result),
      });
    }
    // Loop continues to let agent process tool results
  }
  
  return 'I\'m taking too long to think. Let me try a simpler approach.';
}

// Demo mode handler - manually routes to appropriate tools
async function handleDemoMessage(userId: string, message: string): Promise<string> {
  const { executeTool } = await import('./agent-tools.ts');
  // ToolName is a type-only export, use it directly in the cast
  const lower = message.toLowerCase();
  
  // Risk analysis - check before portfolio to catch "how risky is my portfolio"
  if (lower.includes('risk') || lower.includes('analyze') || lower.includes('how risky')) {
    const result = await executeTool('analyze_portfolio_risk' as ToolName, { userId });
    if (result.success && result.data) {
      const { formatRiskAnalysisHuman } = await import('./conversation.js');
      return formatRiskAnalysisHuman(result.data);
    }
    return result.error || 'Could not analyze risk';
  }
  
  // Rebalance - check before portfolio (since "rebalance" contains "balance")
  if (lower.includes('rebalance')) {
    const result = await executeTool('check_rebalance_needed' as ToolName, { userId });
    if (result.success && result.data) {
      const { formatRebalanceHuman } = await import('./conversation.js');
      return formatRebalanceHuman(result.data);
    }
    return result.error || 'Could not check rebalance';
  }
  
  // Stop-loss - check before portfolio (since "stop-loss" contains "loss" which isn't checked but good to be early)
  if (lower.includes('stop.loss') || lower.includes('stop loss') || lower.includes('stoploss') || lower.includes('stop-loss')) {
    // Check if creating or listing
    if (lower.includes('create') || lower.includes('set')) {
      return "To create a stop-loss, I need: token, stop price, target price, and amount. Example: 'Set stop-loss for AAPL at $180 with target $250 for 10 shares'";
    }
    const result = await executeTool('get_active_stop_losses' as ToolName, { userId });
    if (result.success && result.data) {
      const { formatStopLossHuman } = await import('./conversation.js');
      return formatStopLossHuman(result.data);
    }
    return result.error || 'Could not fetch stop-losses';
  }
  
  // Portfolio queries
  if (lower.includes('portfolio') || lower.includes('holdings') || (lower.includes('balance') && !lower.includes('rebalance')) || lower.includes('worth')) {
    const result = await executeTool('get_portfolio' as ToolName, { userId });
    if (result.success && result.data) {
      const { formatPortfolioHuman } = await import('./conversation.js');
      return formatPortfolioHuman(result.data);
    }
    return result.error || 'Could not fetch portfolio';
  }
  
  // Watchlist - check before price to avoid "what's my watchlist" matching price regex
  if (lower.includes('watchlist')) {
    const result = await executeTool('get_watchlist_prices' as ToolName, { userId });
    if (result.success && result.data) {
      const { formatWatchlistHuman } = await import('./conversation.js');
      return formatWatchlistHuman(result.data);
    }
    return result.error || 'Could not fetch watchlist';
  }
  
  // Price queries - more specific regex to avoid false matches
  const priceMatch = message.match(/(?:price|quote)\s+(?:of\s+)?([A-Z]{2,5})/i) || 
    message.match(/(?:how much|what['']s)\s+(?:is\s+)?\$?([A-Z]{2,5})/i);
  if (priceMatch) {
    const result = await executeTool('get_price' as ToolName, { symbol: priceMatch[1] });
    if (result.success && result.data) {
      const { formatPriceHuman } = await import('./conversation.js');
      return formatPriceHuman(result.data);
    }
    return result.error || 'Could not fetch price';
  }
  
  // Buy/sell/trade
  if (lower.includes('buy') || lower.includes('sell') || lower.includes('trade')) {
    // Extract tokens and amount - simplified for demo
    const tokens = extractTokens(message);
    if (tokens.length >= 2) {
      const fromToken = tokens.find(t => t === 'USDC') || tokens[0];
      const toToken = tokens.find(t => t !== 'USDC') || tokens[1];
      const amountMatch = message.match(/\$?(\d+(?:\.\d+)?)/);
      const amount = amountMatch ? amountMatch[1] : '100';

      if (lower.includes('sell')) {
        // Selling: fromToken is the stock, toToken is USDC
        const quoteResult = await executeTool('get_swap_quote' as ToolName, { 
          userId, fromToken: toToken, toToken: fromToken, amount 
        });
        if (quoteResult.success) {
          const { formatQuoteHuman } = await import('./conversation.js');
          return formatQuoteHuman(quoteResult.data) + '\n\nReply "confirm" to execute.';
        }
        return quoteResult.error || 'Could not get quote';
      } else {
        // Buying: fromToken is USDC, toToken is the stock
        const quoteResult = await executeTool('get_swap_quote' as ToolName, { 
          userId, fromToken, toToken, amount 
        });
        if (quoteResult.success) {
          const { formatQuoteHuman } = await import('./conversation.js');
          return formatQuoteHuman(quoteResult.data) + '\n\nReply "confirm" to execute.';
        }
        return quoteResult.error || 'Could not get quote';
      }
    }
    return "I need to know what you want to trade. Try: 'Buy $100 of AAPL with USDC' or 'Sell 10 NVDA for USDC'";
  }
  
  // Confirm trade
  if (lower.includes('confirm') || lower === 'yes' || lower === 'yep') {
    // In demo, we'd need to track the pending quote - simplified
    return "In demo mode, trades are simulated. What would you like to trade?";
  }
  
  // Alerts
  if (lower.includes('alert')) {
    const result = await executeTool('check_price_alerts' as ToolName, { userId });
    if (result.success && result.data) {
      const { formatAlertsHuman } = await import('./conversation.js');
      return formatAlertsHuman(result.data);
    }
    return result.error || 'Could not check alerts';
  }
  
  // Help
  if (lower.includes('help') || lower.includes('what can you do')) {
    return `I'm Moni, your portfolio manager for tokenized stocks on Base. You can ask me:\n\n` +
      `• "What's my portfolio?" - See holdings and value\n` +
      `• "Price of AAPL" - Check token price\n` +
      `• "Buy $500 of NVDA with USDC" - Get trade quote\n` +
      `• "How risky is my portfolio?" - Risk analysis\n` +
      `• "Set stop-loss for AAPL at $180" - Create stop-loss\n` +
      `• "Alert me if TSLA drops below $200" - Price alerts\n` +
      `• "Rebalance to 40% AAPL, 30% NVDA, 30% MSFT" - Portfolio rebalancing\n` +
      `• "What's my watchlist doing?" - Watchlist prices\n\n` +
      `Just talk to me naturally — no commands needed.`;
  }
  
  // Default: general response
  return "I'm here to help with your tokenized stock portfolio on Base. What would you like to know? Try asking about your portfolio, prices, trades, risk, or automation.";
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

export async function updateUserMemory(userId: string, memory: any): Promise<void> {
  const agentId = await getUserAgent(userId);
  const client = getLettaClient();
  await client.updateMemory(agentId, memory);
}

// Trading-specific memory helpers
export interface TradingMemory {
  watchlist: string[];
  riskParams: {
    maxPositionSizeUSD: number;
    maxDailyLossUSD: number;
    autoTradeEnabled: boolean;
  };
  activeStrategies: Array<{
    type: 'dca' | 'stop_loss' | 'take_profit' | 'rebalance' | 'price_alert';
    params: any;
    active: boolean;
  }>;
  preferences: {
    defaultSlippage: number;
    preferredTokens: string[];
    notificationLevel: 'all' | 'trades' | 'alerts' | 'none';
  };
  transactionHistory?: any[];
  conversationContext?: {
    lastTopic: string;
    pendingDecision: string;
    discussedTokens: string[];
  };
}

export async function getTradingMemory(userId: string): Promise<TradingMemory> {
  const agentId = await getUserAgent(userId);
  const client = getLettaClient();
  const memory = await client.getMemory(agentId);
  
  return memory?.trading || {
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
    transactionHistory: [],
    conversationContext: {
      lastTopic: '',
      pendingDecision: '',
      discussedTokens: [],
    },
  };
}

export async function setTradingMemory(userId: string, memory: Partial<TradingMemory>): Promise<void> {
  const current = await getTradingMemory(userId);
  const updated = { ...current, ...memory };
  await updateUserMemory(userId, { trading: updated });
}
