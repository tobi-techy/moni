import { type Address } from 'viem';
import { B20TokenSymbol } from './constants.js';
export { B20_TOKENS } from './constants.js';
export type { B20TokenSymbol } from './constants.js';
export declare function getB20Address(symbol: B20TokenSymbol): Address;
export declare function getPriceFeedAddress(symbol: B20TokenSymbol): Address;
export declare function getTokenMetadata(symbol: B20TokenSymbol): Promise<{
    name: string;
    symbol: string;
    decimals: number;
    address: "0xb200000000000000000000C2e324d24d7eEcd1fb" | "0xb20000000000000000000078ee7ce2fE4908108C" | "0xB200000000000000000000Ab99cFa739E253872B" | "0xb2000000000000000000002D0BA3164cc74f58B7" | "0xb2000000000000000000008bC8786B856E61707C" | "0xb2000000000000000000001e800a7f5189430cD0" | "0x06A8E4b3aBB3B7543d8396FB2B763d22820cB295" | "0x408e44f504A7371a345F03a73dDC96A4b48e8aa7" | "0xAB657C39bac0D5886250D70849e2E3E008F2EECB" | "0xb2000000000000000000004884b426556b92883d" | "0xB20000000000000000000019f6E7C675b73C2e4D" | "0xb200000000000000000000397293Cb8cda9a10c5" | "0xb2000000000000000000007b9fcbd005511aCBd5";
}>;
export declare function getRawBalance(symbol: B20TokenSymbol, walletAddress: Address): Promise<bigint>;
export declare function getScaledBalance(symbol: B20TokenSymbol, walletAddress: Address): Promise<bigint>;
export declare function getMultiplier(symbol: B20TokenSymbol): Promise<bigint>;
export declare function getTokenPrice(symbol: B20TokenSymbol): Promise<{
    price: bigint;
    updatedAt: bigint;
    decimals: number;
} | null>;
export declare function getAllTokenPrices(): Promise<Record<B20TokenSymbol, {
    price: bigint;
    updatedAt: bigint;
}>>;
export declare function getPortfolio(walletAddress: Address): Promise<Array<{
    symbol: B20TokenSymbol;
    name: string;
    rawBalance: bigint;
    scaledBalance: bigint;
    price: bigint;
    valueUSD: bigint;
    multiplier: bigint;
}>>;
export declare function formatBalance(balance: bigint, decimals?: number): string;
export declare function formatUSD(value: bigint): string;
//# sourceMappingURL=base.d.ts.map