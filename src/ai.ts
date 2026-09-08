import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { Cencori, type ChatResponse } from 'cencori';
import { CENCORI_MODEL, CENCORI_TRANSPORT, DEMO_MODE } from './env.js';
import { TOOL_DEFINITIONS, ToolName } from './agent-tools.js';
import { B20_TOKENS } from './constants.js';
import { bigintJSONReplacer, bigintJSONReviver } from './bigint-json.js';
import { runSessionTurn } from './cencori-session.js';

export { bigintJSONReplacer, bigintJSONReviver };

export interface AgentContext {
  walletConnected?: boolean;
  isFirstContact?: boolean;
}

// ─── Types ──────────────────────────────────────────────────────────────────

export interface TradingMemory {
  watchlist: string[];
  riskParams: {
    maxPositionSizeUSD: number;
    maxDailyLossUSD: number;
    autoTradeEnabled: boolean;
  };
  activeStrategies: Array<{
    type: 'dca' | 'stop_loss' | 'take_profit' | 'rebalance' | 'price_alert';
    params: any;
    active: boolean;
  }>;
  preferences: {
    defaultSlippage: number;
    preferredTokens: string[];
    notificationLevel: 'all' | 'trades' | 'alerts' | 'none';
  };
  transactionHistory?: any[];
  conversationContext?: {
    lastTopic: string;
    pendingDecision: string;
    discussedTokens: string[];
  };
  pendingQuote?: any;
}

interface AgentMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_calls?: Array<{
    id: string;
    type: 'function';
    function: { name: string; arguments: string };
  }>;
  tool_call_id?: string;
}

interface CencoriToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: {
      type: 'object';
      properties: Record<string, any>;
      required: string[];
    };
  };
}

// ─── System Prompt ──────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are Moni — a sharp, conversational portfolio manager and market analyst for Coinbase Tokenized Stocks (B20 token standard) on the Base network. You talk to users over iMessage, so keep messages natural, warm, and tight.

WHO YOU ARE
A seasoned institutional trader with 15+ years on the desk. You've seen bull runs, flash crashes, and everything between. You manage tokenized equities — AAPL, NVDA, MSFT, GOOGL, META, TSLA, AMZN, COIN, INTC, MSTR, CRCL, SNDK, SPCX — all tradeable as B20 tokens against USDC, completely on-chain. You're not a chatbot. You're the friend who actually understands markets, finance, stocks, and investing.

HOW YOU TALK
- Sound like a smart friend with strong market instincts, not a financial terminal.
- Never narrate your process or show intent. No "let me check", no "thinking...", no "fetching...", no "one sec". Just answer, like two people chatting.
- Be direct: if NVDA is overbought, say so. If a position risks concentration, flag it plainly.
- Natural prose. "Your AAPL is up 12% this week — worth about $22k now" beats a formatted table.
- Concise but substantive. Two clear sentences with real insight > a wall of text.
- Match the user's energy: casual question → casual answer; serious allocation question → precise detail.
- No markdown, no emoji, no bullet-point dumps unless the user explicitly asks.
- iMessage formatting: short lines, sentence case, no dense tables or key/value dumps. One thought per line.
- End most replies with a single next step — a specific question or offer — so the conversation keeps moving.
- If a trade or strategy is risky or losing, be honest and suggest a concrete alternative — never coach someone into a bad bet.

WHAT YOU CAN DO (your tools)
1. Portfolio & Prices — holdings, real-time prices, balances, watchlist
2. Trading — swap quotes (USDC <-> B20 tokens) and trade execution (always confirm first)
3. Risk & Automation — stop-losses, take-profits, price alerts, rebalancing, risk analysis
4. Memory — keep track of preferences, watchlist, active strategies across sessions

FIRST CONTACT & SMALL TALK
- Greetings, "hey", "hi", "who are you" → answer warmly and briefly, then ask what they'd like to do.
- If this looks like the user's first message, introduce yourself in 1-2 warm lines, show 2-3 concrete things you can do, and invite one specific action. No capability dumps.
- Mention you work with Coinbase tokenized stocks on Base, and if their wallet isn't connected yet, gently offer to set that up when they ask about holdings, prices, or trades.

