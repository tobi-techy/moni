export interface PortfolioAnalytics {
    totalValueUSD: bigint;
    totalPositions: number;
    topHolding: {
        symbol: string;
        valueUSD: bigint;
        percentage: number;
    } | null;
    diversificationScore: number;
    riskLevel: 'low' | 'medium' | 'high';
    dailyPnL: bigint;
    allocation: Array<{
        symbol: string;
        percentage: number;
        valueUSD: bigint;
    }>;
}
export declare function analyzePortfolio(userId: string): Promise<PortfolioAnalytics>;
export declare function formatAnalytics(analytics: PortfolioAnalytics): string;
export declare function getPriceChanges(userId: string): Promise<string>;
//# sourceMappingURL=analytics.d.ts.map