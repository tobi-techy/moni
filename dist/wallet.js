import { PrivyClient } from '@privy-io/server-auth';
import { createWalletClient, http } from 'viem';
import { base, baseSepolia } from 'viem/chains';
import { PRIVY_APP_ID, PRIVY_APP_SECRET, BASE_RPC_URL, DEMO_MODE } from './env.js';
let privyClient = null;
export function getPrivyClient() {
    if (!privyClient) {
        if (!PRIVY_APP_ID || !PRIVY_APP_SECRET) {
            throw new Error('Privy credentials not configured. Set PRIVY_APP_ID and PRIVY_APP_SECRET in .env');
        }
        privyClient = new PrivyClient(PRIVY_APP_ID, PRIVY_APP_SECRET);
    }
    return privyClient;
}
// Get the appropriate Base chain
export function getBaseChain() {
    return BASE_RPC_URL.includes('sepolia') ? baseSepolia : base;
}
// Create a wallet client for a user's embedded wallet
export async function createUserWalletClient(userId) {
    if (DEMO_MODE === 'true') {
        console.log('[DEMO] Returning mock wallet client');
        return null;
    }
    const privy = getPrivyClient();
    try {
        // Get the user's embedded wallet
        const user = await privy.getUser(userId);
        const embeddedWallet = user.wallet?.address;
        if (!embeddedWallet) {
            console.log(`No embedded wallet found for user ${userId}`);
            return null;
        }
        // Create wallet client with the user's wallet
        const walletClient = createWalletClient({
            account: embeddedWallet,
            chain: getBaseChain(),
            transport: http(BASE_RPC_URL),
        });
        return walletClient;
    }
    catch (error) {
        console.error('Error creating wallet client:', error);
        return null;
    }
}
// Create a wallet client from a private key (for demo/testing)
export function createWalletClientFromPrivateKey(privateKey) {
    return createWalletClient({
        account: privateKey,
        chain: getBaseChain(),
        transport: http(BASE_RPC_URL),
    });
}
// Get user's wallet client (alias for createUserWalletClient)
export async function getUserWalletClient(userId) {
    return createUserWalletClient(userId);
}
// Get user's wallet address
export async function getUserWalletAddress(userId) {
    if (DEMO_MODE === 'true') {
        // Return a demo address
        return '0x742d35Cc6634C0532925a3b8D4C0532925a3b8D4';
    }
    const privy = getPrivyClient();
    try {
        const user = await privy.getUser(userId);
        const embeddedWallet = user.wallet?.address;
        return embeddedWallet;
    }
    catch (error) {
        console.error('Error getting wallet address:', error);
        return null;
    }
}
// Link a wallet to a user (for wallet connection flow)
export async function linkWallet(userId, walletAddress) {
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
    }
    catch (error) {
        console.error('Error linking wallet:', error);
        return false;
    }
}
// Demo mode: simulate wallet balance
export async function getDemoBalance(tokenSymbol) {
    // Return simulated balances for demo
    const demoBalances = {
        AAPL: 100000000000000000000n, // 100 AAPL (18 decimals)
        NVDA: 50000000000000000000n, // 50 NVDA
        MSFT: 200000000000000000000n, // 200 MSFT
        USDC: 5000000000n, // 5000 USDC (6 decimals)
        WETH: 2000000000000000000n, // 2 WETH (18 decimals)
    };
    return demoBalances[tokenSymbol] || 0n;
}
//# sourceMappingURL=wallet.js.map