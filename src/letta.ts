import { LETTA_API_KEY, LETTA_BASE_URL, LETTA_MODEL, DEMO_MODE } from './env.js';
import { TOOL_DEFINITIONS, ToolName } from './agent-tools.js';
import { B20_TOKENS } from './constants.js';
import { getTradingMemory, setTradingMemory, TradingMemory } from './letta.js';

// ─── Letta API Types (matching the REST API response format) ───────────────

export interface LettaAgent {
  id: string;
  name: string;
  persona: string;
  human: string;
  system: string;
  created_at: string;
}

// Letta returns typed messages with a message_type discriminator
interface LettaTypedMessage {
  id: string;
  message_type: string; // 'assistant_message' | 'tool_call_message' | 'tool_return_message' | 'reasoning_message' | ...
  content?: string | Array<{ text?: string; type?: string }>;
  tool_call?: {
    name: string;
    arguments: string; // JSON-encoded string
    tool_call_id: string;
  };
  tool_calls?: Array<{
    name: string;
    arguments: string;
    tool_call_id: string;
  }>;
}

interface LettaResponse {
  messages: LettaTypedMessage[];
  stop_reason?: { stop_reason: string; message_type?: string };
  usage?: any;
}

// ─── System prompt & persona ───────────────────────────────────────────────

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
❌ "📊 **Portfolio**\\n\\n**AAPL**\\n  💎 100 shares\\n  💰 $22,000"

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

// ─── Client tools (passed per-message, executed on the Moni backend) ────────

// TOOL_DEFINITIONS already has { name, description, parameters } which matches
// the Letta client_tools format exactly.
const CLIENT_TOOLS = TOOL_DEFINITIONS.map((t) => ({
  name: t.name,
  description: t.description,
  parameters: t.parameters,
}));

// ─── Letta API Client ───────────────────────────────────────────────────────

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

    if (!this.apiKey) {
      console.warn('LETTA_API_KEY not configured, falling back to demo mode');
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
      const body = await response.text().catch(() => 'Unknown error');
      const error = new Error(`Letta API error: ${response.status} ${response.statusText}\nEndpoint: ${endpoint}\n${body}`);
      console.error(error.message);
      // @ts-ignore
      error.status = response.status;
      // @ts-ignore
      error.body = body;
      throw error;
    }

    return response.json() as Promise<T>;
  }

  // ─── Mock responses (demo mode only) ─────────────────────────────────────

  private getMockResponse<T>(endpoint: string, options: RequestInit = {}): T {
    // Agent creation: POST /v1/agents/
    if (endpoint === '/v1/agents/' && options.method === 'POST') {
      return {
        id: 'demo-agent-id',
        name: 'Moni Trading Agent',
        persona: MONI_PERSONA,
        human: MONI_HUMAN_TEMPLATE('demo'),
        system: MONI_SYSTEM_PROMPT,
        created_at: new Date().toISOString(),
      } as T;
    }
    // List agents: GET /v1/agents/
    if (endpoint === '/v1/agents/' && !options.method) {
      return [] as T;
    }
    // Messages: POST /v1/agents/{id}/messages
    if (endpoint.includes('/messages') && options.method === 'POST') {
      return {
        messages: [
          {
            id: 'demo-msg-1',
            message_type: 'assistant_message',
            content: "I'll help you with that. Let me check your portfolio first.",
          },
        ],
        stop_reason: { stop_reason: 'end_turn', message_type: 'stop_reason' },
      } as T;
    }
    return {} as T;
  }

  // ─── Agent management ─────────────────────────────────────────────────────

  // Create or get agent for a user
  async getOrCreateAgent(userId: string): Promise<LettaAgent> {
    const sanitizedUserId = userId.replace(/[^a-zA-Z0-9_-]/g, '_');
    const agentName = `Moni Trading Agent - ${sanitizedUserId}`;

    // Try to find an existing agent for this user first
    try {
      const agents = await this.request<LettaAgent[]>('/v1/agents/?limit=100');
      const existing = agents?.find((a) => a.name === agentName);
      if (existing) {
        return existing;
      }
    } catch {
      // If listing fails, proceed to create
    }

    // Create new agent — tools are passed as client_tools per message, not here
    const agentConfig = {
      name: agentName,
      model: LETTA_MODEL,
      persona: MONI_PERSONA,
      human: MONI_HUMAN_TEMPLATE(userId),
      system: MONI_SYSTEM_PROMPT,
    };

    return this.request<LettaAgent>('/v1/agents/', {
      method: 'POST',
      body: JSON.stringify(agentConfig),
    });
  }

  // List agents
  async listAgents(): Promise<LettaAgent[]> {
    return this.request<LettaAgent[]>('/v1/agents/');
  }

  // Delete agent
  async deleteAgent(agentId: string): Promise<void> {
    await this.request(`/v1/agents/${agentId}`, { method: 'DELETE' });
  }

  // ─── Messaging with client-side tool calling ──────────────────────────────

  // Send a user message to the agent
  async sendMessage(agentId: string, message: string): Promise<LettaResponse> {
    return this.request<LettaResponse>(`/v1/agents/${agentId}/messages`, {
      method: 'POST',
      body: JSON.stringify({
        input: message,
        client_tools: CLIENT_TOOLS,
      }),
    });
  }

  // Send tool execution results back to the agent
  async sendToolReturns(
    agentId: string,
    toolReturns: Array<{ tool_call_id: string; status: 'success' | 'error'; tool_return: string }>,
  ): Promise<LettaResponse> {
    return this.request<LettaResponse>(`/v1/agents/${agentId}/messages`, {
      method: 'POST',
      body: JSON.stringify({
        messages: [
          {
            type: 'tool_return',
            tool_returns: toolReturns,
          },
        ],
        client_tools: CLIENT_TOOLS,
      }),
    });
  }
}

