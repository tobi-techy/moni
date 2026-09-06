// Base Network Configuration
export const BASE_CHAIN_ID = 8453;
export const BASE_SEPOLIA_CHAIN_ID = 84532;

// Base RPC URLs
export const BASE_MAINNET_RPC = 'https://mainnet.base.org';
export const BASE_SEPOLIA_RPC = 'https://sepolia.base.org';

// Type for chain ID
export type ChainId = 8453 | 84532;

// B20 Token Contract Addresses (Mainnet)
export const B20_TOKENS = {
  AAPL: '0xb200000000000000000000C2e324d24d7eEcd1fb',
  NVDA: '0xb20000000000000000000078ee7ce2fE4908108C',
  MSFT: '0xB200000000000000000000Ab99cFa739E253872B',
  GOOGL: '0xb2000000000000000000002D0BA3164cc74f58B7',
  META: '0xb2000000000000000000008bC8786B856E61707C',
  TSLA: '0xb2000000000000000000001e800a7f5189430cD0',
  AMZN: '0x06A8E4b3aBB3B7543d8396FB2B763d22820cB295',
  COIN: '0x408e44f504A7371a345F03a73dDC96A4b48e8aa7',
  INTC: '0xAB657C39bac0D5886250D70849e2E3E008F2EECB',
  MSTR: '0xb2000000000000000000004884b426556b92883d',
  CRCL: '0xB20000000000000000000019f6E7C675b73C2e4D',
  SNDK: '0xb200000000000000000000397293Cb8cda9a10c5',
  SPCX: '0xb2000000000000000000007b9fcbd005511aCBd5',
  SPX: '0xb2000000000000000000008f0d3e8A9B1C2d4e5F6',
} as const;

export type B20TokenSymbol = keyof typeof B20_TOKENS;

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
  SPX: '0x9876543210fedcba9876543210fedcba987654',
  TSLA: '0xFaf869185383a24F8cb00e27BdA6b63B9905DCb4',
} as const;

// B20 Onchain Registry
export const B20_REGISTRY = '0x3f3E8cf41cdd3b1D118c16471aB0113DfDDd5CaD';

// Common ERC20 ABI (minimal for B20)
export const ERC20_ABI = [
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

// B20 Specific ABI (extends ERC20)
export const B20_ABI = [
  ...ERC20_ABI,
  'function multiplier() view returns (uint256)',
  'function scaledBalanceOf(address) view returns (uint256)',
  'function toScaledBalance(uint256 raw) view returns (uint256)',
  'function toRawBalance(uint256 scaled) view returns (uint256)',
  'function WAD_PRECISION() view returns (uint256)',
  'function contractURI() view returns (string)',
  'event MultiplierUpdated(uint256 oldMultiplier, uint256 newMultiplier)',
  'event Announcement(uint256 indexed id, string description, string uri)',
] as const;

// Chainlink Aggregator V3 ABI (minimal)
export const CHAINLINK_AGGREGATOR_ABI = [
  'function latestRoundData() view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)',
  'function decimals() view returns (uint8)',
  'function description() view returns (string)',
] as const;

// WAD Precision (1e18)
export const WAD_PRECISION = 10n ** 18n;

// 1inch API Base URLs
export const ONEINCH_BASE_URL = 'https://api.1inch.dev';
export const ONEINCH_SWAP_V6 = '/swap/v6.0';
export const ONEINCH_PRICE_V1 = '/price/v1.1';

// Supported tokens for 1inch (Base mainnet)
export const ONEINCH_SUPPORTED_TOKENS = {
  USDC: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  USDT: '0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb',
  WETH: '0x4200000000000000000000000000000000000006',
  ...B20_TOKENS,
} as const;
