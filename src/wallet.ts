// ─── Para wallet integration ────────────────────────────────────────────────
//
// Moni uses @getpara/rest-sdk (Para REST wallets) as its embedded-wallet layer.
// Para's REST API is the recommended path for server-side / agent wallets: it
// creates an EVM wallet per user (key material held in Para's enclave, API-key
// backed) that works on ANY EVM chain — including Base (8453) and Base Sepolia
// (84532), where Moni's tokenized stocks live.
//
// Flow:
//   1. resolveParaUser(userId) finds or creates the EVM wallet for an iMessage
//      user (Custom ID identifier: `moni:<userId>`). Deterministic, idempotent —
//      Para de-dupes by (identifierType, identifier, type, scheme).
//   2. getUserWalletClient(userId) returns a viem WalletClient whose account is
//      a Para REST account (createParaRestViemAccount). sendTransaction() signs
//      via Para's REST sign-transaction and broadcasts through the Base RPC —
//      real on-chain execution, agent-driven.
//   3. A local mapping (iMessageUserId -> Para walletId + address) is kept in
//      `.moni-data/para-users.json` so resolution is fast and never re-creates.

import { ParaRestClient, ParaRestError, type RestWallet } from '@getpara/rest-sdk';
import { createWalletClient, http, type WalletClient, type Address, type Chain, type Transport, type LocalAccount } from 'viem';
import { base, baseSepolia } from 'viem/chains';
import { createParaRestViemAccount } from '@getpara/rest-sdk/viem';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { PARA_API_KEY, PARA_ENVIRONMENT, BASE_RPC_URL, DEMO_MODE } from './env.js';

// Demo wallet address used when DEMO_MODE=true (no Para calls made).
export const DEMO_WALLET_ADDRESS = '0x742d35Cc6634C0532925a3b8D4C0532925a3b8D4' as Address;

let paraClient: ParaRestClient | null = null;

function resolveParaEnv(): 'PROD' | 'BETA' | 'SANDBOX' | { baseUrl: string } {
  const raw = PARA_ENVIRONMENT;
  if (raw && typeof raw === 'object' && 'baseUrl' in raw) {
    return raw;
  }
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!trimmed) {
      throw new Error('Para credentials not configured. Set PARA_ENVIRONMENT in .env (PROD, BETA, SANDBOX)');
    }
    const upper = trimmed.toUpperCase();
    const VALID_ENVS = ['PROD', 'BETA', 'SANDBOX'] as const;
    const matched = VALID_ENVS.find(e => e === upper);
    if (matched) {
      return matched;
    }
    if (/^https?:\/\//.test(trimmed)) {
      return { baseUrl: trimmed };
    }
    throw new Error(
      `Invalid PARA_ENVIRONMENT '${raw}'. Expected PROD, BETA, or SANDBOX (or a baseUrl object like { baseUrl: 'https://...' }).`
    );
  }
  throw new Error('Invalid PARA_ENVIRONMENT value.');
}

export function getParaClient(): ParaRestClient {
  if (!paraClient) {
    if (!PARA_API_KEY) {
      throw new Error('Para credentials not configured. Set PARA_API_KEY in .env');
    }
    paraClient = new ParaRestClient({ apiKey: PARA_API_KEY, env: resolveParaEnv() });
    if (process.env.NODE_ENV === 'production' && PARA_ENVIRONMENT !== 'PROD') {
      console.warn(
        `[Para] PARA_ENVIRONMENT is '${PARA_ENVIRONMENT}' but NODE_ENV=production. ` +
        `BETA/SANDBOX are for testing only (50-user cap, no real funds). Set PARA_ENVIRONMENT=PROD with a PRODUCTION API key before going live.`
      );
    }
  }
  return paraClient;
}

// ─── Identity mapping ────────────────────────────────────────────────────────

export interface ParaRecord {
  iMessageUserId: string;
  /** Para wallet UUID (walletId) — the key for every REST signing call. */
  walletId: string;
  walletAddress: Address;
  /** Para user identifier we minted the wallet under. */
  userIdentifier: string;
  createdAt: string;
}

const DATA_DIR = join(process.cwd(), '.moni-data');
const PARA_FILE = join(DATA_DIR, 'para-users.json');

function ensureDataDir(): void {
  if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true });
  }
}

function loadParaStore(): Record<string, ParaRecord> {
  ensureDataDir();
  if (!existsSync(PARA_FILE)) return {};
  try {
    return JSON.parse(readFileSync(PARA_FILE, 'utf-8'));
  } catch {
    return {};
  }
}

