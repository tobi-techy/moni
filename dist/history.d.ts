export interface Transaction {
    id: string;
    timestamp: number;
    type: 'buy' | 'sell' | 'dca' | 'deposit' | 'withdrawal';
    fromToken: string;
    toToken: string;
    fromAmount: bigint;
    toAmount: bigint;
    fromAmountFormatted: string;
    toAmountFormatted: string;
    priceUSD: number;
    txHash: string;
    status: 'pending' | 'confirmed' | 'failed';
    gasUsed?: bigint;
    gasPrice?: bigint;
}
export declare function getTransactionHistory(userId: string, limit?: number): Promise<Transaction[]>;
export declare function addTransaction(userId: string, tx: Omit<Transaction, 'id'>): Promise<Transaction>;
export declare function formatTransactionHistory(txs: Transaction[]): string;
export declare function formatTransactionSummary(txs: Transaction[]): string;
//# sourceMappingURL=history.d.ts.map