// ─── Response parsing helpers ───────────────────────────────────────────────

// Extract the assistant's text from a Letta response
function extractAssistantText(response: LettaResponse): string | null {
  for (const msg of response.messages) {
    if (msg.message_type === 'assistant_message') {
      if (typeof msg.content === 'string') {
        return msg.content;
      }
      if (Array.isArray(msg.content)) {
        // Extract text from content parts
        const texts = msg.content
          .map((part) => part.text || '')
          .filter(Boolean);
        return texts.join('') || null;
      }
    }
  }
  return null;
}

// Extract tool calls from a Letta response
function extractToolCalls(response: LettaResponse): Array<{
  name: string;
  arguments: string;
  tool_call_id: string;
}> {
  const calls: Array<{ name: string; arguments: string; tool_call_id: string }> = [];
  for (const msg of response.messages) {
    if (msg.message_type === 'tool_call_message') {
      if (msg.tool_call) {
        calls.push(msg.tool_call);
      }
      if (msg.tool_calls) {
        for (const tc of msg.tool_calls) {
          calls.push(tc);
        }
      }
    }
  }
  return calls;
}

// ─── Singleton client ──────────────────────────────────────────────────────

let lettaClient: LettaClient | null = null;

export function getLettaClient(): LettaClient {
  if (!lettaClient) {
    lettaClient = new LettaClient();
  }
  return lettaClient;
}

// ─── User → agent mapping ───────────────────────────────────────────────────

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

// ─── Main entry: send a message and handle multi-turn tool calling ───────────

export async function sendAgentMessage(userId: string, message: string): Promise<string> {
  // In demo mode, handle tool calling manually via keyword routing
  if (DEMO_MODE === 'true') {
    return handleDemoMessage(userId, message);
  }

  const agentId = await getUserAgent(userId);
  const client = getLettaClient();

  // Send the user message
  let response = await client.sendMessage(agentId, message);

  // Multi-turn tool calling loop
  let maxTurns = 5;
  while (maxTurns-- > 0) {
    // Check for tool calls
    const toolCalls = extractToolCalls(response);

    if (toolCalls.length === 0) {
      // No tool calls — return the assistant's text response
      const text = extractAssistantText(response);
      return text || "I'm processing your request...";
    }

    // Execute each tool call locally
    const toolReturns: Array<{ tool_call_id: string; status: 'success' | 'error'; tool_return: string }> = [];

    for (const call of toolCalls) {
      try {
        const args = JSON.parse(call.arguments);
        args.userId = userId; // Inject userId for tools that need it

        const { executeTool } = await import('./agent-tools.js');
        const result = await executeTool(call.name as ToolName, args);

        toolReturns.push({
          tool_call_id: call.tool_call_id,
          status: result.success ? 'success' : 'error',
          tool_return: JSON.stringify(result),
        });
      } catch (err) {
        toolReturns.push({
          tool_call_id: call.tool_call_id,
          status: 'error',
          tool_return: JSON.stringify({ error: String(err) }),
        });
      }
    }

    // Send tool results back to the agent
    response = await client.sendToolReturns(agentId, toolReturns);
  }

  // Max turns reached — return whatever the agent last said
  const text = extractAssistantText(response);
  return text || "I'm taking too long to think. Let me try a simpler approach.";
}

