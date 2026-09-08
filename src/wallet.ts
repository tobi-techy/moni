import { PrivyClient } from '@privy-io/server-auth';
import { createWalletClient, http, type WalletClient, type Address, type Chain } from 'viem';
import { base, baseSepolia } from 'viem/chains';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { PRIVY_APP_ID, PRIVY_APP_SECRET, BASE_RPC_URL, DEMO_MODE } from './env.js';

let privyClient: PrivyClient | null = null;

const DEMO_ADDRESS = '0x742d35Cc6634C0532925a3b8D4C0532925a3b8D4' as Address;

// ─── Persistent wallet registry ─────────────────────────────────────────────
// Our app user id is the iMessage/Spectrum sender id. Privy keys users by their
// own DID (did:privy:...), so calling privy.getUser(appUserId) can never find a
// wallet. We persist the bridge between the two here so a connected wallet is
// retrievable across sessions.
const DATA_DIR = join(process.cwd(), '.moni-data');
const WALLET_FILE = join(DATA_DIR, 'wallets.json');

export interface WalletRecord {
  privyUserId?: string;
  walletAddress?: string;
}

function ensureDataDir(): void {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
}

function loadWallets(): Record<string, WalletRecord> {
  ensureDataDir();
  if (!existsSync(WALLET_FILE)) return {};
  try {
    return JSON.parse(readFileSync(WALLET_FILE, 'utf-8'));
  } catch {
    return {};
  }
}

function saveWallets(store: Record<string, WalletRecord>): void {
  ensureDataDir();
  writeFileSync(WALLET_FILE, JSON.stringify(store, null, 2));
}

export function getPrivyClient(): PrivyClient {
  if (!privyClient) {
    if (!PRIVY_APP_ID || !PRIVY_APP_SECRET) {
      throw new Error('Privy credentials not configured. Set PRIVY_APP_ID and PRIVY_APP_SECRET in .env');
    }
    privyClient = new PrivyClient(PRIVY_APP_ID, PRIVY_APP_SECRET);
  }
  return privyClient;
}

// Get the appropriate Base chain
export function getBaseChain(): Chain {
  return BASE_RPC_URL.includes('sepolia') ? baseSepolia : base;
}

// Create a wallet client for a user's embedded wallet
export async function createUserWalletClient(userId: string): Promise<WalletClient | null> {
  if (DEMO_MODE === 'true') {
    console.log('[DEMO] Returning mock wallet client');
    return null;
  }

  const walletAddress = await getUserWalletAddress(userId);
  if (!walletAddress) {
    console.log(`No embedded wallet found for user ${userId}`);
    return null;
  }

  return createWalletClient({
    account: walletAddress,
    chain: getBaseChain(),
    transport: http(BASE_RPC_URL),
  });
}

// Create a wallet client from a private key (for demo/testing)
export function createWalletClientFromPrivateKey(privateKey: `0x${string}`): WalletClient {
  return createWalletClient({
    account: privateKey,
    chain: getBaseChain(),
    transport: http(BASE_RPC_URL),
  });
}

// Get user's wallet client (alias for createUserWalletClient)
export async function getUserWalletClient(userId: string): Promise<WalletClient | null> {
  return createUserWalletClient(userId);
}

// Get user's wallet address
export async function getUserWalletAddress(userId: string): Promise<Address | null> {
  if (DEMO_MODE === 'true') {
    return DEMO_ADDRESS;
  }

  const wallets = loadWallets();
  const record = wallets[userId];

  // Fast path: we already know this user's wallet address.
  if (record?.walletAddress) {
    return record.walletAddress as Address;
  }

  // Slow path: we know their Privy user id — resolve the wallet from Privy and
  // cache it so we don't hit Privy on every lookup.
  if (record?.privyUserId) {
    try {
      const user = await getPrivyClient().getUser(record.privyUserId);
      const embeddedWallet = user.wallet?.address;
      if (embeddedWallet) {
        record.walletAddress = embeddedWallet;
        wallets[userId] = record;
        saveWallets(wallets);
        return embeddedWallet as Address;
      }
    } catch (error) {
      console.error('Error resolving wallet from Privy:', error);
    }
  }

  return null;
}

// Persist the bridge between our app user id and their Privy identity/wallet.
// Call this once the user completes Privy auth (client-side) so the server can
// resolve their wallet on later turns.
export async function registerWallet(
  userId: string,
  opts: { privyUserId?: string; walletAddress?: string }
): Promise<void> {
  const wallets = loadWallets();
  wallets[userId] = { ...(wallets[userId] || {}), ...opts };
  saveWallets(wallets);
}

// Link a wallet to a user (for wallet connection flow)
export async function linkWallet(userId: string, walletAddress: Address): Promise<boolean> {
  if (DEMO_MODE === 'true') {
    console.log('[DEMO] Wallet linked:', walletAddress);
    return true;
  }

  try {
    await registerWallet(userId, { walletAddress });
    return true;
  } catch (error) {
    console.error('Error linking wallet:', error);
    return false;
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
