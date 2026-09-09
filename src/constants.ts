import { parseAbi } from 'viem';

// Base Network Configuration (mainnet only — B20 tokenized stocks don't exist
// on Base Sepolia, so the bot is locked to the mainnet chain id 8453).
export const BASE_CHAIN_ID = 8453;

// Base RPC URLs
export const BASE_MAINNET_RPC = 'https://mainnet.base.org';

// B20 Token Contract Addresses (Mainnet) — Coinbase Tokenized Stocks on Base.
// These are the official Coinbase B20 contracts listed at docs.base.org
// (Tokenized Stocks on Base). AMZNc/COINc/INTCc were previously the CHAINLINK
// FEED addresses (those actually live on a different contract).
// Verified on-chain against mainnet.base.org.
//
// B20 tokens are 8-decimal ERC-20s; the multiplier is WAD-scaled (1e18).
// Confirmed on-chain: decimals() = 8, WAD_PRECISION() = 1e18 (multipler = 1.0
// as of this check, i.e. no corporate action yet). 1inch lists the same
// contracts at 8 decimals, so quotes line up with the ERC-20 units.
export const B20_TOKENS = {
  AAPL: '0xb200000000000000000000C2e324d24d7eEcd1fb',
  NVDA: '0xb20000000000000000000078ee7ce2fE4908108C',
  MSFT: '0xB200000000000000000000Ab99cFa739E253872B',
  GOOGL: '0xb2000000000000000000002D0BA3164cc74f58B7',
  META: '0xb2000000000000000000008bC8786B856E61707C',
  TSLA: '0xb2000000000000000000001e800a7f5189430cD0',
  AMZN: '0xb200000000000000000000d9192b6B456483C2E8',
  COIN: '0xb200000000000000000000c85a31389D71F3ecfb',
  INTC: '0xB2000000000000000000004AFF16039bA04bdFBc',
  MSTR: '0xb2000000000000000000004884b426556b92883d',
  CRCL: '0xB20000000000000000000019f6E7C675b73C2e4D',
  SNDK: '0xb200000000000000000000397293Cb8cda9a10c5',
  SPCX: '0xb2000000000000000000007b9fcbd005511aCBd5',
} as const;

export type B20TokenSymbol = keyof typeof B20_TOKENS;

// B20 ERC-20 token decimals. Verified on-chain (decimals() = 8) and used for
// all live balance/value math. Demo mode separately mocks balances at 18.
export const B20_DECIMALS = 8;

// Chainlink Price Feed Addresses (Mainnet)
export const CHAINLINK_PRICE_FEEDS = {
  AAPL: '0x787f13dEa48Db0897CbCDD985de77809D837F988',
  AMZN: '0x06A8E4b3aBB3B7543d8396FB2B763d22820cB295',
  COIN: '0x408e44f504A7371a345F03a73dDC96A4b48e8aa7',
  CRCL: '0x0231cF2635D1E17bB5c2462cc7504Ba1fBd61f33',
  GOOGL: '0x5bF49E0ffA937CE2FfF033c739aD7C634c4D34F2',
  INTC: '0xAB657C39bac0D5886250D70849e2E3E008F2EECB',
  META: '0x6526aE6797A76123638b863AeE4dD27Ba4E4b27D',
  MSFT: '0xeB10A6c9aa7E537aEd766C08c35Dae35B321b18c',
  MSTR: '0xB3cE282CD188b35DA0E38D8Bc7d58e33173D202a',
  NVDA: '0x04689a41629776563E6822F76f2e57D148d28513',
  SNDK: '0x388b0dC46C0Fb05A74BeE0994fa5b02c6Fcca2eA',
  SPCX: '0x6A634B235903C4ad6376892180d6fF8612e3Fa68',
  TSLA: '0xFaf869185383a24F8cb00e27BdA6b63B9905DCb4',
} as const;

// B20 Onchain Registry
export const B20_REGISTRY = '0x3f3E8cf41cdd3b1D118c16471aB0113DfDDd5CaD';

// Common ERC20 ABI (minimal for B20)
export const ERC20_ABI_STRINGS = [
  'function name() view returns (string)',
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
  'function balanceOf(address) view returns (uint256)',
  'function allowance(address,address) view returns (uint256)',
  'function approve(address,uint256) returns (bool)',
  'function transfer(address,uint256) returns (bool)',
  'function transferFrom(address,address,uint256) returns (bool)',
  'event Transfer(address indexed from, address indexed to, uint256 value)',
  'event Approval(address indexed owner, address indexed spender, uint256 value)',
] as const;

export const ERC20_ABI = parseAbi(ERC20_ABI_STRINGS);

// B20 Specific ABI (extends ERC20)
export const B20_ABI = parseAbi([
  ...ERC20_ABI_STRINGS,
  'function multiplier() view returns (uint256)',
  'function scaledBalanceOf(address) view returns (uint256)',
  'function toScaledBalance(uint256 raw) view returns (uint256)',
  'function toRawBalance(uint256 scaled) view returns (uint256)',
  'function WAD_PRECISION() view returns (uint256)',
  'function contractURI() view returns (string)',
  'event MultiplierUpdated(uint256 oldMultiplier, uint256 newMultiplier)',
  'event Announcement(uint256 indexed id, string description, string uri)',
] as const);

// Chainlink Aggregator V3 ABI (minimal)
export const CHAINLINK_AGGREGATOR_ABI = parseAbi([
  'function latestRoundData() view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)',
  'function decimals() view returns (uint8)',
  'function description() view returns (string)',
] as const);

// WAD Precision (1e18)
export const WAD_PRECISION = 10n ** 18n;

// 1inch API Base URLs
export const ONEINCH_BASE_URL = 'https://api.1inch.com';
export const ONEINCH_SWAP_V6 = '/swap/v6.1';
export const ONEINCH_PRICE_V1 = '/price/v1.1';

// Supported tokens for 1inch (Base mainnet)
export const ONEINCH_SUPPORTED_TOKENS = {
  USDC: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  USDT: '0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb',
  WETH: '0x4200000000000000000000000000000000000006',
  ...B20_TOKENS,
} as const;