// ─── Demo mode: keyword-based tool routing (no Letta API needed) ─────────────

async function handleDemoMessage(userId: string, message: string): Promise<string> {
  const { executeTool } = await import('./agent-tools.js');
  const lower = message.toLowerCase();

  // Risk analysis
  if (lower.includes('risk') || lower.includes('analyze') || lower.includes('how risky')) {
    const result = await executeTool('analyze_portfolio_risk' as ToolName, { userId });
    if (result.success && result.data) {
      const { formatRiskAnalysisHuman } = await import('./conversation.js');
      return formatRiskAnalysisHuman(result.data);
    }
    return result.error || 'Could not analyze risk';
  }

  // Rebalance
  if (lower.includes('rebalance')) {
    const result = await executeTool('check_rebalance_needed' as ToolName, { userId });
    if (result.success && result.data) {
      const { formatRebalanceHuman } = await import('./conversation.js');
      return formatRebalanceHuman(result.data);
    }
    return result.error || 'Could not check rebalance';
  }

  // Stop-loss
  if (lower.includes('stop.loss') || lower.includes('stop loss') || lower.includes('stoploss') || lower.includes('stop-loss')) {
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

  // Watchlist
  if (lower.includes('watchlist')) {
    const result = await executeTool('get_watchlist_prices' as ToolName, { userId });
    if (result.success && result.data) {
      const { formatWatchlistHuman } = await import('./conversation.js');
      return formatWatchlistHuman(result.data);
    }
    return result.error || 'Could not fetch watchlist';
  }

  // Price queries
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
    const tokens = extractTokens(message);
    if (tokens.length >= 2) {
      const fromToken = tokens.find(t => t === 'USDC') || tokens[0];
      const toToken = tokens.find(t => t !== 'USDC') || tokens[1];
      const amountMatch = message.match(/\$?(\d+(?:\.\d+)?)/);
      const amount = amountMatch ? amountMatch[1] : '100';

      if (lower.includes('sell')) {
        const quoteResult = await executeTool('get_swap_quote' as ToolName, {
          userId, fromToken: toToken, toToken: fromToken, amount
        });
        if (quoteResult.success) {
          const { formatQuoteHuman } = await import('./conversation.js');
          return formatQuoteHuman(quoteResult.data) + '\n\nReply "confirm" to execute.';
        }
        return quoteResult.error || 'Could not get quote';
      } else {
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

  // Default
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

  if (upper.includes('USDC') || upper.includes('usdc')) {
    found.push('USDC');
  }

  return [...new Set(found)];
}

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
  pendingQuote?: any;
}

// ─── Trading memory (local storage) ─────────────────────────────────────────

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
  pendingQuote?: any;
}

export async function getTradingMemory(userId: string): Promise<TradingMemory> {
  return getTradingMemoryFromMap(userId);
}

export async function setTradingMemory(userId: string, updates: Partial<TradingMemory>): Promise<void> {
  return setTradingMemoryInMap(userId, updates);
}

function getTradingMemoryFromMap(userId: string): TradingMemory {
  let memory = (globalThis as any).__moniTradingMemory?.get(userId);
  if (!memory) {
    memory = {
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
    (globalThis as any).__moniTradingMemory ??= new Map<string, TradingMemory>();
    (globalThis as any).__moniTradingMemory.set(userId, memory);
  }
  return memory;
}

function setTradingMemoryInMap(userId: string, updates: Partial<TradingMemory>): void {
  const current = getTradingMemoryFromMap(userId);
  const updated = { ...current, ...updates };
  (globalThis as any).__moniTradingMemory ??= new Map<string, TradingMemory>();
  (globalThis as any).__moniTradingMemory.set(userId, updated);
}

export async function updateUserMemory(userId: string, _memory: any): Promise<void> {
  // No-op: trading memory is now handled locally via getTradingMemory/setTradingMemory.
  // Kept for backward compatibility with any callers that still reference it.
}

