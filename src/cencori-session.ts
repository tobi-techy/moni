// Cencori Sessions transport — durable live agent loop.
//
// Sessions API flow: submit a turn → SSE events stream. Any function-tool call
// raises a `turn.paused` event (with action_id + tool + arguments). We execute
// the tool locally, then `approve` with the result, which resumes the stream.
// The turn ends with `turn.completed` (final text) or `turn.failed`.
//
// This is the tool-capable path on Cencori (the stateless ai.chat gateway on
// some plans/providers does not support function calling).

import { Cencori } from 'cencori';
import { CENCORI_MODEL } from './env.js';
import { bigintJSONReplacer } from './bigint-json.js';
import type { ToolName } from './agent-tools.js';

// Friendly errors are passed straight through to the user without remapping.
export class FriendlyAgentError extends Error {
  friendly = true;
}

// Cache session ids keyed by userId (sessions persist conversation + tool history).
const sessionForUser = new Map<string, string>();

export interface SessionTurnOptions {
  input: string;
  instructions: string;
  tools: Array<Record<string, unknown>>;
  model?: string;
  temperature?: number;
}

interface SSEEvent {
  event: string;
  data: any;
}

// ─── SSE parsing ───────────────────────────────────────────────────────────

function parseSSEBlock(raw: string): SSEEvent | null {
  const lines = raw.split(/\r?\n/);
  let event = 'message';
  const dataLines: string[] = [];
  for (const line of lines) {
    if (line.startsWith('event:')) event = line.slice(6).trim();
    else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
  }
  if (dataLines.length === 0) return null;
  const payload = dataLines.join('\n');
  let data: any = payload;
  try {
    data = JSON.parse(payload);
  } catch {
    // keep raw string
  }
  return { event, data };
}

async function* iterateSSE(stream: ReadableStream<Uint8Array>): AsyncGenerator<SSEEvent> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buffer.indexOf('\n\n')) !== -1) {
      const block = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      const ev = parseSSEBlock(block);
      if (ev) yield ev;
    }
  }
  buffer += decoder.decode();
  const ev = parseSSEBlock(buffer.replace(/\s+$/, ''));
  if (ev) yield ev;
}

// ─── Tool argument normalization ───────────────────────────────────────────

function normalizeToolArgs(raw: unknown, tool: string): Record<string, any> {
  if (raw == null) return {};
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw);
    } catch {
      return {};
    }
  }
  if (typeof raw === 'object') {
    const obj = raw as Record<string, any>;
    // Some built-in tools wrap args as { [tool]: {...} }
    const nested = obj[tool];
    if (nested && typeof nested === 'object' && !Array.isArray(nested)) return nested;
    return obj;
  }
  return {};
}

// ─── Error mapping ─────────────────────────────────────────────────────────

function friendlyMessage(raw: string): string {
  const msg = String(raw || '').toLowerCase();
  if (/rate limit/i.test(msg)) {
    return 'My AI provider is rate-limiting right now — give it a minute and try again.';
  }
  if (/circuit is open/i.test(msg)) {
    return 'My AI provider is briefly degraded — give it a minute and try again.';
  }
  if (/pricing is not configured|pricing_unavailable|not configured/i.test(msg)) {
    return "The AI model behind me isn't enabled on this plan. Ask whoever runs me to pick a supported model.";
  }
  if (/provider_invalid_request|invalid.*model|unknown model/i.test(msg)) {
    return "My model setting isn't recognised by my AI provider. Set CENCORI_MODEL to a model your Cencori plan supports.";
  }
  if (/tools?_not_supported/i.test(msg)) {
    return "My AI connection doesn't support tool calling on this plan — trading tools require a tool-capable model.";
  }
  if (/api key|unauthorized|invalid|forbidden/i.test(msg)) {
    return "I can't reach my AI connection right now — the CENCORI_API_KEY doesn't seem valid.";
  }
  return `Something hiccuped on my end. Try again in a few seconds — if it keeps happening, say 'help'.`;
}

function retryable(raw: string): boolean {
  return /rate limit|circuit is open|internal_error|internal error|overloaded/i.test(raw || '');
}

// Fixed delay before an intra-attempt retry (the outer attempt loop uses a
// growing backoff, this one just lets a rate-limit window clear).
const TRANSIENT_RETRY_DELAY_MS = 700;

// ─── Main turn loop ────────────────────────────────────────────────────────

