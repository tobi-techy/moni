import { getTradingMemory, setTradingMemory } from './letta.js';
import { formatUSD, formatBalance } from './base.js';

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

// Demo transaction history
const demoTransactions: Transaction[] = [
  {
    id: 'tx_1',
    timestamp: Date.now() - 86400000 * 2,
    type: 'buy',
    fromToken: 'USDC',
    toToken: 'AAPL',
    fromAmount: 500_000000n,
    toAmount: 250_000000000000000000n,
    fromAmountFormatted: '500.00',
    toAmountFormatted: '2.5',
    priceUSD: 198.50,
    txHash: '0xabc123...def456',
    status: 'confirmed',
    gasUsed: 145000n,
    gasPrice: 1000000000n,
  },
  {
    id: 'tx_2',
    timestamp: Date.now() - 86400000 * 5,
    type: 'buy',
    fromToken: 'USDC',
    toToken: 'NVDA',
    fromAmount: 1000_000000n,
    toAmount: 111_111111111111111n,
    fromAmountFormatted: '1000.00',
    toAmountFormatted: '1.11',
    priceUSD: 895.00,
    txHash: '0xdef456...abc789',
    status: 'confirmed',
    gasUsed: 152000n,
    gasPrice: 1000000000n,
  },
  {
    id: 'tx_3',
    timestamp: Date.now() - 86400000 * 10,
    type: 'sell',
    fromToken: 'MSFT',
    toToken: 'USDC',
    fromAmount: 500_000000000000000000n,
    toAmount: 200_000000n,
    fromAmountFormatted: '0.5',
    toAmountFormatted: '200.00',
    priceUSD: 398.00,
    txHash: '0x789abc...def012',
    status: 'confirmed',
    gasUsed: 138000n,
    gasPrice: 1000000000n,
  },
];

export async function getTransactionHistory(userId: string, limit: number = 20): Promise<Transaction[]> {
  const memory = await getTradingMemory(userId);
  const history = (memory as any).transactionHistory || demoTransactions;
  return history.slice(0, limit);
}

export async function addTransaction(userId: string, tx: Omit<Transaction, 'id'>): Promise<Transaction> {
  const memory = await getTradingMemory(userId);
  const history = (memory as any).transactionHistory || [...demoTransactions];
  
  const newTx: Transaction = {
    ...tx,
    id: `tx_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
  };
  
  history.unshift(newTx);
  (memory as any).transactionHistory = history;
  await setTradingMemory(userId, { transactionHistory: history });
  
  return newTx;
}

export function formatTransactionHistory(txs: Transaction[]): string {
  if (txs.length === 0) {
    return '📭 No transaction history yet. Start trading to build history!';
  }

  let message = '📜 **Transaction History**\n\n';
  
  for (const tx of txs) {
    const date = new Date(tx.timestamp).toLocaleDateString('en-US', { 
      month: 'short', 
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
    
    const typeEmoji = tx.type === 'buy' ? '🟢' : tx.type === 'sell' ? '🔴' : '🔵';
    const typeLabel = tx.type.toUpperCase();
    const statusEmoji = tx.status === 'confirmed' ? '✅' : tx.status === 'pending' ? '⏳' : '❌';
    
    message += `${typeEmoji} **${typeLabel}** ${statusEmoji}  ${date}\n`;
    
    if (tx.type === 'buy') {
      message += `   ${tx.fromAmountFormatted} ${tx.fromToken} → ${tx.toAmountFormatted} ${tx.toToken}\n`;
    } else if (tx.type === 'sell') {
      message += `   ${tx.fromAmountFormatted} ${tx.fromToken} → ${tx.toAmountFormatted} ${tx.toToken}\n`;
    }
    
    message += `   💲 Price: $${tx.priceUSD.toFixed(2)} | ⛽ Gas: ${tx.gasUsed?.toString() || 'N/A'}\n`;
    message += `   🔗 ${tx.txHash}\n\n`;
  }
  
  return message;
}

export function formatTransactionSummary(txs: Transaction[]): string {
  if (txs.length === 0) return 'No transactions';
  
  const buys = txs.filter(t => t.type === 'buy').length;
  const sells = txs.filter(t => t.type === 'sell').length;
  const totalVolume = txs.reduce((sum, t) => sum + Number(t.fromAmount) / 1e6, 0); // USDC volume
  
  return `📊 **Summary**: ${buys} buys, ${sells} sells | Volume: $${totalVolume.toLocaleString()}`;
}
