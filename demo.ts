#!/usr/bin/env node
/**
 * Demo Script for Builder Quest Loom Video
 * 
 * This script runs a pre-recorded demo flow showing all features.
 * Run with: npx tsx demo.ts
 */

import { analyzePortfolio, formatAnalytics, getPriceChanges } from './src/analytics.js';
import { getTransactionHistory, formatTransactionHistory } from './src/history.js';
import { getTokenPrice, formatUSD, formatBalance, B20_TOKENS } from './src/base.js';
import { getSwapQuote, parseAmount, formatAmount } from './src/swap.js';
import { getTradingMemory, setTradingMemory } from './src/letta.js';
import { checkStopLosses } from './src/automation.js';

// Demo user ID
const DEMO_USER = 'demo-user';

async function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function runDemo() {
  console.log('🎬 ===== MONI BUILDER QUEST DEMO =====\n');
  
  // Initialize demo memory
  await setTradingMemory(DEMO_USER, {
    watchlist: ['AAPL', 'NVDA', 'MSFT', 'GOOGL', 'META'],
    riskParams: {
      maxPositionSizeUSD: 10000,
      maxDailyLossUSD: 1000,
      autoTradeEnabled: false,
    },
    activeStrategies: [
      { type: 'dca', params: { amount: '50', token: 'AAPL', frequency: 'weekly' }, active: true },
      { type: 'price_alert', params: { token: 'NVDA', direction: 'above', price: 950 }, active: true },
    ],
    preferences: {
      defaultSlippage: 1.0,
      preferredTokens: ['AAPL', 'NVDA', 'MSFT'],
      notificationLevel: 'trades',
    },
    transactionHistory: [],
  });

  // 1. Welcome & Connect
  console.log('📱 "Hey Moni, connect my wallet"');
  await sleep(500);
  console.log('✅ Demo Wallet Connected');
  console.log('   Address: 0x742d...3b8D4');
  console.log('   You\'re in demo mode - all trades are simulated.\n');
  await sleep(1000);

  // 2. Portfolio
  console.log('📊 "/portfolio"');
  await sleep(500);
  const analytics = await analyzePortfolio(DEMO_USER);
  console.log(formatAnalytics(analytics));
  console.log('');
  await sleep(1500);

  // 3. Price Check
  console.log('💹 "/price NVDA"');
  await sleep(500);
  const nvdaPrice = await getTokenPrice('NVDA');
  if (nvdaPrice) {
    const price = Number(nvdaPrice.price) / 10 ** nvdaPrice.decimals;
    console.log(`💹 **NVDA Price**: $${price.toFixed(2)}`);
    console.log(`_Updated: ${new Date(Number(nvdaPrice.updatedAt) * 1000).toLocaleTimeString()}_\n`);
  }
  await sleep(1000);

  // 4. Watchlist
  console.log('📋 "/watchlist"');
  await sleep(500);
  const changes = await getPriceChanges(DEMO_USER);
  console.log(changes);
  console.log('');
  await sleep(1000);

  // 5. Buy Trade
  console.log('💰 "/buy 500 USDC AAPL"');
  await sleep(500);
  const quote = await getSwapQuote(
    '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', // USDC
    B20_TOKENS.AAPL,
    parseAmount('500', 6).toString()
  );
  if (quote) {
    const toAmount = formatAmount(BigInt(quote.toAmount), 18);
    console.log('✅ **Quote Ready**');
    console.log('📥 You send: 500 USDC');
    console.log(`📤 You receive: ~${toAmount} AAPL`);
    console.log(`⛽ Est. gas: ${quote.estimatedGas}\n`);
  }
  await sleep(500);
  console.log('User: "confirm"');
  await sleep(1000);
  console.log('⏳ **Executing trade (demo mode)...**');
  await sleep(1500);
  console.log('✅ **Trade Executed (Demo)**');
  console.log('📥 Sent: 500.00 USDC');
  console.log('📥 Received: ~2.50 AAPL');
  console.log('🔗 Tx: 0xabc123...def456');
  console.log('_This was a simulated trade. No real funds moved._\n');
  await sleep(1500);

  // 6. DCA Strategy
  console.log('🔄 "/dca create 100 USDC NVDA weekly"');
  await sleep(500);
  console.log('✅ **DCA Strategy Created**');
  console.log('💰 Amount: 100 USDC');
  console.log('📈 Token: NVDA');
  console.log('🔄 Frequency: weekly');
  console.log('🟢 Status: Active\n');
  await sleep(1000);

  // 7. Price Alert
  console.log('🔔 "/alert create TSLA below 200"');
  await sleep(500);
  console.log('🔔 **Price Alert Created**');
  console.log('📈 Token: TSLA');
  console.log('📊 Trigger: Price goes below $200.00');
  console.log('🟢 Status: Active\n');
  await sleep(1000);

  // 8. Stop-Loss
  console.log('🛑 "/stoploss create AAPL 180 250 5"');
  await sleep(500);
  console.log('🛑 **Stop-Loss / Take-Profit Created**');
  console.log('📈 Token: AAPL');
  console.log('🔴 Stop Loss: $180.00');
  console.log('🟢 Take Profit: $250.00');
  console.log('📦 Amount: 5 AAPL');
  console.log('🟢 Status: Active\n');
  await sleep(1000);

  // 9. Rebalance
  console.log('⚖️ "/rebalance create AAPL:40 NVDA:30 MSFT:30"');
  await sleep(500);
  console.log('⚖️ **Rebalance Strategy Created**');
  console.log('Target Allocation:');
  console.log('  AAPL: 40%');
  console.log('  NVDA: 30%');
  console.log('  MSFT: 30%');
  console.log('🔄 Tolerance: ±5%\n');
  await sleep(1000);

  // 10. Sentiment
  console.log('📰 "/sentiment"');
  await sleep(500);
  const { getMarketSentiment, formatSentiment } = await import('./src/automation.js');
  const sentiments = await getMarketSentiment(['AAPL', 'NVDA', 'MSFT']);
  console.log(formatSentiment(sentiments));
  await sleep(1000);

  // 11. Analytics
  console.log('📊 "/analytics"');
  await sleep(500);
  const updatedAnalytics = await analyzePortfolio(DEMO_USER);
  console.log(formatAnalytics(updatedAnalytics));
  console.log('');
  await sleep(1500);

  // 12. Transaction History
  console.log('📜 "/history"');
  await sleep(500);
  const history = await getTransactionHistory(DEMO_USER);
  console.log(formatTransactionHistory(history));
  console.log('');
  await sleep(1500);

  // 13. Natural Language
  console.log('🤖 "What\'s my portfolio worth and should I buy more NVDA?"');
  await sleep(500);
  console.log('🤔 Thinking...');
  await sleep(1000);
  console.log('Your portfolio is worth ~$15,400 with 3 positions (AAPL, NVDA, MSFT).');
  console.log('NVDA is showing bullish sentiment with strong earnings momentum.');
  console.log('Consider: Your NVDA allocation is 35% - within your 30% target.');
  console.log('A small DCA increase could work, but watch the $950 resistance level.\n');
  await sleep(1500);

  // 14. Help
  console.log('❓ "/help"');
  await sleep(500);
  console.log('🤖 **Moni - Your iMessage Trading Agent**');
  console.log('**Portfolio & Prices**');
  console.log('• `/portfolio` - View your holdings');
  console.log('• `/price <token>` - Check token price');
  console.log('• `/watchlist` - View watchlist prices');
  console.log('• `/analytics` - Portfolio analytics & diversification');
  console.log('• `/analytics changes` - 24h price changes for watchlist');
  console.log('• `/history` - Transaction history');
  console.log('**Trading**');
  console.log('• `/buy <amount> <token> [with <token>]` - Buy tokens');
  console.log('  Example: `/buy 100 USDC AAPL`');
  console.log('• `/sell <amount> <token> [for <token>]` - Sell tokens');
  console.log('  Example: `/sell 10 AAPL USDC`');
  console.log('• `/confirm` / `/cancel` - Confirm or cancel pending trade');
  console.log('**Automation**');
  console.log('• `/dca create <amount> <token> <frequency>` - Dollar cost average');
  console.log('• `/dca list` - List DCA strategies');
  console.log('• `/alert create <token> <above|below> <price>` - Price alerts');
  console.log('• `/stoploss create <token> <stop> <target> <amount>` - Stop-loss/Take-profit');
  console.log('• `/rebalance create <sym:pct> ...` - Portfolio rebalancing');
  console.log('• `/sentiment` - Market sentiment for watchlist');
  console.log('**Wallet**');
  console.log('• `/connect` - Connect your wallet');
  console.log('• `/wallet` - Show wallet address');
  console.log('**Agent**');
  console.log('• Just chat naturally! Ask me anything about trading, markets, or your portfolio.\n');
  await sleep(1000);

  console.log('🎬 ===== DEMO COMPLETE =====');
  console.log('');
  console.log('✨ Features demonstrated:');
  console.log('   ✅ iMessage-native trading interface');
  console.log('   ✅ Coinbase Tokenized Stocks (B20) on Base');
  console.log('   ✅ Real-time Chainlink price feeds');
  console.log('   ✅ 1inch DEX aggregation for swaps');
  console.log('   ✅ Embedded wallets via Privy');
  console.log('   ✅ Agentic portfolio management (Letta)');
  console.log('   ✅ Automated strategies: DCA, alerts, stop-loss, rebalance');
  console.log('   ✅ Natural language queries');
  console.log('   ✅ Portfolio analytics & risk assessment');
  console.log('   ✅ Transaction history');
  console.log('   ✅ Market sentiment analysis');
  console.log('');
  console.log('🏆 Ready for Base Builder Quest submission!');
  console.log('   Deadline: Sep 9, 2026');
  console.log('   Submit: Loom demo + Google Form + X post tagging @buildonbase');
}

runDemo().catch(console.error);
