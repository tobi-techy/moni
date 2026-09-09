// Deterministic demo-mode smoke test for all Moni agent flows.
// Run with: npm run smoke
// Requires no API keys — exercises the in-memory demo router + demo tools end to end.
process.env.DEMO_MODE = 'true';
process.env.SPECTRUM_MODE = 'terminal';

type StepResult = { name: string; pass: boolean; detail?: string };

async function main() {
  const { sendAgentMessage, isFirstContact } = await import('../src/ai.js');
  const { triggerProactiveCheck, sendDailySummary } = await import('../src/proactive.js');

  const results: StepResult[] = [];
  const user = `smoke-${Date.now()}`;
  const result = (name: string, pass: boolean, detail?: string) =>
    results.push({ name, pass, detail });

  const t0 = Date.now();

  // 1. First contact flag
  result('first contact (returns true once)', (await isFirstContact(user)) === true);
  const welcomeMsg = await sendAgentMessage(user, 'help');
  result('help: introduces Moni', /moni/i.test(welcomeMsg), welcomeMsg.slice(0, 80));

  // 1b. Onboarding: Para identifier is deterministic and demo resolution works
  const { resolveParaUser, DEMO_WALLET_ADDRESS, getUserWalletAddress, paraIdentifier } = await import('../src/wallet.js');
  result('para identifier: namespaced per user', paraIdentifier(user) === `moni:${user}`, paraIdentifier(user));
  const resolved = await resolveParaUser(user);
  result('resolve: finds a demo wallet in DEMO_MODE', resolved?.walletAddress === DEMO_WALLET_ADDRESS, resolved?.walletAddress || 'none');
  result('wallet address: demo helper returns an address', (await getUserWalletAddress(user)) === DEMO_WALLET_ADDRESS);

  // 2. Portfolio
  const portfolio = await sendAgentMessage(user, "What's my portfolio worth?");
  result('portfolio: shows holdings + $ value', /\$\d/.test(portfolio), portfolio.slice(0, 80));

  // 3. Price
  const price = await sendAgentMessage(user, "What's NVDA trading at?");
  result('price: returns NVDA price', /NVDA/i.test(price) && /\$\d/.test(price), price.slice(0, 80));

  // 4. Risk
  const risk = await sendAgentMessage(user, 'How risky is my portfolio?');
  result('risk: returns risk analysis', /risk/i.test(risk), risk.slice(0, 80));

  // 5. Watchlist
  const watchlist = await sendAgentMessage(user, 'What is on my watchlist?');
  result('watchlist: returns watchlist', /watchlist/i.test(watchlist), watchlist.slice(0, 80));

  // 6. Rebalance
  const rebalance = await sendAgentMessage(user, 'Rebalance my portfolio');
  result('rebalance: returns rebalance advice', /rebalance/i.test(rebalance), rebalance.slice(0, 80));

  // 7. Stop-loss guidance
  const stopLoss = await sendAgentMessage(user, 'Set a stop-loss for AAPL at $180');
  result('stop-loss: returns set-up guidance', /stop-loss/i.test(stopLoss), stopLoss.slice(0, 80));

  // 8. DCA intent
  const dca = await sendAgentMessage(user, "Let's DCA $200 of AAPL weekly");
  result('dca: returns plan confirmation', /DCA/i.test(dca), dca.slice(0, 80));

  // 9. Full trade lifecycle: quote -> confirm -> tx logged -> history
  const quote = await sendAgentMessage(user, 'Buy $100 of AAPL with USDC');
  result('quote: returns quote + confirm ask', /Quote:/i.test(quote) && /confirm/i.test(quote), quote.slice(0, 80));

  const afterQuoteCancel = await sendAgentMessage(user, 'cancel');
  result('cancel: clears pending quote', /no worries|cleared/i.test(afterQuoteCancel), afterQuoteCancel.slice(0, 80));

  const noPending = await sendAgentMessage(user, 'confirm');
  result('confirm after cancel: no pending trade', /pending trade/i.test(noPending), noPending.slice(0, 80));

  const quote2 = await sendAgentMessage(user, 'Buy $50 of TSLA with USDC');
  result('quote #2 (fresh)', /Quote:/i.test(quote2), quote2.slice(0, 80));

  const confirm = await sendAgentMessage(user, 'confirm');
  result('confirm: executes demo trade', /Done\./i.test(confirm), confirm.slice(0, 80));

  const history = await sendAgentMessage(user, 'Show my transaction history');
  result('history: shows logged trade', /Transaction History/i.test(history) && /TSLA/i.test(history), history.slice(0, 80));

  // 10. Alerts check
  const alerts = await sendAgentMessage(user, 'Check my price alerts');
  result('alerts: returns alert status', /alert/i.test(alerts), alerts.slice(0, 80));

  // 11. Fallback + small talk don't crash
  const fallback = await sendAgentMessage(user, 'zzz qqq');
  result('fallback: graceful reply', fallback.length > 10, fallback.slice(0, 80));
  const smallTalk = await sendAgentMessage(user, 'hey, how are you doing?');
  result('small talk: graceful reply', smallTalk.length > 10, smallTalk.slice(0, 80));

  // 12. Proactive pipeline works on demand
  const triggered = await triggerProactiveCheck(user);
  result('proactive check: runs without throwing', typeof triggered === 'object');
  let digestSent = '';
  await sendDailySummary(user, async (_uid: string, msg: string) => { digestSent = msg; });
  result('daily digest: produces portfolio summary', /\$\d|\$20,400|Portfolio|\$/.test(digestSent), digestSent.slice(0, 80));

  // 13. Second contact is not "first"
  result('second contact: not flagged first', (await isFirstContact(user)) === false);

  // 14. Verify BigInt-safe persistence round-trips (transaction amounts are bigints)
  const { getTradingMemory, bigintJSONReplacer, bigintJSONReviver } = await import('../src/ai.js');
  const mem: any = await getTradingMemory(user);
  const roundTripped = JSON.parse(
    JSON.stringify(mem.transactionHistory || [], bigintJSONReplacer),
    bigintJSONReviver
  );
  const first: any = roundTripped?.[0];
  result('persistence: BigInt amounts survive store round-trip', typeof first?.fromAmount === 'bigint');

  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  const failed = results.filter(r => !r.pass);
  console.log('\n── Moni Smoke Test ──────────────────────────────');
  for (const r of results) {
    console.log(`${r.pass ? '✅' : '❌'} ${r.name}${r.detail ? `\n    → ${r.detail}` : ''}`);
  }
  console.log(`─────────────────────────────────────────────────`);
  console.log(`${results.length - failed.length}/${results.length} passed in ${elapsed}s`);
  if (failed.length > 0) {
    console.log(`\n❌ ${failed.length} failed — fix before recording the demo.`);
    process.exitCode = 1;
  } else {
    console.log('All flows green — ready to record.');
  }
}

main().catch((err) => {
  console.error('Smoke test crashed:', err);
  process.exitCode = 1;
});