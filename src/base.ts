import { createPublicClient, http, fallback, type PublicClient, type Address } from 'viem';
import { base, baseSepolia } from 'viem/chains';
import { BASE_RPC_URL, BASE_RPC_FALLBACKS, DEMO_MODE } from './env.js';
import { 
  B20_TOKENS, 
  CHAINLINK_PRICE_FEEDS, 
  B20_ABI, 
  CHAINLINK_AGGREGATOR_ABI, 
  WAD_PRECISION,
  B20TokenSymbol 
} from './constants.js';

// Re-export constants for convenience
export { B20_TOKENS } from './constants.js';
export type { B20TokenSymbol } from './constants.js';

// Create public client for reading. Cached as a singleton so callers reuse one
// client, and wrapped in a viem `fallback` transport so a rate-limited or down
// primary RPC (mainnet.base.org was returning -32016 "over rate limit" under
// getPortfolio's read burst) automatically fails over to community Base RPCs.
let client: PublicClient | null = null;
export function getPublicClient(): PublicClient {
  if (client) return client;
  const chain = BASE_RPC_URL.includes('sepolia') ? baseSepolia : base;
  client = createPublicClient({
    chain,
    transport: fallback(
      [BASE_RPC_URL, ...BASE_RPC_FALLBACKS].map((url) =>
        http(url, { timeout: 15_000 })
      )
    ),
  }) as PublicClient;
  return client;
}

// Get B20 token contract address
export function getB20Address(symbol: B20TokenSymbol): Address {
  return B20_TOKENS[symbol];
}

// Get Chainlink price feed address
export function getPriceFeedAddress(symbol: B20TokenSymbol): Address {
  return CHAINLINK_PRICE_FEEDS[symbol];
}

// Token metadata (name/symbol/decimals) is immutable on-chain — cache it
// forever per symbol to avoid 3 eth_calls/token on every portfolio refresh.
export interface TokenMetadata {
  name: string;
  symbol: string;
  decimals: number;
  address: Address;
}
const METADATA_CACHE = new Map<B20TokenSymbol, TokenMetadata>();

// Get token metadata (name, symbol, decimals)
export async function getTokenMetadata(symbol: B20TokenSymbol): Promise<TokenMetadata> {
  if (DEMO_MODE === 'true') {
    return {
      name: `${symbol} Tokenized Stock`,
      symbol,
      decimals: 18,
      address: B20_TOKENS[symbol],
    };
  }

  const cached = METADATA_CACHE.get(symbol);
  if (cached) return cached;

  const client = getPublicClient();
  const address = B20_TOKENS[symbol];

  try {
    const [name, symbolResult, decimals] = await Promise.all([
      client.readContract({ address, abi: B20_ABI, functionName: 'name' }),
      client.readContract({ address, abi: B20_ABI, functionName: 'symbol' }),
      client.readContract({ address, abi: B20_ABI, functionName: 'decimals' }),
    ]);

    const entry: TokenMetadata = {
      name: name as string,
      symbol: symbolResult as string,
      decimals: decimals as number,
      address,
    };
    METADATA_CACHE.set(symbol, entry);
    return entry;
  } catch (error) {
    console.error(`Error fetching metadata for ${symbol}:`, error);
    throw error;
  }
}

// Get raw balance (B20 token units)
export async function getRawBalance(symbol: B20TokenSymbol, walletAddress: Address): Promise<bigint> {
  if (DEMO_MODE === 'true') {
    // Return demo balance
    const demoBalances: Record<string, bigint> = {
      AAPL: 100000000000000000000n,
      NVDA: 50000000000000000000n,
      MSFT: 200000000000000000000n,
    };
    return demoBalances[symbol] || 0n;
  }

  const client = getPublicClient();
  const address = B20_TOKENS[symbol];

  try {
    const balance = await client.readContract({
      address,
      abi: B20_ABI,
      functionName: 'balanceOf',
      args: [walletAddress],
    });
    return balance as bigint;
  } catch (error) {
    console.error(`Error fetching raw balance for ${symbol}:`, error);
    return 0n;
  }
}