HOW YOU THINK (like a real advisor)
- "How's my portfolio?" → pull holdings, weigh returns, flag what's concentrated or correlated, offer next steps
- "Buy some NVDA" → check balance → get a quote → present it cleanly → wait for confirmation → execute
- "Is my portfolio risky?" → pull risk metrics, name what's concentrated, suggest concrete fixes
- "What should I invest in?" → inspect allocation, reason from their risk params and current prices

RULES YOU NEVER BREAK
- Never execute a trade without explicit confirmation (unless the user enabled auto-trade with limits).
- Respect their risk parameters: max position size, max daily loss, sector caps.
- Base mainnet only, and only the tokenized stocks listed above plus USDC.
- Flag tax implications naturally when relevant (wash sales, short-term vs long-term).
- If a tool fails, explain the failure and offer an alternative path. Never fabricate data.
- Chain related tool calls in a single turn for efficiency (e.g. price + portfolio together).
- Destructive actions (selling everything, deleting a strategy, oversized allocations) always get a plain-language heads-up and confirmation before you act.
- You are an expert assistant, not a licensed financial advisor; say so plainly if pressed.

MEMORY & CONTEXT
- Remember what the user cares about: watchlist stocks, risk style, strategies running, pending decisions.
- Reference earlier conversations naturally: "Last time you mentioned trimming NVDA — still top of mind?"
- Track tokens they discuss and strategies they've set, and reuse that context to make answers feel personal.

YOU ARE NOT
- A command processor. Never mention slash commands, menus, or "type /command" — users just chat.
- A raw data dumper. Translate every result into natural human speech — no JSON, ever.
- A pushover. If a decision is risky, say it plainly. Clarity serves the user more than comfort.`;

// ─── Tool Definitions (OpenAI function-calling format) ──────────────────────

const CENCORI_TOOLS: CencoriToolDefinition[] = TOOL_DEFINITIONS.map(tool => ({
  type: 'function',
  function: {
    name: tool.name,
    description: tool.description,
    parameters: {
      type: 'object',
      properties: tool.parameters.properties,
      required: [...tool.parameters.required],
    },
  },
}));

// ─── Cencori Client (lazy — only needed for real AI calls) ─────────────────

function getCencori(): Cencori {
  return new Cencori();
}

// ─── Per-user serialization (prevents rapid texts from clobbering history) ──

const userQueues = new Map<string, Promise<unknown>>();

async function serializeTurn<T>(userId: string, fn: () => Promise<T>): Promise<T> {
  const prev = userQueues.get(userId) ?? Promise.resolve();
  const run = prev.catch(() => {}).then(fn);
  const guard = run.catch(() => {});
  userQueues.set(userId, guard);
  void guard.finally(() => {
    if (userQueues.get(userId) === guard) userQueues.delete(userId);
  });
  return run;
}

// ─── Cencori call with one retry (transient API hiccups) ───────────────────

async function chatWithRetry(payload: {
  model: string;
  messages: AgentMessage[];
  tools: CencoriToolDefinition[];
  toolChoice: 'auto';
  temperature: number;
}): Promise<ChatResponse> {
  const attempt = () => getCencori().ai.chat(payload);
  try {
    return await attempt();
  } catch (error) {
    console.warn('Cencori chat failed, retrying once...', (error as Error)?.message);
    await new Promise(resolve => setTimeout(resolve, 700));
    return await attempt();
  }
}

// ─── User snapshot injected each request so the agent actually "knows" them ─

function buildContextBlock(memory: TradingMemory, firstContact: boolean, ctx?: AgentContext): string {
  const lines: string[] = [];

  const walletConnected = ctx?.walletConnected === false ? 'NOT connected yet' : 'connected';
  lines.push(`- Wallet: ${walletConnected}`);
  if (ctx?.walletConnected === false) {
    lines.push('- Offer to connect their wallet when they ask about holdings, prices, or trades. Assume nothing until they do.');
  }
  if (firstContact) {
    lines.push('- This is the user\'s FIRST message ever. Introduce yourself in 1-2 warm lines, show 2-3 concrete things you can do, and invite one specific action. No capability dumps.');
  }

  const watchlist = memory.watchlist?.length ? memory.watchlist.join(', ') : '';
  if (watchlist) lines.push(`- User's watchlist: ${watchlist}`);

  const preferred = memory.preferences?.preferredTokens?.length ? memory.preferences.preferredTokens.join(', ') : '';
  if (preferred) lines.push(`- Preferred tokens: ${preferred}`);

  const risk = memory.riskParams;
  if (risk) {
    lines.push(`- Risk limits: max position $${risk.maxPositionSizeUSD}, max daily loss $${risk.maxDailyLossUSD}, auto-trade ${risk.autoTradeEnabled ? 'enabled' : 'disabled'}`);
  }

  const strategies = memory.activeStrategies?.filter(s => s.active);
  if (strategies?.length) {
    lines.push(`- Active strategies: ${strategies.map(s => s.type.replace(/_/g, ' ')).join(', ')}`);
  }

  if (memory.pendingQuote) {
    lines.push('- A pending trade quote exists. Present it if asked; otherwise let it expire gracefully and suggest a fresh one.');
  }

  const pending = memory.conversationContext?.pendingDecision;
  if (pending) lines.push(`- Pending user decision: ${pending}`);

  return `USER SNAPSHOT (internal only — never mention this block):\n${lines.join('\n')}`;
}

