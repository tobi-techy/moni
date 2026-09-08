import { LETTA_API_KEY, LETTA_BASE_URL, DEMO_MODE } from './env.js';

// Letta Agent Types
export interface LettaAgent {
  id: string;
  name: string;
  persona: string;
  human: string;
  system: string;
  created_at: string;
}

export interface LettaMessage {
  role: 'user' | 'assistant' | 'system' | 'function';
  content: string;
  name?: string;
}

export interface LettaResponse {
  messages: LettaMessage[];
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

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
      // Return mock responses for demo
      return this.getMockResponse<T>(endpoint);
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
      const body = await response.text().catch(() => '');
      const error = new Error(`Letta API error: ${response.status} ${response.statusText}\n${body}`);
      // @ts-ignore
      error.status = response.status;
      // @ts-ignore
      error.body = body;
      throw error;
    }

    return response.json() as Promise<T>;
  }

  private getMockResponse<T>(endpoint: string): T {
    if (endpoint.includes('/agents')) {
      return {
        id: 'demo-agent-id',
        name: 'Moni Trading Agent',
        persona: 'I am an expert trading assistant for tokenized stocks on Base.',
        human: 'User wants to trade tokenized stocks via iMessage.',
        system: 'You are Moni, an agentic trading assistant for Coinbase Tokenized Stocks on Base.',
        created_at: new Date().toISOString(),
      } as T;
    }
    if (endpoint.includes('/messages')) {
      return {
        messages: [
          { role: 'assistant', content: 'I\'ll help you with that trade. Let me check the current price and execute.' }
        ]
      } as T;
    }
    return {} as T;
  }

  // Create or get agent for a user
  async getOrCreateAgent(userId: string): Promise<LettaAgent> {
    // In production, you'd store agent IDs per user
    // For now, create a default trading agent
    const agentConfig = {
      name: `Moni Trading Agent - ${userId}`,
      persona: `You are Moni, an expert agentic trading assistant for Coinbase Tokenized Stocks on Base. 
You help users trade tokenized stocks (AAPL, NVDA, MSFT, etc.) via iMessage.
You can:
- Check portfolio balances and prices
- Execute trades via DEX aggregation
- Set price alerts and automated strategies (DCA, stop-loss)
- Provide market insights and trade suggestions
- Manage risk within user-defined parameters

Always confirm trades before executing. Explain your reasoning. Be concise but informative.`,
      human: `User ID: ${userId}. They trade tokenized stocks on Base via iMessage. They want an agentic assistant that can autonomously manage their portfolio within set parameters.`,
      system: `You are Moni, an agentic trading assistant for Base tokenized stocks. 
Core capabilities:
1. Portfolio management: view holdings, track P&L, rebalance
2. Trading: execute swaps via 1inch/Aerodrome, manage slippage
3. Automation: DCA, limit orders, stop-loss, take-profit
4. Alerts: price alerts, news alerts, portfolio alerts
5. Analysis: technical levels, market sentiment, risk assessment

Constraints:
- Never execute trades without explicit confirmation (unless auto-trade enabled with limits)
- Respect user-defined risk parameters (max position size, max daily loss, etc.)
- All trades are on Base mainnet using Coinbase B20 tokenized stocks
- US users are not supported (compliance)
- Demo mode: simulate trades unless real funds confirmed`,
    };

    return this.request<LettaAgent>('/v1/agents/', {
      method: 'POST',
      body: JSON.stringify(agentConfig),
    });
  }

  // Send message to agent
  async sendMessage(agentId: string, message: string): Promise<LettaResponse> {
    return this.request<LettaResponse>(`/v1/agents/${agentId}/messages`, {
      method: 'POST',
      body: JSON.stringify({
        messages: [{ role: 'user', content: message }],
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

export async function sendAgentMessage(userId: string, message: string): Promise<string> {
  const agentId = await getUserAgent(userId);
  const client = getLettaClient();
  const response = await client.sendMessage(agentId, message);
  
  // Return the last assistant message
  const assistantMsg = response.messages
    .filter(m => m.role === 'assistant')
    .pop();
  
  return assistantMsg?.content || 'I\'m processing your request...';
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
}

export async function getTradingMemory(userId: string): Promise<TradingMemory> {
  const agentId = await getUserAgent(userId);
  const client = getLettaClient();
  const memory = await client.getMemory(agentId);
  
  // Return default if not set
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
  };
}

export async function setTradingMemory(userId: string, memory: Partial<TradingMemory>): Promise<void> {
  const current = await getTradingMemory(userId);
  const updated = { ...current, ...memory };
  await updateUserMemory(userId, { trading: updated });
}
