import { PrivyClient } from '@privy-io/server-auth';
import { type WalletClient, type Address, type Chain } from 'viem';
export declare function getPrivyClient(): PrivyClient;
export declare function getBaseChain(): Chain;
export declare function createUserWalletClient(userId: string): Promise<WalletClient | null>;
export declare function createWalletClientFromPrivateKey(privateKey: `0x${string}`): WalletClient;
export declare function getUserWalletClient(userId: string): Promise<WalletClient | null>;
export declare function getUserWalletAddress(userId: string): Promise<Address | null>;
export declare function linkWallet(userId: string, walletAddress: Address): Promise<boolean>;
export declare function getDemoBalance(tokenSymbol: string): Promise<bigint>;
//# sourceMappingURL=wallet.d.ts.map