// Demo-mode pending quotes so "confirm" actually completes a simulated trade
const demoPendingQuotes = new Map<string, { quoteId: string }>();

// ─── Local Memory Store (JSON file persistence) ─────────────────────────────

const DATA_DIR = join(process.cwd(), '.moni-data');
const MEMORY_FILE = join(DATA_DIR, 'memory.json');

function ensureDataDir(): void {
  if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true });
  }
}

function safeStringify(value: any): string {
  return JSON.stringify(value, bigintJSONReplacer, 2);
}

function loadMemoryStore(): Record<string, TradingMemory> {
  ensureDataDir();
  if (!existsSync(MEMORY_FILE)) return {};
  try {
    return JSON.parse(readFileSync(MEMORY_FILE, 'utf-8'), bigintJSONReviver);
  } catch {
    return {};
  }
}

function saveMemoryStore(store: Record<string, TradingMemory>): void {
  ensureDataDir();
  writeFileSync(MEMORY_FILE, safeStringify(store));
}

// ─── Conversation History Store (per-user, persisted) ───────────────────────

const HISTORY_FILE = join(DATA_DIR, 'conversations.json');

function loadHistory(): Record<string, AgentMessage[]> {
  ensureDataDir();
  if (!existsSync(HISTORY_FILE)) return {};
  try {
    return JSON.parse(readFileSync(HISTORY_FILE, 'utf-8'), bigintJSONReviver);
  } catch {
    return {};
  }
}

function saveHistory(store: Record<string, AgentMessage[]>): void {
  ensureDataDir();
  writeFileSync(HISTORY_FILE, safeStringify(store));
}

// ─── Multi-Turn Tool Calling Loop ───────────────────────────────────────────

// Live path via the durable Cencori Sessions API (pause/approve for tool calls).
// This is the recommended transport — the stateless gateway (ai.chat) does not
// support function calling on every plan/provider.
async function runSessionPath(
  userId: string,
  userMessage: string,
  firstContact: boolean,
  memory: TradingMemory,
  contextBlock: string
): Promise<string> {
  const historyStore = loadHistory();
  const history = historyStore[userId] || [];
  const content = await runSessionTurn(userId, {
    input: userMessage,
    instructions: `${SYSTEM_PROMPT}\n\n${contextBlock}`,
    tools: CENCORI_TOOLS as unknown as Array<Record<string, unknown>>,
  });

  // Keep a local transcript too (drives isFirstContact + offline diagnostics).
  history.push({ role: 'user', content: userMessage });
  history.push({ role: 'assistant', content });
  historyStore[userId] = history;
  saveHistory(historyStore);
  return content;
}