export async function runSessionTurn(
  userId: string,
  options: SessionTurnOptions,
  deps: { client?: Cencori; executeTool?: (name: string, args: Record<string, any>) => Promise<any> } = {}
): Promise<string> {
  const client = deps.client ?? new Cencori();
  const sessions = client.sessions;

  const execute = async (tool: string, args: Record<string, any>) => {
    if (deps.executeTool) return deps.executeTool(tool, args);
    const { executeTool } = await import('./agent-tools.js');
    return executeTool(tool as ToolName, { ...args, userId });
  };

  const getOrCreateSession = async (): Promise<string> => {
    const cached = sessionForUser.get(userId);
    if (cached) {
      try {
        await sessions.get(cached);
        return cached;
      } catch {
        // expired or missing — fall through and create a fresh one
      }
    }
    const session = await sessions.create({ metadata: { userId } });
    sessionForUser.set(userId, session.id);
    return session.id;
  };

  let sessionId = await getOrCreateSession();

  const submit = () =>
    sessions.submitTurnStream(sessionId, {
      input: options.input,
      tools: options.tools,
      instructions: options.instructions,
      model: options.model ?? CENCORI_MODEL,
      temperature: options.temperature ?? 0.3,
      pause_on_tool_calls: true,
    });

  // A single attempt of the SSE turn. Throws a FriendlyAgentError tagged
  // `retryable` when the failure is a transient provider hiccup AND no tool has
  // executed yet — retrying a turn that already ran a trade would double it.
  const runAttempt = async (): Promise<string> => {
    let stream: ReadableStream<Uint8Array> | null;
    try {
      stream = await submit();
    } catch (error: any) {
      const raw = error?.message || String(error);
      if (!retryable(raw)) throw new FriendlyAgentError(friendlyMessage(raw));
      await new Promise(r => setTimeout(r, TRANSIENT_RETRY_DELAY_MS));
      stream = await submit();
    }
    if (!stream) throw new FriendlyAgentError("My AI connection didn't return a response stream.");

    let output = '';
    let toolCalls = 0;

    for (;;) {
      let paused = false;
      let terminated = false;

      for await (const ev of iterateSSE(stream)) {
        switch (ev.event) {
          case 'output_text.delta':
            if (typeof ev.data?.delta === 'string') output += ev.data.delta;
            break;

          case 'turn.paused': {
            const p = ev.data ?? {};
            const actionId = p.action_id;
            const tool = p.tool;
            if (!actionId || !tool) {
              throw new FriendlyAgentError(
                "My AI asked for a tool in an unrecognised format — ask whoever runs me to check the agent transport."
              );
            }
            const args = normalizeToolArgs(p.arguments, tool);
            const result = await execute(tool, args);
            toolCalls++;
            stream = await sessions.approveStream(sessionId, {
              action_id: actionId,
              tool_results: [{ action_id: actionId, output: JSON.stringify(result, bigintJSONReplacer) }],
            });
            if (!stream) throw new FriendlyAgentError("My AI connection dropped mid-turn — try again.");
            paused = true;
            break;
          }

          case 'turn.completed': {
            const raw = ev.data?.output;
            const text =
              typeof raw === 'string'
                ? raw
                : raw?.text ?? raw?.content ?? raw?.message?.content ?? raw?.output_text ?? '';
            if (text && !output.includes(String(text))) output += text;
            terminated = true;
            break;
          }

          case 'turn.failed': {
            const raw = ev.data?.output?.error ?? ev.data?.error ?? 'unknown error';
            const msg = String(raw || '');
            if (retryable(msg) && toolCalls === 0) {
              await new Promise(r => setTimeout(r, TRANSIENT_RETRY_DELAY_MS));
              const err = new FriendlyAgentError(
                `My AI provider hiccuped — please try again in a moment. ${msg.slice(0, 120)}`
              ) as any;
              err.retryable = true;
              throw err;
            }
            throw new FriendlyAgentError(friendlyMessage(msg));
          }
        }
        if (paused) break;
      }

      if (terminated) {
        const trimmed = output.trim();
        if (!trimmed) throw new FriendlyAgentError("I didn't manage to answer — try again in a few seconds.");
        return trimmed;
      }
      if (!paused) {
        throw new FriendlyAgentError("My AI connection ended the turn unexpectedly — try again.");
      }
    }
  };

  // Transient provider hiccups (rate limits, circuit open, overload) get a few
  // bounded retries with backoff before surfacing a friendly error. Turning a
  // tool call into a retry is intentionally prevented (see runAttempt).
  const MAX_TURN_ATTEMPTS = 3;
  const TURN_RETRY_BACKOFF_MS = [1200, 3500];

  let lastError: Error | null = null;
  for (let attempt = 0; attempt < MAX_TURN_ATTEMPTS; attempt++) {
    if (attempt > 0) {
      await new Promise(r => setTimeout(r, TURN_RETRY_BACKOFF_MS[attempt - 1] ?? 2000));
    }
    try {
      return await runAttempt();
    } catch (error: any) {
      if (error?.retryable && attempt < MAX_TURN_ATTEMPTS - 1) {
        lastError = error;
        continue;
      }
      throw error;
    }
  }
  throw lastError ?? new FriendlyAgentError("My AI connection didn't return a response stream.");
}

// Exposed for offline testing / diagnostics
export function _parseSSEBlock(raw: string): SSEEvent | null {
  return parseSSEBlock(raw);
}