// Get scaled balance (accounting for multiplier/dividends/splits)
export async function getScaledBalance(symbol: B20TokenSymbol, walletAddress: Address): Promise<bigint> {
  if (DEMO_MODE === 'true') {
    const demoBalances: Record<string, bigint> = {
      AAPL: 102000000000000000000n, // 102 AAPL (with 2% dividend multiplier)
      NVDA: 51000000000000000000n,  // 51 NVDA
      MSFT: 204000000000000000000n, // 204 MSFT
    };
    return demoBalances[symbol] || 0n;
  }

  const client = getPublicClient();
  const address = B20_TOKENS[symbol];

  try {
    const balance = await client.readContract({
      address,
      abi: B20_ABI,
      functionName: 'scaledBalanceOf',
      args: [walletAddress],
    });
    return balance as bigint;
  } catch (error) {
    console.error(`Error fetching scaled balance for ${symbol}:`, error);
    // Fallback to raw balance
    return getRawBalance(symbol, walletAddress);
  }
}

// Get current multiplier
const MULTIPLIER_TTL_MS = 60_000;
const MULTIPLIER_CACHE = new Map<B20TokenSymbol, { value: bigint; at: number }>();

export async function getMultiplier(symbol: B20TokenSymbol): Promise<bigint> {
  if (DEMO_MODE === 'true') {
    // Demo: 1.02x multiplier (2% dividend accrual)
    return 102n * (WAD_PRECISION / 100n);
  }

  const cached = MULTIPLIER_CACHE.get(symbol);
  if (cached && Date.now() - cached.at < MULTIPLIER_TTL_MS) return cached.value;

  const client = getPublicClient();
  const address = B20_TOKENS[symbol];

  try {
    const multiplier = await client.readContract({
      address,
      abi: B20_ABI,
      functionName: 'multiplier',
    });
    MULTIPLIER_CACHE.set(symbol, { value: multiplier as bigint, at: Date.now() });
    return multiplier as bigint;
  } catch (error) {
    console.error(`Error fetching multiplier for ${symbol}:`, error);
    return WAD_PRECISION; // Default 1.0
  }
}

export interface TokenPrice {
  price: bigint;
  updatedAt: bigint;
  decimals: number;
}

// Prices are read in several hot paths (portfolio, watchlist, proactive
// summary) — cache briefly so concurrent callers share one Chainlink read
// instead of each firing its own eth_calls at the RPC.
const PRICE_TTL_MS = 15_000;
const PRICE_CACHE = new Map<B20TokenSymbol, { value: TokenPrice | null; at: number }>();

// Get token price from Chainlink (returns price in USD with 8 decimals)
export async function getTokenPrice(symbol: B20TokenSymbol): Promise<TokenPrice | null> {
  const cached = PRICE_CACHE.get(symbol);
  if (cached && Date.now() - cached.at < PRICE_TTL_MS) return cached.value;

  const value = await fetchTokenPrice(symbol);
  PRICE_CACHE.set(symbol, { value, at: Date.now() });
  return value;
}