function saveParaStore(store: Record<string, ParaRecord>): void {
  ensureDataDir();
  writeFileSync(PARA_FILE, JSON.stringify(store, null, 2));
}

// Namespaces the Para wallet identifier per iMessage user so different chats
// can never collide. iMessage ids are not stable global identifiers on their own.
export function paraIdentifier(userId: string): string {
  return `moni:${userId}`;
}

// Para returns 409 when a wallet for this (identifierType, identifier, type,
// scheme) already exists — we then fall back to listing the existing wallet.
function isConflict(error: unknown): boolean {
  return error instanceof ParaRestError && error.status === 409;
}

async function findReadyWallet(
  para: ParaRestClient,
  identifier: string
): Promise<RestWallet | null> {
  const res = await para.listWallets({
    userIdentifier: identifier,
    userIdentifierType: 'CUSTOM_ID',
    type: 'EVM',
    status: 'ready',
  });
  return res.data[0] ?? null;
}

// Key generation is asynchronous: a create response can report `creating` even
// while already exposing an address. The docs are explicit — wait for `status:
// 'ready'` before signing. Poll gently (2s) to stay inside the shared REST rate
// limit (free tier = 30 req/min), with a 30s cap so the agent never hangs.
async function waitForReadyWallet(
  para: ParaRestClient,
  walletId: string,
  timeoutMs = 30_000
): Promise<RestWallet | null> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const wallet = await para.getWallet(walletId);
    if (wallet.status === 'ready') return wallet;
    if (Date.now() > deadline) return null;
    await new Promise((r) => setTimeout(r, 2000));
  }
}

// Resolve an iMessage user to their Para EVM wallet, provisioning it if needed.
// Idempotent: cached mapping -> Para lookup -> create. Returns null if Para is
// not configured or provisioning fails (callers surface a setup message).
export async function resolveParaUser(userId: string): Promise<ParaRecord | null> {
  if (DEMO_MODE === 'true') {
    const store = loadParaStore();
    const cached = store[userId];
    if (cached?.walletId) return cached;
    const record: ParaRecord = {
      iMessageUserId: userId,
      walletId: 'para-demo',
      walletAddress: DEMO_WALLET_ADDRESS,
      userIdentifier: paraIdentifier(userId),
      createdAt: new Date().toISOString(),
    };
    store[userId] = record;
    saveParaStore(store);
    return record;
  }

  const store = loadParaStore();
  const cached = store[userId];
  if (cached?.walletAddress) return cached;

  const para = getParaClient();
  const identifier = paraIdentifier(userId);

  let wallet = await findReadyWallet(para, identifier);
  if (!wallet) {
    try {
      wallet = await para.createWallet(
        {
          type: 'EVM',
          userIdentifier: identifier,
          userIdentifierType: 'CUSTOM_ID',
        },
        { idempotencyKey: crypto.randomUUID() }
      );
    } catch (error) {
      if (isConflict(error)) {
        wallet = await findReadyWallet(para, identifier);
      } else {
        console.error('Para wallet creation failed:', (error as Error).message);
        return null;
      }
    }
  }
  if (!wallet) return null;

  const ready = await waitForReadyWallet(para, wallet.id);
  if (!ready?.address) {
    console.error('Para wallet not ready within timeout:', wallet.id, wallet.status);
    return null;
  }

  const record: ParaRecord = {
    iMessageUserId: userId,
    walletId: ready.id,
    walletAddress: ready.address as Address,
    userIdentifier: identifier,
    createdAt: new Date().toISOString(),
  };

  store[userId] = record;
  saveParaStore(store);
  console.log(`[Para] Wallet ready for ${userId}: ${ready.address} (${ready.id})`);
  return record;
}

// Get the appropriate Base chain
export function getBaseChain(): Chain {
  return BASE_RPC_URL.includes('sepolia') ? baseSepolia : base;
}

// Create a viem wallet client whose account signs through Para REST. Use its
// sendTransaction()/signMessage() for real agent-driven on-chain actions.
export async function createUserWalletClient(userId: string): Promise<WalletClient<Transport, Chain, LocalAccount> | null> {
  if (DEMO_MODE === 'true') {
    console.log('[DEMO] Returning mock wallet client');
    return null;
  }

  try {
    const record = await resolveParaUser(userId);
    if (!record) return null;

    const account = createParaRestViemAccount({
      client: getParaClient(),
      walletId: record.walletId,
      address: record.walletAddress,
    });

    return createWalletClient({
      account,
      chain: getBaseChain(),
      transport: http(BASE_RPC_URL),
    });
  } catch (error) {
    console.error('Error creating Para-backed wallet client:', error);
    return null;
  }
}

