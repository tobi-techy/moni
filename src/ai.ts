import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { Cencori, type ChatResponse } from 'cencori';
import {
  CENCORI_MODEL,
  CENCORI_TRANSPORT,
  AI_PROVIDER,
  OPENROUTER_MODEL,
  OPENAI_API_KEY,
  OPENAI_BASE_URL,
} from './env.js';
import { TOOL_DEFINITIONS, ToolName } from './agent-tools.js';
import { bigintJSONReplacer, bigintJSONReviver } from './bigint-json.js';
import { runSessionTurn, FriendlyAgentError } from './cencori-session.js';
import { sanitizeOutgoingText } from './text.js';
import { getUserWalletAddress } from './wallet.js';
import { getPortfolio, formatBalance, formatUSD, getB20ExplorerLink } from './base.js';
import { B20_DECIMALS } from './constants.js';

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
- Natural prose. "AAPL is up 12% this week" reads cleaner than a formatted table — but only state numbers that actually came out of your tools. Never invent prices, balances, holdings, or returns.
- Concise but substantive. Two clear sentences with real insight > a wall of text.
- Match the user's energy: casual question → casual answer; serious allocation question → precise detail.
- No markdown, no emoji, no bullet-point dumps unless the user explicitly asks.
- Never use em-dashes (—) in your replies. Use commas, periods, or plain hyphens instead.
- iMessage formatting: short lines, sentence case, no dense tables or key/value dumps. One thought per line.
- When you list a token or holding, include its BaseScan view link (the 'link' field from tool results, e.g. https://basescan.org/token/0x...) so the user can verify it on-chain.
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
- Never invent portfolio data. Holdings, balances, prices, shares, percentages, and dollar values must come verbatim from tool results. If the portfolio or balance returns empty or zero, say so plainly — never dream up positions to make the answer sound better.
- Balance, holdings, and portfolio questions: the GROUND TRUTH PORTFOLIO block or the get_portfolio tool result is the only source of truth. Repeat it as-is. Never add positions, totals, percentages, or returns that are not in that data.
- Watchlist and preferred tokens are the user's interests, NOT their holdings. Never present them as positions.
- When the user asks to see their wallet or wallet address, call get_wallet_info and give them the exact address and explorer link. Do not recite holdings unless they asked for them.
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

export function getAIConfig(): { model: string; transport: string; provider: string; toolCount: number } {
  return {
    provider: AI_PROVIDER,
    model: AI_PROVIDER === 'cencori' ? CENCORI_MODEL : OPENROUTER_MODEL,
    transport: AI_PROVIDER === 'cencori' ? CENCORI_TRANSPORT : 'openai-compat',
    toolCount: CENCORI_TOOLS.length,
  };
}

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

// ─── Model call: Cencori gateway OR any OpenAI-compatible endpoint ─────────

type ModelCallPayload = {
  model: string;
  messages: AgentMessage[];
  tools: CencoriToolDefinition[];
  toolChoice: 'auto' | 'required';
  temperature: number;
};

// Some free models (e.g. the Nvidia nemotron / gemma free tiers on OpenRouter)
// respond to tool requests by writing a JSON tool-call into `content` instead
// of the native `tool_calls` field. We recover those so trading tools still
// execute. Matching is strict against OUR tool names — never a guessed name.
type ToolResultSummary = {
  tool: string;
  args: Record<string, any>;
  result: any;
};

// When the model loops or exhausts its turn budget, build a plain-language
// answer straight from the tool results we already collected, so the user
// still gets a useful reply instead of "going in circles".
function synthesizeToolAnswer(userMessage: string, calls: ToolResultSummary[]): string {
  const parts: string[] = [];

  for (const call of calls) {
    const { tool, args, result } = call;
    if (!result) continue;

    if (tool === 'get_price' && result.success) {
      const d = result.data;
      parts.push(`${d.symbol} is trading at $${Number(d.price).toFixed(2)} right now.`);
    } else if ((tool === 'get_portfolio' || tool === 'get_wallet_info') && result.success) {
      const d = result.data;
      if (Array.isArray(d) && d.length === 0) {
        parts.push('Your portfolio is currently empty. Your wallet address is ready whenever you want to trade.');
      } else if (Array.isArray(d)) {
        const total = d.reduce((s: bigint, h: any) => s + (h.valueUSD ?? 0n), 0n);
        const tokens = d.map((h: any) => `${h.symbol} ${formatUSD(h.valueUSD)}`).join(', ');
        parts.push(`Your portfolio is worth ${formatUSD(total)} total (${tokens}).`);
      } else if (d?.walletAddress) {
        parts.push(`Your wallet is ${d.walletAddress.slice(0, 6)}...${d.walletAddress.slice(-4)}.`);
      }
    } else if (tool === 'get_swap_quote' && result.success) {
      const d = result.data;
      if (d) parts.push(d.message || 'I found a quote for you — it has been saved as a pending quote.');
    } else if (result.error) {
      parts.push(`${tool}: ${String(result.error).slice(0, 120)}`);
    }
  }

  if (parts.length > 0) {
    return `Let me answer from what I found: ${parts.join(' ')} ${parts.length > 1 ? '' : ''}`.trim();
  }
  return "I'm going in circles trying to figure that out. Let me try a simpler approach: can you rephrase?";
}

function recoverToolCallsFromContent(
  content: string
): NonNullable<ChatResponse['toolCalls']> | undefined {
  if (!content) return undefined;
  const known = new Set(TOOL_DEFINITIONS.map(t => t.name));

  const parseThenExtract = (parsed: any): NonNullable<ChatResponse['toolCalls']> | undefined => {
    // Some models double-wrap tool calls as [[{...}]] — flatten nested arrays.
    while (Array.isArray(parsed) && parsed.length === 1 && Array.isArray(parsed[0])) {
      parsed = parsed[0];
    }

    const toToolCall = (item: any): NonNullable<ChatResponse['toolCalls']>[number] | undefined => {
      if (typeof item !== 'object' || item === null || Array.isArray(item)) return undefined;
      const name =
        typeof item.name === 'string' ? item.name : typeof item.function?.name === 'string' ? item.function?.name : undefined;
      if (!known.has(name)) return undefined;
      const rawArgs = item.arguments ?? item.parameters ?? item.function?.arguments ?? '{}';
      const argsStr = typeof rawArgs === 'string' ? rawArgs : JSON.stringify(rawArgs ?? {});
      return {
        id: `call_${Math.random().toString(36).slice(2)}`,
        type: 'function',
        function: { name, arguments: argsStr },
      };
    };

    if (Array.isArray(parsed)) {
      const calls = parsed.map(toToolCall).filter(Boolean) as NonNullable<ChatResponse['toolCalls']>;
      return calls.length > 0 ? calls : undefined;
    }
    const single = toToolCall(parsed);
    if (single) return [single];
    return undefined;
  };

  const trimmed = content.trim();

  // Strategy 1: parse the content as-is.
  try {
    const out = parseThenExtract(JSON.parse(trimmed));
    if (out) return out;
  } catch {
    /* fall through */
  }

  // Strategy 2: some models truncate trailing brackets ([[{...}] missing a ]
  // or }), or prepend prose. Try progressively trimming leading prose and
  // repairing unbalanced brackets and loop until JSON.parse succeeds.
  const starts = [trimmed];
  const firstBrace = trimmed.search(/[\[{]/);
  if (firstBrace > 0) starts.push(trimmed.slice(firstBrace));
  for (const raw of starts) {
    if (!raw) continue;
    for (let depth = 0; depth < 4; depth++) {
      const candidate = raw + ']'.repeat(depth);
      try {
        const out = parseThenExtract(JSON.parse(candidate));
        if (out) return out;
      } catch {
        /* deepen further */
      }
    }
  }

  // Strategy 3: the tool call may be embedded mid-sentence with a trailing
  // explanation appended after the JSON (e.g. "...AAPL\"}}. So I'd estimate..."),
  // which can never parse. Instead, bail — do not guess a tool name.
  return undefined;
}

// OpenAI-compatible /chat/completions (OpenRouter free models, Gemini, etc).
// Returns a ChatResponse in the same shape Cencori's gateway returns so the
// multi-turn tool loop is fully provider-agnostic.
async function chatOpenAICompat(payload: ModelCallPayload): Promise<ChatResponse> {
  if (!OPENAI_API_KEY) {
    throw new FriendlyAgentError(
      'The AI provider switch is on but no API key is set — set OPENROUTER_API_KEY (or OPENAI_API_KEY) for the AI_PROVIDER you chose.'
    );
  }

  // OpenAI API uses snake_case: tool_choice, not camelCase toolChoice.
  // Also, some free models on OpenRouter don't support tool_choice: 'required',
  // so fall back to 'auto' to avoid 400 errors.
  const body: Record<string, any> = {
    model: payload.model,
    messages: payload.messages,
    tools: payload.tools,
    temperature: payload.temperature,
  };
  if (payload.toolChoice === 'required') {
    body.tool_choice = 'required';
  }

  let response: Response;
  try {
    response = await fetch(`${OPENAI_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify(body),
    });
  } catch (error: any) {
    throw new FriendlyAgentError(
      `I couldn't reach the AI provider at ${OPENAI_BASE_URL} — check the URL/network. (${(error?.message || String(error)).slice(0, 120)})`
    );
  }

  if (!response.ok) {
    const errBody = await response.text().catch(() => '');
    const msg = `${response.status} ${errBody.slice(0, 300)}`.toLowerCase();
    if (response.status === 429 || /rate limit|quota|too many/i.test(msg)) {
      if (/free-models-per-day|free tier daily|daily limit|credits to unlock/i.test(msg)) {
        throw new FriendlyAgentError(
          "My AI provider's free tier is out of daily requests for today. Whoever runs me should add credits on OpenRouter (a couple of dollars) or wait for the daily reset."
        );
      }
      throw new FriendlyAgentError('The AI provider is rate-limiting me — give it a minute and try again.');
    }
    if (response.status === 401 || response.status === 403) {
      throw new FriendlyAgentError("The AI provider rejected my API key — whoever runs me should check the OPENROUTER_API_KEY.");
    }
    if (response.status === 404 || /model not found|invalid model|unknown model|does not exist/i.test(msg)) {
      throw new FriendlyAgentError(
        `The AI model '${payload.model}' isn't available on this provider (OpenRouter rotates free tiers). Ask whoever runs me to set OPENROUTER_MODEL to a live model — e.g. openrouter/free.`
      );
    }
    if (/tool_choice|tool.choice|tools_not_supported/i.test(msg)) {
      throw new FriendlyAgentError(
        'This model doesn\'t support forced tool calling. Ask whoever runs me to set OPENROUTER_MODEL to a model with tool support — e.g. openrouter/free.'
      );
    }
    throw new FriendlyAgentError(`The AI provider returned ${response.status}. ${errBody.slice(0, 150)}`);
  }

  const data: any = await response.json();
  const message = data?.choices?.[0]?.message ?? {};
  const toolCalls: NonNullable<ChatResponse['toolCalls']> = (message.tool_calls ?? []).map((tc: any) => ({
    id: tc.id ?? `call_${Math.random().toString(36).slice(2)}`,
    type: 'function',
    function: {
      name: tc.function?.name ?? '',
      arguments: tc.function?.arguments ?? '{}',
    },
  }));
  return {
    id: data?.id ?? 'chatcmpl-local',
    model: data?.model ?? payload.model,
    content: typeof message.content === 'string' ? message.content ?? '' : '',
    toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
    finishReason: data?.choices?.[0]?.finish_reason ?? 'stop',
    usage: {
      promptTokens: data?.usage?.prompt_tokens ?? 0,
      completionTokens: data?.usage?.completion_tokens ?? 0,
      totalTokens: data?.usage?.total_tokens ?? 0,
    },
  };
}

function effectiveAIModel(): string {
  return AI_PROVIDER === 'cencori' ? CENCORI_MODEL : OPENROUTER_MODEL;
}

async function chatWithModel(payload: ModelCallPayload): Promise<ChatResponse> {
  if (AI_PROVIDER !== 'cencori') return chatOpenAICompat(payload);
  return getCencori().ai.chat(payload);
}

// ─── Cencori call with retries (transient API hiccups + free-tier 429s) ────

async function chatWithRetry(payload: ModelCallPayload): Promise<ChatResponse> {
  const MAX_ATTEMPTS = 3;
  const BACKOFF_MS = [1500, 5000];
  let lastError: Error | null = null;

  const attempt = () => chatWithModel(payload);
  for (let i = 0; i < MAX_ATTEMPTS; i++) {
    try {
      return await attempt();
    } catch (error: any) {
      lastError = error;
      const msg = String(error?.message || error).toLowerCase();
      // Rate-limits/quota on free tiers deserve a patient retry; hard errors
      // (bad key, 404 model, tool_choice unsupported) shouldn't be retried.
      const retryable = /rate[- ]?limit|quota|429|too many|overload|5\d\d|temporari|unavailable|fetch failed|timed out|circuit/i.test(msg);
      if (!retryable || i === MAX_ATTEMPTS - 1) {
        console.warn('AI model call failed', { attempt: i + 1, error: error?.message });
        break;
      }
      console.warn(`AI model call failed (${i + 1}/${MAX_ATTEMPTS}), retrying in ${BACKOFF_MS[i]}ms...`, error?.message);
      await new Promise(resolve => setTimeout(resolve, BACKOFF_MS[i] ?? 2000));
    }
  }
  throw lastError;
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

  lines.push('- Watchlist and preferred tokens are interests only, NEVER holdings. Real positions come exclusively from the get_portfolio tool result. Zero holdings = an empty portfolio, no exceptions.');

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

// ─── Live ground-truth injection (makes balance hallucination impossible) ──
//
// The model sometimes answers a balance/portfolio question without calling any
// tool and invents numbers. So for those questions we fetch the real on-chain
// portfolio ourselves and put it in the prompt as authoritative fact.

const portfolioFactsCache = new Map<string, { fetchedAt: number; text: string }>();
const PORTFOLIO_FACTS_TTL_MS = 25_000;

export function isPortfolioQuestion(text: string): boolean {
  return /balance|portfolio|holding|positions?|how much (is|do|does)|wallet|value of (my|the)|what do i own|what (is|are) (my|i).*(asset|stock|token)/i.test(text);
}

// Tool-eligible intents MUST call a tool — we force `tool_choice: 'required'`
// for these so the model cannot answer from memory instead of live data
// (Gemini flash-lite otherwise happily narrates invented numbers).
export function requiresToolUse(text: string): boolean {
  if (isPortfolioQuestion(text)) return true;
  return /price|quote|buy|sell|trade|swap|order|risk|rebalance|stop.?loss|take.?profit|watchlist|diversif|exposure|how much (is|does) .*(cost|worth)|position|broker|portfolio/i.test(text);
}

async function buildLiveFacts(userId: string, message: string): Promise<string> {
  try {
    if (!isPortfolioQuestion(message)) return '';

    const walletAddress = await getUserWalletAddress(userId);
    if (!walletAddress) return '';

    const cached = portfolioFactsCache.get(walletAddress);
    if (cached && Date.now() - cached.fetchedAt < PORTFOLIO_FACTS_TTL_MS) return cached.text;

    const portfolio = await getPortfolio(walletAddress);

    let facts: string;
    if (portfolio.length === 0) {
      facts =
        'GROUND TRUTH PORTFOLIO (live on-chain, definitive): This wallet has NO positions. ' +
        'Total value: $0.00. Report exactly this. Never invent holdings, prices, or returns.';
    } else {
      const lines = portfolio.map(
        h =>
          `${h.symbol} ${formatBalance(h.scaledBalance, B20_DECIMALS)} — ${formatUSD(h.valueUSD)} (${getB20ExplorerLink(h.symbol)})`
      );
      const total = portfolio.reduce((sum, h) => sum + h.valueUSD, 0n);
      facts =
        `GROUND TRUTH PORTFOLIO (live on-chain, definitive): ${lines.join('; ')}. ` +
        `Total value: ${formatUSD(total)}. Report exactly this. Never invent holdings, prices, or returns.`;
    }

    portfolioFactsCache.set(walletAddress, { fetchedAt: Date.now(), text: facts });
    return facts;
  } catch {
    return '';
  }
}

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
  // Strip em-dashes from the model's reply before it hits history or iMessage.
  const toolChoice = requiresToolUse(userMessage) ? 'required' : 'auto';
  if (toolChoice === 'required') {
    console.log(`[agent] forcing tool use (tool_choice=required) for: ${userMessage.slice(0, 80)}`);
  }
  const content = sanitizeOutgoingText(await runSessionTurn(userId, {
    input: userMessage,
    instructions: `${SYSTEM_PROMPT}\n\n${contextBlock}`,
    tools: CENCORI_TOOLS as unknown as Array<Record<string, unknown>>,
    toolChoice,
  }));

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
  const liveFacts = await buildLiveFacts(userId, userMessage);
  const fullContext = `${contextBlock}\n\n${liveFacts}`.trim();

  if (AI_PROVIDER === 'cencori' && CENCORI_TRANSPORT === 'session') {
    return runSessionPath(userId, userMessage, firstContact, memory, fullContext);
  }

  const messages: AgentMessage[] = [
    { role: 'system', content: `${SYSTEM_PROMPT}\n\n${fullContext}` },
    ...history,
    { role: 'user', content: userMessage },
  ];

  // Cap history to the last ~36 messages to stay within context limits
  if (messages.length > 38) {
    messages.splice(1, messages.length - 38);
    history.splice(0, history.length - 36);
  }

  let turns = 6;

  // Cycle guard: weak free models sometimes re-request the exact same tool
  // call forever after receiving its result. Track executed (tool, args) and
  // if one repeats, synthesize the reply from the results we already have.
  const executedCalls = new Map<string, ToolResultSummary>();

  while (turns-- > 0) {
    const response = await chatWithRetry({
      model: effectiveAIModel(),
      messages,
      tools: CENCORI_TOOLS,
      toolChoice: requiresToolUse(userMessage) ? 'required' : 'auto',
      temperature: 0.3,
    });

    console.log(`[agent] turn response: finish=${response.finishReason} toolCalls=${response.toolCalls?.length ?? 0} content=${JSON.stringify(response.content ?? '').slice(0, 150)}`);

    // Persistent history: record user message on the first turn
    if (turns === 5) {
      history.push({ role: 'user', content: userMessage });
    }

    // No native tool calls — but some free models write a JSON tool-call into
    // `content` instead. Recover those before treating it as a final answer.
    if (!response.toolCalls || response.toolCalls.length === 0) {
      const recovered = recoverToolCallsFromContent(response.content || '');
      if (recovered && recovered.length > 0) {
        console.log('[agent] recovered tool calls from content:', JSON.stringify(recovered));
        response.toolCalls = recovered;
      } else {
        const content = sanitizeOutgoingText(response.content || "I'm not sure what to say. Try rephrasing that.");
        history.push({ role: 'assistant', content });
        historyStore[userId] = history;
        saveHistory(historyStore);
        return content;
      }
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

      const key = `${name}:${JSON.stringify(Object.keys(args).sort().map(k => [k, String(args[k])]))}`;
      // If this exact call already ran and produced a result, the model is
      // looping. Stop executing tools and answer from collected results.
      if (executedCalls.has(key)) {
        const answer = synthesizeToolAnswer(userMessage, Array.from(executedCalls.values()));
        console.warn('[agent] tool call cycle detected, answering from results:', key);
        history.push({ role: 'assistant', content: answer });
        historyStore[userId] = history;
        saveHistory(historyStore);
        return answer;
      }

      const { executeTool } = await import('./agent-tools.js');
      const result = await executeTool(name as ToolName, args);

      executedCalls.set(key, {
        tool: name,
        args: { ...args, userId },
        result,
      });

      const toolTurn: AgentMessage = {
        role: 'tool',
        content: JSON.stringify(result, bigintJSONReplacer),
        tool_call_id: toolCall.id,
      };
      history.push(toolTurn);
      messages.push(toolTurn);
    }
  }

  // Exhausted the turn budget — answer from whatever we collected.
  const collected = Array.from(executedCalls.values());
  if (collected.length > 0) {
    const answer = synthesizeToolAnswer(userMessage, collected);
    history.push({ role: 'assistant', content: answer });
    historyStore[userId] = history;
    saveHistory(historyStore);
    return answer;
  }

  const fallback = "I'm going in circles trying to figure that out. Let me try a simpler approach: can you rephrase?";
  history.push({ role: 'assistant', content: fallback });
  historyStore[userId] = history;
  saveHistory(historyStore);
  return fallback;
}

// ─── Public API ─────────────────────────────────────────────────────────────

export async function sendAgentMessage(userId: string, message: string, ctx?: AgentContext): Promise<string> {
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

// ─── Public API ─────────────────────────────────────────────────────────────

export async function isFirstContact(userId: string): Promise<boolean> {
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