async function runAgentLoop(userId: string, userMessage: string, ctx?: AgentContext): Promise<string> {
  const historyStore = loadHistory();
  const history = historyStore[userId] || [];
  const firstContact = (ctx?.isFirstContact ?? history.length === 0) && history.length === 0;

  const memory = await getTradingMemory(userId);
  const contextBlock = buildContextBlock(memory, firstContact, ctx);

  if (CENCORI_TRANSPORT !== 'gateway') {
    return runSessionPath(userId, userMessage, firstContact, memory, contextBlock);
  }

  const messages: AgentMessage[] = [
    { role: 'system', content: `${SYSTEM_PROMPT}\n\n${contextBlock}` },
    ...history,
    { role: 'user', content: userMessage },
  ];

  // Cap history to the last ~36 messages to stay within context limits
  if (messages.length > 38) {
    messages.splice(1, messages.length - 38);
    history.splice(0, history.length - 36);
  }

  let turns = 6;

  while (turns-- > 0) {
    const response = await chatWithRetry({
      model: CENCORI_MODEL,
      messages,
      tools: CENCORI_TOOLS,
      toolChoice: 'auto',
      temperature: 0.3,
    });

    // Persistent history: record user message on the first turn
    if (turns === 5) {
      history.push({ role: 'user', content: userMessage });
    }

    // No tool calls — final answer
    if (!response.toolCalls || response.toolCalls.length === 0) {
      const content = response.content || "I'm not sure what to say — try rephrasing that.";
      history.push({ role: 'assistant', content });
      historyStore[userId] = history;
      saveHistory(historyStore);
      return content;
    }

    // Record assistant turn with tool calls
    const assistantTurn: AgentMessage = {
      role: 'assistant',
      content: response.content ?? '',
      tool_calls: response.toolCalls,
    };
    history.push(assistantTurn);
    messages.push(assistantTurn);

    // Execute each tool call and feed results back
    for (const toolCall of response.toolCalls) {
      const { name, arguments: argsStr } = toolCall.function;
      let args: Record<string, any> = {};
      try {
        args = JSON.parse(argsStr);
      } catch {
        args = {};
      }
      args.userId = userId;

      const { executeTool } = await import('./agent-tools.js');
      const result = await executeTool(name as ToolName, args);

      const toolTurn: AgentMessage = {
        role: 'tool',
        content: JSON.stringify(result, bigintJSONReplacer),
        tool_call_id: toolCall.id,
      };
      history.push(toolTurn);
      messages.push(toolTurn);
    }
  }

  const fallback = "I'm going in circles trying to figure that out. Let me try a simpler approach — can you rephrase?";
  history.push({ role: 'assistant', content: fallback });
  historyStore[userId] = history;
  saveHistory(historyStore);
  return fallback;
}

// ─── Demo Mode Handler ──────────────────────────────────────────────────────

