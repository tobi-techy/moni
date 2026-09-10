// Deterministic smoke test for Moni's pure logic + live-only invariants.
// Run with: npm run smoke
// Requires no API keys. Live-network tests (agent turns, Para provisioning)
// are skipped when their credentials are absent so CI stays green.

type StepResult = { name: string; pass: boolean; detail?: string };

async function main() {
  const results: StepResult[] = [];
  const user = `smoke-${Date.now()}`;
  const result = (name: string, pass: boolean, detail?: string) =>
    results.push({ name, pass, detail });

  const t0 = Date.now();

  // 1. Pure helpers — deterministic, no network
  {
    const { parseAmount, formatAmount } = await import('../src/swap.js');
    result('parseAmount: 100 USDC (6dp)', parseAmount('100', 6) === 100000000n);
    result('parseAmount: 0.5 AAPL (8dp)', parseAmount('0.5', 8) === 50000000n);
    result('parseAmount: rounds to decimals', parseAmount('1.23456789', 6) === 1234567n);
    result('formatAmount: round-trips 6dp', formatAmount(100000000n, 6) === '100');
    result('formatAmount: keeps fractional part', formatAmount(12500000n, 8) === '0.125');

    const { formatBalance, formatUSD } = await import('../src/base.js');
    result('formatBalance: whole units', formatBalance(200n * 10n ** 8n, 8) === '200');
    result('formatUSD: 8dp value', formatUSD(2000000000000n) === '$20000');

    const { encodeAttributionSuffix } = await import('../src/builder-code.js');
    const suffix = encodeAttributionSuffix('bc_es9rlwqi');
    result('builder code: ERC-8021 suffix is 29 bytes', suffix.slice(2).length === 58);
    result('builder code: contains 8021 schema header', suffix.startsWith('0x') && suffix.includes('8021'));

    const { paraIdentifier } = await import('../src/wallet.js');
    result('para identifier: namespaced per user', paraIdentifier(user) === `moni:${user}`);

    const { extractBasescanTokenUrls, stripBasescanTokenUrls, pollChoiceToToken } = await import('../src/rich.js');
    const tokenUrl = `https://basescan.org/token/0x${'a'.repeat(40)}`;
    result('rich: extracts basescan token URLs', extractBasescanTokenUrls(`see ${tokenUrl}`).length === 1);
    result('rich: ignores non-token basescan URLs', extractBasescanTokenUrls('https://basescan.org/tx/0xabcd').length === 0);
    result('rich: strips URL + eye icon from text', stripBasescanTokenUrls(`💰 $5\n👀 ${tokenUrl}`) === '💰 $5');
    result('rich: no URL means no change', stripBasescanTokenUrls('plain text') === 'plain text');
    result('poll: Confirm maps to confirm', pollChoiceToToken('Confirm') === 'confirm');
    result('poll: Cancel maps to cancel', pollChoiceToToken('Cancel') === 'cancel');
    result('poll: other choices stay natural language', pollChoiceToToken('Maybe later') === null);

    const { isPortfolioQuestion, requiresToolUse } = await import('../src/ai.js');
    result('facts: balance question triggers ground truth', isPortfolioQuestion('What is my balance?'));
    result('facts: idle chatter does not trigger ground truth', !isPortfolioQuestion('Hi, how are you?'));
    result('tools: price query forces tool use', requiresToolUse('What is the price of AAPL?'));
    result('tools: buy intent forces tool use', requiresToolUse('I want to buy 5 NVDA'));
    result('tools: greeting does not force tool use', !requiresToolUse('Hey whats up'));
  }

  // 2. B20 registry integrity
  {
    const { B20_TOKENS, CHAINLINK_PRICE_FEEDS, B20_DECIMALS } = await import('../src/constants.js');
    const symbols = Object.keys(B20_TOKENS);
    result('B20 registry: 13 tokenized stocks', symbols.length === 13, symbols.join(', '));
    result('B20 registry: every symbol has a Chainlink feed', symbols.every((s) => CHAINLINK_PRICE_FEEDS[s as any]));
    result('B20 registry: 8-decimal tokens', B20_DECIMALS === 8);
  }

  // 3. Live-only invariants — demo mode is gone, nothing may fake data
  if (!process.env.PARA_API_KEY) {
    const { resolveParaUser, getUserWalletAddress } = await import('../src/wallet.js');
    const resolved = await resolveParaUser(user);
    result('resolve: no key -> null (no fake demo wallet)', resolved === null, JSON.stringify(resolved));
    const addr = await getUserWalletAddress(user);
    result('wallet address: no key -> null (no demo address)', addr === null, String(addr));
  } else {
    result('resolve: PARA_API_KEY set — live wallet logic untested here (see live-check)', true);
  }

  // 4. Live agent loop only when a provider + keys are configured
  if (process.env.OPENROUTER_API_KEY) {
    const { sendAgentMessage } = await import('../src/ai.js');
    const reply = await sendAgentMessage(user, 'What is the price of AAPL?');
    result('openrouter: replies over live provider', reply.length > 10, reply.slice(0, 80));
  } else {
    result('openrouter agent loop: skipped (needs OPENROUTER_API_KEY)', true);
  }

  if (process.env.CENCORI_API_KEY && process.env.PROJECT_ID) {
    const { sendAgentMessage, isFirstContact } = await import('../src/ai.js');
    result('first contact (returns true once)', (await isFirstContact(user)) === true);
    const reply = await sendAgentMessage(user, 'Are you there?');
    result('agent: replies over live transport', reply.length > 10, reply.slice(0, 80));
  } else {
    result('agent loop: skipped (needs CENCORI_API_KEY + PROJECT_ID)', true);
  }

  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  const failed = results.filter(r => !r.pass);
  console.log('\n── Moni Smoke Test ──────────────────────────────');
  for (const r of results) {
    console.log(`${r.pass ? '✅' : '❌'} ${r.name}${r.detail ? `\n    → ${r.detail}` : ''}`);
  }
  console.log(`─────────────────────────────────────────────────`);
  console.log(`${results.length - failed.length}/${results.length} passed in ${elapsed}s`);
  if (failed.length > 0) {
    console.log(`\n❌ ${failed.length} failed.`);
    process.exitCode = 1;
  } else {
    console.log('All green.');
  }
}

main().catch((err) => {
  console.error('Smoke test crashed:', err);
  process.exitCode = 1;
});