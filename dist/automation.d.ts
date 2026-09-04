export interface StopLossConfig {
    token: string;
    stopLossPrice: number;
    takeProfitPrice: number;
    amount: string;
    active: boolean;
}
export declare function createStopLoss(userId: string, config: Omit<StopLossConfig, 'active'>): Promise<void>;
export declare function getActiveStopLosses(userId: string): Promise<StopLossConfig[]>;
export declare function checkStopLosses(userId: string): Promise<string[]>;
export interface RebalanceConfig {
    targetAllocation: Record<string, number>;
    tolerance: number;
    active: boolean;
}
export declare function createRebalanceStrategy(userId: string, config: Omit<RebalanceConfig, 'active'>): Promise<void>;
export declare function checkRebalanceNeeded(userId: string): Promise<{
    needed: boolean;
    suggestions: Array<{
        symbol: string;
        currentPct: number;
        targetPct: number;
        action: 'buy' | 'sell';
        amount: string;
    }>;
} | null>;
export interface SentimentData {
    symbol: string;
    sentiment: 'bullish' | 'bearish' | 'neutral';
    score: number;
    sources: string[];
    timestamp: number;
}
export declare function getMarketSentiment(symbols: string[]): Promise<SentimentData[]>;
export declare function formatSentiment(sentiments: SentimentData[]): string;
export declare function handleStopLoss(space: any, userId: string, args: string[]): Promise<void>;
export declare function handleRebalance(space: any, userId: string, args: string[]): Promise<void>;
export declare function handleSentiment(space: any, userId: string, args: string[]): Promise<void>;
//# sourceMappingURL=automation.d.ts.map