async function handleDemoMessage(userId: string, message: string): Promise<string> {
  const { executeTool } = await import('./agent-tools.js');
  const lower = message.toLowerCase();

  // Risk analysis
  if (lower.includes('risk') || lower.includes('analyze') || lower.includes('how risky')) {
    const result = await executeTool('analyze_portfolio_risk' as ToolName, { userId });
    if (result.success && result.data) {
      const { formatRiskAnalysisHuman } = await import('./conversation.js');
      return formatRiskAnalysisHuman(result.data);
    }
    return result.error || 'Could not analyze risk right now.';
  }

  // Rebalance
  if (lower.includes('rebalance')) {
    const result = await executeTool('check_rebalance_needed' as ToolName, { userId });
    if (result.success && result.data) {
      const { formatRebalanceHuman } = await import('./conversation.js');
      return formatRebalanceHuman(result.data);
    }
    return result.error || 'Could not check rebalance.';
  }

  // Stop-loss
  if (lower.includes('stop.loss') || lower.includes('stop loss') || lower.includes('stoploss') || lower.includes('stop-loss')) {
    if (lower.includes('create') || lower.includes('set')) {
      return "To set a stop-loss I need a few details: which token, your stop price, target price, and how much. Something like: 'Set a stop-loss for AAPL at $180, target $250, for 10 shares'";
    }
    const result = await executeTool('get_active_stop_losses' as ToolName, { userId });
    if (result.success && result.data) {
      const { formatStopLossHuman } = await import('./conversation.js');
      return formatStopLossHuman(result.data);
    }
    return result.error || 'Could not fetch your stop-losses.';
  }

  // DCA plan
  if (lower.includes('dca') || lower.includes('dollar cost') || /(invest|put|add|buy)\b.*\b(every\s+)?(week|bi.?week|fortnight|month)/i.test(lower)) {
    const frequency = /month/i.test(lower) ? 'monthly' : /(bi.?week|fortnight)/i.test(lower) ? 'bi-weekly' : 'weekly';
    const amountMatch = message.match(/\$?(\d+(?:\.\d+)?)/);
    const amount = amountMatch ? amountMatch[1] : '100';
    const tokens = extractTokens(message);
    const symbol = tokens.find(t => t !== 'USDC') || 'a token';
    return `Got it — DCA $${amount} of ${symbol} ${frequency}. I'll auto-execute those buys and watch for dips. Want to pair it with a stop-loss or a price alert?`;
  }

  // Portfolio
  if (lower.includes('portfolio') || lower.includes('holdings') || (lower.includes('balance') && !lower.includes('rebalance')) || lower.includes('worth')) {
    const result = await executeTool('get_portfolio' as ToolName, { userId });
    if (result.success && result.data) {
      const { formatPortfolioHuman } = await import('./conversation.js');
      return formatPortfolioHuman(result.data);
    }
    return result.error || 'Could not fetch your portfolio.';
  }

  // Watchlist
  if (lower.includes('watchlist')) {
    const result = await executeTool('get_watchlist_prices' as ToolName, { userId });
    if (result.success && result.data) {
      const { formatWatchlistHuman } = await import('./conversation.js');
      return formatWatchlistHuman(result.data);
    }
    return result.error || 'Could not fetch your watchlist.';
  }

  // Price queries (only when the word is actually a known ticker — otherwise
  // "price alerts" or "how's it going" would be misrouted here)
  const priceMatches = message.match(/(?:price|quote)\s+(?:of\s+)?([A-Z]{2,8})/i) ||
    message.match(/(?:how much|what['']s)\s+(?:is\s+)?\$?([A-Z]{2,8})/i);
  const priceSymbol = priceMatches?.[1]?.toUpperCase();
  if (priceSymbol && B20_TOKENS[priceSymbol as keyof typeof B20_TOKENS] && priceMatches) {
    const result = await executeTool('get_price' as ToolName, { symbol: priceSymbol });
    if (result.success && result.data) {
      const { formatPriceHuman } = await import('./conversation.js');
      return formatPriceHuman(result.data);
    }
    return result.error || 'Could not fetch that price.';
  }

  // Buy/sell/trade
  if (lower.includes('buy') || lower.includes('sell') || lower.includes('trade')) {
    const tokens = extractTokens(message);
    if (tokens.length >= 2) {
      const fromToken = tokens.find(t => t === 'USDC') || tokens[0];
      const toToken = tokens.find(t => t !== 'USDC') || tokens[1];
      const amountMatch = message.match(/\$?(\d+(?:\.\d+)?)/);
      const amount = amountMatch ? amountMatch[1] : '100';

      if (lower.includes('sell')) {
        const quoteResult = await executeTool('get_swap_quote' as ToolName, {
          userId, fromToken: toToken, toToken: fromToken, amount
        });
        if (quoteResult.success) {
          demoPendingQuotes.set(userId, { quoteId: quoteResult.data.quoteId });
          const { formatQuoteHuman } = await import('./conversation.js');
          return formatQuoteHuman(quoteResult.data) + '\n\nReply "confirm" if you want me to execute.';
        }
        return quoteResult.error || 'Could not get a quote.';
      } else {
        const quoteResult = await executeTool('get_swap_quote' as ToolName, {
          userId, fromToken, toToken, amount
        });
        if (quoteResult.success) {
          demoPendingQuotes.set(userId, { quoteId: quoteResult.data.quoteId });
          const { formatQuoteHuman } = await import('./conversation.js');
          return formatQuoteHuman(quoteResult.data) + '\n\nReply "confirm" if you want me to execute.';
        }
        return quoteResult.error || 'Could not get a quote.';
      }
    }
    return "I need to know what you're trading. Try something like: 'Buy $100 of AAPL with USDC' or 'Sell 10 NVDA for USDC'";
  }

  // Confirm trade
  if (lower.includes('confirm') || lower === 'yes' || lower === 'yep' || lower.includes('execute') || lower === "let's do it") {
    const pending = demoPendingQuotes.get(userId);
    if (!pending) {
      return "You don't have a pending trade right now. Tell me what you'd like to buy or sell — for example, 'Buy $500 of AAPL with USDC'.";
    }
    const execResult = await executeTool('execute_trade' as ToolName, { userId, quoteId: pending.quoteId });
    demoPendingQuotes.delete(userId);
    if (execResult.success && execResult.data) {
      const { formatTradeResultHuman } = await import('./conversation.js');
      return formatTradeResultHuman(execResult.data);
    }
    return execResult.error || "The trade didn't go through. Want to try again?";
  }

  // Cancel pending trade
  if (lower === 'cancel' || lower === 'cancel trade' || lower.includes('never mind') || lower.includes('actually don')) {
    if (demoPendingQuotes.has(userId)) {
      demoPendingQuotes.delete(userId);
      const mem = await getTradingMemory(userId);
      (mem as any).pendingQuote = undefined;
      await setTradingMemory(userId, mem as any);
      return "No worries — quote cleared. Anything else I can help with?";
    }
    return "Nothing to cancel — no trade was pending. What would you like to do?";
  }

  // Alerts
  if (lower.includes('alert')) {
    const result = await executeTool('check_price_alerts' as ToolName, { userId });
    if (result.success && result.data) {
      const { formatAlertsHuman } = await import('./conversation.js');
      return formatAlertsHuman(result.data);
    }
    return result.error || 'Could not check alerts.';
  }

  // Transaction history
  if (lower.includes('history') || lower.includes('transactions') || lower.includes('txns') || lower.includes('tx history')) {
    const { getTransactionHistory, formatTransactionHistory } = await import('./history.js');
    const txs = await getTransactionHistory(userId, 5);
    if (txs.length === 0) return "You don't have any transactions yet. Buy or sell something and it'll show up here.";
    return formatTransactionHistory(txs);
  }

  // Help
  if (lower.includes('help') || lower.includes('what can you do')) {
    return "I'm Moni, your portfolio manager for tokenized stocks on Base. Here's what I can do:\n\n" +
      "Ask about your portfolio — \"What's my portfolio worth?\"\n" +
      "Check prices — \"What's NVDA trading at?\"\n" +
      "Trade — \"Buy $500 of AAPL with USDC\"\n" +
      "Risk analysis — \"How risky is my portfolio?\"\n" +
      "Stop-losses — \"Set a stop-loss for AAPL at $180\"\n" +
      "Price alerts — \"Alert me if TSLA drops below $200\"\n" +
      "Rebalancing — \"Rebalance to 40% AAPL, 30% NVDA, 30% MSFT\"\n" +
      "Watchlist — \"What's on my watchlist?\"\n\n" +
      'Just talk to me naturally — no commands needed.';
  }

  return "I'm here for your tokenized stock portfolio on Base. Ask me about prices, your portfolio, trades, risk, or strategy. What's on your mind?";
}