// Get user's wallet client (alias for createUserWalletClient)
export async function getUserWalletClient(userId: string): Promise<WalletClient<Transport, Chain, LocalAccount> | null> {
  return createUserWalletClient(userId);
}

// Get user's wallet address, provisioning the Para wallet if needed.
export async function getUserWalletAddress(
  userId: string,
  _opts?: { phone?: string; persist?: boolean }
): Promise<Address | null> {
  if (DEMO_MODE === 'true') {
    return DEMO_WALLET_ADDRESS;
  }
  const record = await resolveParaUser(userId);
  return record?.walletAddress ?? null;
}

// Link a wallet to a user (for wallet connection flow) — no-op under Para:
// each user already has one deterministic REST wallet; nothing is linked manually.
export async function linkWallet(userId: string, walletAddress: Address): Promise<boolean> {
  if (DEMO_MODE === 'true') {
    console.log('[DEMO] Wallet linked:', walletAddress);
    return true;
  }
  console.log('Wallets are provisioned deterministically via resolveParaUser');
  return true;
}

// Create a wallet client from a private key (for demo/testing)
export function createWalletClientFromPrivateKey(privateKey: `0x${string}`): WalletClient {
  return createWalletClient({
    account: privateKey,
    chain: getBaseChain(),
    transport: http(BASE_RPC_URL),
  });
}

// ─── Para-native agent helpers ───────────────────────────────────────────────

// Native token / ERC20 balance straight from Para's balance endpoint.
// tokenAddress omitted = native ETH balance. chainId defaults to the active Base chain.
export async function getParaWalletBalance(
  userId: string,
  tokenAddress?: Address
): Promise<{ balance: string; symbol: string; rawBalance: string } | null> {
  if (DEMO_MODE === 'true') return null;
  try {
    const record = await resolveParaUser(userId);
    if (!record) return null;
    const chainId = getBaseChain().id;
    return await getParaClient().getWalletBalance(record.walletId, {
      chainId,
      ...(tokenAddress ? { tokenAddress } : {}),
    });
  } catch (error) {
    console.error('Error fetching Para wallet balance:', error);
    return null;
  }
}

// Agent-driven native transfer through Para (signs + broadcasts via REST when
// broadcast=true). Returns the tx hash when available.
export async function sendNativeTransfer(
  userId: string,
  to: Address,
  valueWei: string
): Promise<{ txHash?: string; signedTransaction: string } | null> {
  if (DEMO_MODE === 'true') {
    console.log(`[DEMO] Native transfer to ${to}: ${valueWei}`);
    return null;
  }
  try {
    const record = await resolveParaUser(userId);
    if (!record) return null;
    const chainId = getBaseChain().id;
    const result = await getParaClient().transfer(record.walletId, {
      to,
      value: valueWei,
      chainId,
      type: 2,
      broadcast: true,
    });
    return result;
  } catch (error) {
    console.error('Error sending Para transfer:', error);
    return null;
  }
}

// Recent on-chain activity for the user's Para wallet (broadcast records).
export async function getParaTransactionHistory(
  userId: string,
  limit = 10
): Promise<Array<{ hash?: string; status?: string; to?: string; createdAt: string }>> {
  if (DEMO_MODE === 'true') return [];
  try {
    const record = await resolveParaUser(userId);
    if (!record) return [];
    const res = await getParaClient().listRestTransactions(record.walletId, { limit });
    return res.data.map((tx) => ({
      hash: tx.hash,
      status: tx.status,
      to: tx.to,
      createdAt: tx.createdAt,
    }));
  } catch (error) {
    console.error('Error listing Para transactions:', error);
    return [];
  }
}

// Demo mode: simulate wallet balance
export async function getDemoBalance(tokenSymbol: string): Promise<bigint> {
  // Return simulated balances for demo
  const demoBalances: Record<string, bigint> = {
    AAPL: 100000000000000000000n, // 100 AAPL (18 decimals)
    NVDA: 50000000000000000000n,  // 50 NVDA
    MSFT: 200000000000000000000n, // 200 MSFT
    USDC: 5000000000n,            // 5000 USDC (6 decimals)
    WETH: 2000000000000000000n,   // 2 WETH (18 decimals)
  };

  return demoBalances[tokenSymbol] || 0n;
}