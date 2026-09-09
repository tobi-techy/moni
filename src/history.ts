import { getTradingMemory, setTradingMemory } from './ai.js';
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

export async function getTransactionHistory(userId: string, limit: number = 20): Promise<Transaction[]> {
  const memory = await getTradingMemory(userId);
  const history = (memory as any).transactionHistory || [];
  return history.slice(0, limit);
}

export async function addTransaction(userId: string, tx: Omit<Transaction, 'id'>): Promise<Transaction> {
  const memory = await getTradingMemory(userId);
  const history = (memory as any).transactionHistory || [];
  
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