async function fetchTokenPrice(symbol: B20TokenSymbol): Promise<TokenPrice | null> {
  if (DEMO_MODE === 'true') {
    // Demo prices (in USD with 8 decimals)
    const demoPrices: Record<string, bigint> = {
      AAPL: 20000000000n,   // $200.00
      NVDA: 90000000000n,   // $900.00
      MSFT: 40000000000n,   // $400.00
      GOOGL: 15000000000n,  // $150.00
      META: 50000000000n,   // $500.00
      TSLA: 25000000000n,   // $250.00
    };
    return {
      price: demoPrices[symbol] || 10000000000n,
      updatedAt: BigInt(Math.floor(Date.now() / 1000)),
      decimals: 8,
    };
  }

  const client = getPublicClient();
  const feedAddress = CHAINLINK_PRICE_FEEDS[symbol];

  try {
    const [roundData, decimals] = await Promise.all([
      client.readContract({
        address: feedAddress,
        abi: CHAINLINK_AGGREGATOR_ABI,
        functionName: 'latestRoundData',
      }),
      client.readContract({
        address: feedAddress,
        abi: CHAINLINK_AGGREGATOR_ABI,
        functionName: 'decimals',
      }),
    ]);

    const [, answer, , updatedAt] = roundData as readonly [bigint, bigint, bigint, bigint, bigint];

    return {
      price: answer,
      updatedAt,
      decimals: Number(decimals),
    };
  } catch (error) {
    // Most symbols have a live Chainlink feed on Base; when one is missing or
    // the read fails (rate limit/revert) we fall back to the real underlying
    // market price (Yahoo, keyless), then to a static reference price if the
    // live source is unreachable. (1inch was dropped — B20 token addresses
    // aren't supported by the 1inch price API, so it only produced 400s.)
    const live = await getLiveMarketPrice(symbol);
    if (live) {
      return {
        price: live.price,
        updatedAt: BigInt(Math.floor(live.fetchedAt / 1000)),
        decimals: 8,
      };
    }
    return getFallbackPrice(symbol);
  }
}

// ─── Live market data (Yahoo Finance, keyless) ─────────────────────────────

// B20 tokenized stocks track their underlying US ticker ~1:1, so the real
// stock price is the honest market reference. Tickers that aren't publicly
// listed (CRCL, SPCX) intentionally have no mapping and fall back to static.
const MARKET_DATA_TICKERS: Partial<Record<B20TokenSymbol, string>> = {
  AAPL: 'AAPL',
  NVDA: 'NVDA',
  MSFT: 'MSFT',
  GOOGL: 'GOOGL',
  META: 'META',
  TSLA: 'TSLA',
  AMZN: 'AMZN',
  COIN: 'COIN',
  INTC: 'INTC',
  MSTR: 'MSTR',
  SNDK: 'SNDK',
};

const MARKET_DATA_CACHE = new Map<string, { price: bigint; fetchedAt: number }>();
const MARKET_DATA_TTL_MS = 30_000;

