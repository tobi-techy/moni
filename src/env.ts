// Centralized environment variable access
import { base, type Chain } from 'viem/chains';
export const PROJECT_ID = process.env.PROJECT_ID || '';
export const PROJECT_SECRET = process.env.PROJECT_SECRET || '';
export const PARA_API_KEY = process.env.PARA_API_KEY || '';

// Para REST environment: 'PROD' | 'BETA' | 'SANDBOX' | { baseUrl }
export type ParaRestEnv = 'PROD' | 'BETA' | 'SANDBOX' | { baseUrl: string };

// @getpara/rest-sdk resolves the API URL via BASE_URLS[env], which only has
// PROD / BETA / SANDBOX keys — anything else (e.g. "PRODUCTION", "beta",
// trailing whitespace) makes the client constructor throw "baseUrl is
// required", which is what took wallet provisioning down in production.
// Normalize aggressively here so the client can never be built with an
// unmapped environment value.
function normalizeParaEnvironment(raw: string | undefined): ParaRestEnv {
  const value = (raw || '').trim();
  // A full URL is accepted as an explicit custom base URL.
  if (/^https?:\/\//i.test(value)) return { baseUrl: value };

  switch (value.toUpperCase()) {
    case 'PROD':
    case 'PRODUCTION':
    case 'LIVE':
      return 'PROD';
    case 'SANDBOX':
    case 'TEST':
      return 'SANDBOX';
    case 'BETA':
    case 'STAGING':
    case 'DEV':
    case 'DEVELOPMENT':
    case '':
      return 'BETA';
    default:
      console.warn(
        `[env] Unrecognized PARA_ENVIRONMENT '${value}' - defaulting to BETA. ` +
        `Valid values: PROD, BETA, SANDBOX, or an https:// base URL.`
      );
      return 'BETA';
  }
}

export const PARA_ENVIRONMENT: ParaRestEnv = normalizeParaEnvironment(process.env.PARA_ENVIRONMENT);

// Optional explicit REST base URL override. Takes precedence over
// PARA_ENVIRONMENT (e.g. PARA_REST_BASE_URL=https://api.getpara.com).
export const PARA_REST_BASE_URL = (process.env.PARA_REST_BASE_URL || '').trim();

// Effective environment passed to ParaRestClient.
export const PARA_REST_ENV: ParaRestEnv = PARA_REST_BASE_URL
  ? { baseUrl: PARA_REST_BASE_URL }
  : PARA_ENVIRONMENT;

// True when pointing at Para's production API (used for the go-live warning).
export const PARA_IS_PROD: boolean =
  PARA_REST_ENV === 'PROD' ||
  (typeof PARA_REST_ENV === 'object' && PARA_REST_ENV.baseUrl.replace(/\/+$/, '') === 'https://api.getpara.com');

// Para API keys are environment-scoped: keys minted for BETA/SANDBOX carry
// `_beta_`/`_sandbox_` in the key (e.g. sk_beta_...) and are rejected by the
// production API with `invalid secret api key`. Detect the mismatch up front
// so boot fails with a clear message instead of every wallet op failing later.
export const PARA_API_KEY_ENVIRONMENT_UNLOCKED: boolean =
  /_(beta|sandbox)_/i.test(PARA_API_KEY);

// Human-readable env a key actually belongs to (for error messages).
export function paraKeyEnvironment(key: string): string {
  if (/_(beta|sandbox)_/i.test(key)) return key.includes('_sandbox_') ? 'SANDBOX' : 'BETA';
  return 'PROD';
}
export const BASE_RPC_URL = process.env.BASE_RPC_URL || 'https://mainnet.base.org';
// True when the configured RPC points at a testnet. B20 tokenized stocks ONLY
// exist on Base mainnet — there are no B20 contracts on Base Sepolia — so a
// testnet RPC is always a misconfiguration and validateEnv() rejects it.
export const IS_BASE_SEPOLIA = BASE_RPC_URL.toLowerCase().includes('sepolia');
// The chain Moni reads from and writes to. Locked to Base mainnet because the
// tokenized-stock contracts this bot trades only exist there (8453).
export const BASE_CHAIN: Chain = base;
// Community/public Base RPCs used as automatic failover + spread when
// mainnet.base.org starts rate-limiting (code -32016 "over rate limit").
// Comma-separated override via env (e.g. for a paid Infura/Alchemy endpoint).
export const BASE_RPC_FALLBACKS: string[] = (
  process.env.BASE_RPC_FALLBACKS ||
  'https://base-rpc.publicnode.com,https://1rpc.io/base,https://base.drpc.org'
)
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
export const ONEINCH_API_KEY = process.env.ONEINCH_API_KEY || '';
export const CENCORI_API_KEY = process.env.CENCORI_API_KEY || '';
// Model for live agent turns. NOTE: must be one the Cencori plan/key supports.
// The Cencori dashboard shows the active plan actually serves Google models
// (gemini-2.5-flash-lite 71%, gemini-2.5-flash 16%) while its OpenAI provider
// circuit frequently opens/quota-exhausts. So default to the highest-headroom
// Google model identifier. Override with CENCORI_MODEL if routing changes.
export const CENCORI_MODEL = process.env.CENCORI_MODEL || 'gemini-2.5-flash-lite';
// Live transport: 'session' = durable Sessions API (pause/approve for tool calls),
// 'gateway' = stateless ai.chat (function calling only on plans that support it).
export const CENCORI_TRANSPORT = process.env.CENCORI_TRANSPORT || 'session';

// ─── OpenAI-compatible provider (fallback / free-tier routing) ─────────────
// Cencori's plan-side circuits (quota on their OpenAI provider) frequently
// block turns. Moni can instead call any OpenAI-compatible `/chat/completions`
// endpoint directly — OpenRouter `:free` models (no credit card) or Gemini's
// OpenAI-compat endpoint. Choose with AI_PROVIDER.
export type AIProvider = 'cencori' | 'openrouter';

export const AI_PROVIDER: AIProvider = process.env.AI_PROVIDER === 'openrouter' ? 'openrouter' : 'cencori';

// OpenRouter free-tier models with tool/function-calling support as of the
// model rotation (google/gemini-2.5-flash-lite:free was delisted). Default to
// Google-family via OpenRouter. Override per bot.
export const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || '';
export const OPENROUTER_MODEL = process.env.OPENROUTER_MODEL || 'google/gemma-4-31b-it:free';
// Base URL of any OpenAI-compatible API (default OpenRouter).
export const OPENAI_BASE_URL = (process.env.OPENAI_BASE_URL || 'https://openrouter.ai/api/v1').replace(/\/+$/, '');
// Alternate key (e.g. Gemini GEMINI_API_KEY) used when OPENAI_BASE_URL is a
// non-OpenRouter endpoint. Kept generic so we can point at any compatible host.
export const OPENAI_API_KEY = process.env.OPENAI_API_KEY || process.env.GEMINI_API_KEY || OPENROUTER_API_KEY;
export const SPECTRUM_WEBHOOK_SECRET = process.env.SPECTRUM_WEBHOOK_SECRET || '';
export const WEBHOOK_PORT = parseInt(process.env.WEBHOOK_PORT || '3001', 10);

// Validation
export function validateEnv(): { valid: boolean; missing: string[]; errors: string[] } {
  const errors: string[] = [];

  const required = [
    { key: 'PROJECT_ID', value: PROJECT_ID },
    { key: 'PROJECT_SECRET', value: PROJECT_SECRET },
    { key: 'PARA_API_KEY', value: PARA_API_KEY },
  ];

  const missing = required
    .filter(({ value }) => !value)
    .map(({ key }) => key);

  // Mainnet only: there are no B20 tokenized-stock contracts on Base Sepolia,
  // so pointing the RPC at a testnet can never work — fail fast.
  if (IS_BASE_SEPOLIA) {
    errors.push(
      `BASE_RPC_URL is '${BASE_RPC_URL}' (a testnet). Moni trades Coinbase B20 ` +
      `tokenized stocks, which only exist on Base mainnet. Set ` +
      `BASE_RPC_URL=https://mainnet.base.org (or unset it).`
    );
  }

  // Para keys are environment-scoped: a BETA/SANDBOX key (`sk_beta_...`) is
  // rejected by the production API (`invalid secret api key`), so every wallet
  // provision/broadcast fails silently. Fail fast instead.
  if (PARA_IS_PROD && PARA_API_KEY_ENVIRONMENT_UNLOCKED) {
    errors.push(
      `PARA_ENVIRONMENT is PROD but PARA_API_KEY is a ${paraKeyEnvironment(PARA_API_KEY)} key ` +
      `(${PARA_API_KEY.slice(0, 8)}...). BETA/SANDBOX keys only work against their matching ` +
      `env — get a production key at https://dashboard.getpara.com/keys and restart, or set ` +
      `PARA_ENVIRONMENT=BETA to match this key.`
    );
  }

  // All three credentials are always required — Moni is live-only now (no demo
// mode), so a missing credential is a configuration error, not a fallback.
const valid = errors.length === 0 && missing.length === 0;

  return {
    valid,
    missing,
    errors,
  };
}