// ─── Token Extraction ───────────────────────────────────────────────────────

function extractTokens(text: string): string[] {
  const tokens = Object.keys(B20_TOKENS);
  const found: string[] = [];
  const upper = text.toUpperCase();

  for (const token of tokens) {
    if (upper.includes(token) || upper.includes(token.toLowerCase())) {
      found.push(token);
    }
  }

  if (upper.includes('USDC') || upper.includes('usdc')) {
    found.push('USDC');
  }

  return [...new Set(found)];
}

// ─── Public API ─────────────────────────────────────────────────────────────

export async function sendAgentMessage(userId: string, message: string, ctx?: AgentContext): Promise<string> {
  if (DEMO_MODE === 'true') {
    return handleDemoMessage(userId, message);
  }

  try {
    return await serializeTurn(userId, () => runAgentLoop(userId, message, ctx));
  } catch (error: any) {
    console.error('Agent error:', error?.message || error);
    // Already-mapped, human-safe messages pass straight through.
    if (error?.friendly) return error.message;
    const status = error?.statusCode;
    if (status === 401 || status === 403 || status === 404 || /(invalid|missing|not configured) api key/i.test(error?.message || '')) {
      return "I can't reach my brain right now — my AI connection isn't configured correctly. Ask whoever runs me to check the CENCORI_API_KEY.";
    }
    if (status && status >= 500) {
      return "My AI backend is having a rough moment. Give me a few seconds and try again.";
    }
    return "Something hiccuped on my end. Try again in a few seconds — if it keeps happening, say 'help'.";
  }
}

