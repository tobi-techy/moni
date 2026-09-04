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
declare class LettaClient {
    private baseUrl;
    private apiKey;
    constructor();
    private request;
    private getMockResponse;
    getOrCreateAgent(userId: string): Promise<LettaAgent>;
    sendMessage(agentId: string, message: string): Promise<LettaResponse>;
    getMemory(agentId: string): Promise<any>;
    updateMemory(agentId: string, memory: any): Promise<any>;
    listAgents(): Promise<LettaAgent[]>;
    deleteAgent(agentId: string): Promise<void>;
}
export declare function getLettaClient(): LettaClient;
export declare function getUserAgent(userId: string): Promise<string>;
export declare function sendAgentMessage(userId: string, message: string): Promise<string>;
export declare function updateUserMemory(userId: string, memory: any): Promise<void>;
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
export declare function getTradingMemory(userId: string): Promise<TradingMemory>;
export declare function setTradingMemory(userId: string, memory: Partial<TradingMemory>): Promise<void>;
export {};
//# sourceMappingURL=letta.d.ts.map