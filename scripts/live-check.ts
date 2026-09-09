// Live conversational rehearsal.
// Run with: npm run live
// Requires: CENCORI_API_KEY + PROJECT_ID/PROJECT_SECRET (live-only build).
// Drives a realistic scripted conversation through the REAL agent loop and prints
// each reply verbatim + latency, so you can eyeball naturalness BEFORE recording.

type Probe = { say: string; note: string; expect?: RegExp };

const PROBES: Probe[] = [
  { say: 'hey Moni, are you there?', note: 'first contact → warm greeting', expect: /i.{0,30}(moni|here|hi|hey)|hi/i },
  { say: "what's my portfolio worth right now?", note: 'tool call: get_portfolio' },
  { say: 'hmm ok, how about NVDA — whats it trading at?', note: 'tool call: get_price; relaxed spelling' },
  { say: 'how risky am I btw?', note: 'tool call: get_risk analysis' },
  { say: 'im thinking about buying some AAPL. maybe $100?', note: 'tool call: get_swap_quote' },
  { say: 'yeah go ahead', note: 'tool call: execute_trade (agent-managed confirm)' },
  { say: 'did that go through clean?', note: 'should reference the trade just executed (memory), no tool needed' },
  { say: 'ok set up a weekly dca of $100 into tsla for me', note: 'strategy creation intent' },
  { say: 'alert me if tsla drops below $300', note: 'price alert intent' },
  { say: 'thanks, thatll do for now', note: 'warm closing, no tool needed' },
];

function strip(msg: string): string {
  return msg.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '');
}

async function main() {
  if (!process.env.CENCORI_API_KEY) {
    console.error('❌ Set CENCORI_API_KEY first.');
    process.exitCode = 1;
    return;
  }

  const { sendAgentMessage } = await import('../src/ai.js');
  const userId = `live-check-${Date.now()}`;

  console.log(`\nLive rehearsal for ${userId} — every word below is what a user would see in iMessage.\n`);

  let failed = 0;
  for (const [i, probe] of PROBES.entries()) {
    const t0 = Date.now();
    process.stdout.write(`\n[${i + 1}/${PROBES.length}] 💬 "${probe.say}"  (${probe.note})\n`);
    const reply = strip(await sendAgentMessage(userId, probe.say));
    const secs = ((Date.now() - t0) / 1000).toFixed(1);
    console.log(`   🤖 ${reply.split('\n').map(l => `   ${l}`).join('\n')}`);
    // sanity checks any human would fail on
    const issues: string[] = [];
    if (!reply.trim()) issues.push('EMPTY REPLY');
    if (/\{|\}|\\n\\n/.test(reply)) issues.push('RAW JSON / DOUBLED NEWLINES IN TEXT');
    if (/undefined|null/.test(reply)) issues.push('LEAKED "undefined"/"null"');
    if (probe.expect && !probe.expect.test(reply)) issues.push(`NO MATCH for ${probe.expect}`);
    if (secs > '60') issues.push(`SLOW (${secs}s)`);
    console.log(`   ⏱ ${secs}s   ${issues.length ? '❌ ' + issues.join('; ') : '✅ ok'}`);
    if (issues.length) failed++;
  }

  console.log(`\n${failed === 0 ? '🟢 All probes clean — voice is ready to record.' : `🔴 ${failed} probe(s) flagged — review above before recording.`}`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error('Live check crashed:', err);
  process.exitCode = 1;
});