async function getLiveMarketPrice(symbol: B20TokenSymbol): Promise<{ price: bigint; fetchedAt: number } | null> {
  const cached = MARKET_DATA_CACHE.get(symbol);
  if (cached && Date.now() - cached.fetchedAt < MARKET_DATA_TTL_MS) return cached;

  const ticker = MARKET_DATA_TICKERS[symbol];
  if (!ticker) return null;

  try {
    const response = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=1d&range=1d`,
      { headers: { 'User-Agent': 'Mozilla/5.0' } }
    );
    if (!response.ok) return null;

    const json = await response.json() as any;
    const price = json?.chart?.result?.[0]?.meta?.regularMarketPrice;
    if (typeof price !== 'number' || !Number.isFinite(price) || price <= 0) return null;

    const entry = { price: BigInt(Math.round(price * 1e8)), fetchedAt: Date.now() };
    MARKET_DATA_CACHE.set(symbol, entry);
    return entry;
  } catch {
    return null;
  }
}

// Static USD reference prices (8 decimals) — last-resort fallback when the
// live Yahoo chain is unreachable or the ticker isn't publicly listed.
const FALLBACK_PRICES: Record<string, bigint> = {
  AAPL: 22800000000n,
  NVDA: 130000000000n,
  MSFT: 41500000000n,
  GOOGL: 17200000000n,
  META: 50500000000n,
  TSLA: 24800000000n,
  AMZN: 18500000000n,
  COIN: 21500000000n,
  INTC: 2200000000n,
  MSTR: 16800000000n,
  CRCL: 5600000000n,
  SNDK: 9800000000n,
  SPCX: 57000000000n,
};

function getFallbackPrice(symbol: B20TokenSymbol): { price: bigint; updatedAt: bigint; decimals: number } | null {
  const price = FALLBACK_PRICES[symbol];
  if (!price) return null;
  return {
    price,
    updatedAt: BigInt(Math.floor(Date.now() / 1000)),
    decimals: 8,
  };
}

// Get all token prices at once
export async function getAllTokenPrices(): Promise<Record<B20TokenSymbol, { price: bigint; updatedAt: bigint }>> {
  const symbols = Object.keys(B20_TOKENS) as B20TokenSymbol[];
  const results: Record<B20TokenSymbol, { price: bigint; updatedAt: bigint }> = {} as any;

  await Promise.all(
    symbols.map(async (symbol) => {
      const priceData = await getTokenPrice(symbol);
      if (priceData) {
        results[symbol] = { price: priceData.price, updatedAt: priceData.updatedAt };
      }
    })
  );

  return results;
}

// Get user's full portfolio
export async function getPortfolio(walletAddress: Address): Promise<Array<{
  symbol: B20TokenSymbol;
  name: string;
  rawBalance: bigint;
  scaledBalance: bigint;
  price: bigint;
  valueUSD: bigint;
  multiplier: bigint;
}>> {
  const symbols = Object.keys(B20_TOKENS) as B20TokenSymbol[];

  // Run symbol fetches in a small worker pool instead of one giant Promise.all.
  // Firing all 13 symbols (~13 symbols × 4-6 eth_calls each ≈ 80-100 requests)
  // at once is what trips the public RPC's rate limiter (-32016). Bounding
  // concurrency keeps the burst small, and a per-symbol try/catch means one
  // rate-limited token can never reject the whole portfolio.
  const CONCURRENCY = 6;
  const results = new Array(symbols.length).fill(null) as PortfolioEntry[];
  let cursor = 0;

  async function worker(): Promise<void> {
    while (cursor < symbols.length) {
      const idx = cursor++;
      const symbol = symbols[idx];
      try {
        const [metadata, rawBalance, scaledBalance, priceData, multiplier] = await Promise.all([
          getTokenMetadata(symbol),
          getRawBalance(symbol, walletAddress),
          getScaledBalance(symbol, walletAddress),
          getTokenPrice(symbol),
          getMultiplier(symbol),
        ]);

        // Calculate USD value: (scaledBalance / 10^18) * (priceData.price / 10^8) * 10^8
        // = scaledBalance * priceData.price / 10^18
        // Result is in 8-decimal format (matching Chainlink/formatUSD)
        const valueUSD = priceData
          ? (scaledBalance * priceData.price) / 10n ** 18n
          : 0n;

        results[idx] = {
          symbol,
          name: metadata.name,
          rawBalance,
          scaledBalance,
          price: priceData?.price || 0n,
          valueUSD,
          multiplier,
        };
      } catch (error) {
        console.error(`Portfolio entry failed for ${symbol}:`, error);
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, symbols.length) }, worker)
  );

  // Filter out failed entries and zero balances
  return results.filter(
    (p): p is PortfolioEntry => p !== null && p.scaledBalance > 0n
  );
}

interface PortfolioEntry {
  symbol: B20TokenSymbol;
  name: string;
  rawBalance: bigint;
  scaledBalance: bigint;
  price: bigint;
  valueUSD: bigint;
  multiplier: bigint;
}

// Format balance for display
export function formatBalance(balance: bigint, decimals: number = 18): string {
  const divisor = 10n ** BigInt(decimals);
  const whole = balance / divisor;
  const fraction = balance % divisor;
  
  if (fraction === 0n) {
    return whole.toString();
  }
  
  const fractionStr = fraction.toString().padStart(decimals, '0').replace(/0+$/, '');
  return `${whole}.${fractionStr}`;
}

// Format USD value
export function formatUSD(value: bigint): string {
  const divisor = 10n ** 8n; // 8 decimals from Chainlink
  const whole = value / divisor;
  const fraction = value % divisor;
  
  if (fraction === 0n) {
    return `$${whole.toString()}`;
  }
  
  const fractionStr = fraction.toString().padStart(8, '0').replace(/0+$/, '');
  return `$${whole}.${fractionStr}`;
}
