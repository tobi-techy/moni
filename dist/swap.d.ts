export interface SwapQuote {
    fromToken: string;
    toToken: string;
    fromAmount: string;
    toAmount: string;
    estimatedGas: string;
    protocols: any[];
    gasPrice: string;
}
export interface SwapTransaction {
    from: string;
    to: string;
    data: string;
    value: string;
    gas: string;
    gasPrice: string;
}
export declare function getSwapQuote(fromToken: string, toToken: string, amount: string, slippage?: number): Promise<SwapQuote | null>;
export declare function getSwapTransaction(fromToken: string, toToken: string, amount: string, fromAddress: string, slippage?: number): Promise<SwapTransaction | null>;
export declare function getTokenPrice1inch(tokenAddress: string): Promise<{
    price: string;
    timestamp: number;
} | null>;
export declare function getSupportedTokens(): Promise<Record<string, any> | null>;
export declare function parseAmount(amount: string, decimals: number): bigint;
export declare function formatAmount(amount: bigint, decimals: number): string;
//# sourceMappingURL=swap.d.ts.map