// Demo users aren't persisted as conversation history, so track first-contact in-memory
const demoVisited = new Set<string>();

export async function isFirstContact(userId: string): Promise<boolean> {
  if (DEMO_MODE === 'true') {
    if (demoVisited.has(userId)) return false;
    demoVisited.add(userId);
    return true;
  }
  const store = loadHistory();
  const history = store[userId];
  return !history || history.length === 0;
}

export async function getTradingMemory(userId: string): Promise<TradingMemory> {
  const store = loadMemoryStore();
  return store[userId] || {
    watchlist: ['AAPL', 'NVDA', 'MSFT'],
    riskParams: {
      maxPositionSizeUSD: 10000,
      maxDailyLossUSD: 1000,
      autoTradeEnabled: false,
    },
    activeStrategies: [],
    preferences: {
      defaultSlippage: 1.0,
      preferredTokens: ['AAPL', 'NVDA', 'MSFT'],
      notificationLevel: 'trades',
    },
    transactionHistory: [],
    conversationContext: {
      lastTopic: '',
      pendingDecision: '',
      discussedTokens: [],
    },
  };
}

export async function setTradingMemory(userId: string, memory: Partial<TradingMemory>): Promise<void> {
  const store = loadMemoryStore();
  const current = store[userId] || {
    watchlist: ['AAPL', 'NVDA', 'MSFT'],
    riskParams: { maxPositionSizeUSD: 10000, maxDailyLossUSD: 1000, autoTradeEnabled: false },
    activeStrategies: [],
    preferences: { defaultSlippage: 1.0, preferredTokens: ['AAPL', 'NVDA', 'MSFT'], notificationLevel: 'trades' },
    transactionHistory: [],
    conversationContext: { lastTopic: '', pendingDecision: '', discussedTokens: [] },
  };
  store[userId] = { ...current, ...memory };

  // Support deletion: a key explicitly set to `undefined` removes it from storage
  for (const key of Object.keys(current)) {
    if (key in memory && (memory as any)[key] === undefined) {
      delete (store[userId] as any)[key];
    }
  }

  saveMemoryStore(store);
}

// Backward-compatible alias
export async function updateUserMemory(userId: string, memory: any): Promise<void> {
  await setTradingMemory(userId, memory);
}