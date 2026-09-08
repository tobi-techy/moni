import { PrivyClient } from '@privy-io/server-auth';
import { createWalletClient, http, type WalletClient, type Address, type Chain } from 'viem';
import { base, baseSepolia } from 'viem/chains';
import { PRIVY_APP_ID, PRIVY_APP_SECRET, BASE_RPC_URL, DEMO_MODE } from './env.js';

let privyClient: PrivyClient | null = null;

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

  const privy = getPrivyClient();
  
  try {
    const user = await privy.getUser(userId);
    const embeddedWallet = user.wallet?.address;

    if (!embeddedWallet) {
      console.log(`No embedded wallet found for user ${userId}`);
      return null;
    }

    const walletClient = createWalletClient({
      account: embeddedWallet as Address,
      chain: getBaseChain(),
      transport: http(BASE_RPC_URL),
    });

    return walletClient;
  } catch (error) {
    console.error('Error creating wallet client for user:', error);
    return null;
  }
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
    // Return a demo address
    return '0x742d35Cc6634C0532925a3b8D4C0532925a3b8D4' as Address;
  }

  const privy = getPrivyClient();
  
  try {
    const user = await privy.getUser(userId);
    const embeddedWallet = user.wallet?.address;
    return embeddedWallet as Address | null;
  } catch (error: any) {
    const status = error?.status ?? error?.response?.status;
    if (status === 404 || error?.type === 'api_error') {
      console.warn(`Privy user not found for ${userId}; wallet address lookup skipped.`);
      return null;
    }

    console.error(`Error getting wallet address for user ${userId}:`, error);
    return null;
  }
}

// Link a wallet to a user (for wallet connection flow)
export async function linkWallet(userId: string, walletAddress: Address): Promise<boolean> {
  if (DEMO_MODE === 'true') {
    console.log('[DEMO] Wallet linked:', walletAddress);
    return true;
  }

  const privy = getPrivyClient();
  
  try {
    // This would typically be done via Privy's client-side SDK
    // Server-side, we can associate the wallet with the user
    // Note: linkWallet may not exist on server auth, use client SDK instead
    console.log('Wallet linking should be done client-side via Privy SDK');
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
