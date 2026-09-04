import { LETTA_API_KEY, LETTA_BASE_URL, DEMO_MODE } from './env.js';
// Letta API Client
class LettaClient {
    baseUrl;
    apiKey;
    constructor() {
        this.baseUrl = LETTA_BASE_URL;
        this.apiKey = LETTA_API_KEY;
    }
    async request(endpoint, options = {}) {
        if (DEMO_MODE === 'true') {
            // Return mock responses for demo
            return this.getMockResponse(endpoint);
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
        return response.json();
    }
    getMockResponse(endpoint) {
        if (endpoint.includes('/agents')) {
            return {
                id: 'demo-agent-id',
                name: 'Moni Trading Agent',
                persona: 'I am an expert trading assistant for tokenized stocks on Base.',
                human: 'User wants to trade tokenized stocks via iMessage.',
                system: 'You are Moni, an agentic trading assistant for Coinbase Tokenized Stocks on Base.',
                created_at: new Date().toISOString(),
            };
        }
        if (endpoint.includes('/messages')) {
            return {
                messages: [
                    { role: 'assistant', content: 'I\'ll help you with that trade. Let me check the current price and execute.' }
                ]
            };
        }
        return {};
    }
    // Create or get agent for a user
    async getOrCreateAgent(userId) {
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
        return this.request('/v1/agents/', {
            method: 'POST',
            body: JSON.stringify(agentConfig),
        });
    }
    // Send message to agent
    async sendMessage(agentId, message) {
        return this.request(`/v1/agents/${agentId}/messages`, {
            method: 'POST',
            body: JSON.stringify({
                messages: [{ role: 'user', content: message }],
            }),
        });
    }
    // Get agent memory
    async getMemory(agentId) {
        return this.request(`/v1/agents/${agentId}/memory`);
    }
    // Update agent memory (core memory blocks)
    async updateMemory(agentId, memory) {
        return this.request(`/v1/agents/${agentId}/memory`, {
            method: 'PATCH',
            body: JSON.stringify(memory),
        });
    }
    // List agents
    async listAgents() {
        return this.request('/v1/agents/');
    }
    // Delete agent
    async deleteAgent(agentId) {
        return this.request(`/v1/agents/${agentId}`, { method: 'DELETE' });
    }
}
// Singleton instance
let lettaClient = null;
export function getLettaClient() {
    if (!lettaClient) {
        lettaClient = new LettaClient();
    }
    return lettaClient;
}
// User-specific agent management
const userAgents = new Map(); // userId -> agentId
export async function getUserAgent(userId) {
    let agentId = userAgents.get(userId);
    if (!agentId) {
        const client = getLettaClient();
        const agent = await client.getOrCreateAgent(userId);
        agentId = agent.id;
        userAgents.set(userId, agentId);
    }
    return agentId;
}
export async function sendAgentMessage(userId, message) {
    const agentId = await getUserAgent(userId);
    const client = getLettaClient();
    const response = await client.sendMessage(agentId, message);
    // Return the last assistant message
    const assistantMsg = response.messages
        .filter(m => m.role === 'assistant')
        .pop();
    return assistantMsg?.content || 'I\'m processing your request...';
}
export async function updateUserMemory(userId, memory) {
    const agentId = await getUserAgent(userId);
    const client = getLettaClient();
    await client.updateMemory(agentId, memory);
}
export async function getTradingMemory(userId) {
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
export async function setTradingMemory(userId, memory) {
    const current = await getTradingMemory(userId);
    const updated = { ...current, ...memory };
    await updateUserMemory(userId, { trading: updated });
}
//# sourceMappingURL=letta.js.map