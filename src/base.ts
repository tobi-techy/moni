import { createPublicClient, http, type PublicClient, type Address } from 'viem';
import { base, baseSepolia } from 'viem/chains';
import { BASE_RPC_URL, DEMO_MODE } from './env.js';
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

// Create public client for reading
function getPublicClient(): PublicClient {
  const chain = BASE_RPC_URL.includes('sepolia') ? baseSepolia : base;
  return createPublicClient({
    chain,
    transport: http(BASE_RPC_URL),
  }) as PublicClient;
}

// Get B20 token contract address
export function getB20Address(symbol: B20TokenSymbol): Address {
  return B20_TOKENS[symbol];
}

// Get Chainlink price feed address
export function getPriceFeedAddress(symbol: B20TokenSymbol): Address {
  return CHAINLINK_PRICE_FEEDS[symbol];
}

// Get token metadata (name, symbol, decimals)
export async function getTokenMetadata(symbol: B20TokenSymbol) {
  if (DEMO_MODE === 'true') {
    return {
      name: `${symbol} Tokenized Stock`,
      symbol,
      decimals: 18,
      address: B20_TOKENS[symbol],
    };
  }

  const client = getPublicClient();
  const address = B20_TOKENS[symbol];

  try {
    const [name, symbolResult, decimals] = await Promise.all([
      client.readContract({ address, abi: B20_ABI, functionName: 'name' }),
      client.readContract({ address, abi: B20_ABI, functionName: 'symbol' }),
      client.readContract({ address, abi: B20_ABI, functionName: 'decimals' }),
    ]);

    return {
      name: name as string,
      symbol: symbolResult as string,
      decimals: decimals as number,
      address,
    };
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
export async function getMultiplier(symbol: B20TokenSymbol): Promise<bigint> {
  if (DEMO_MODE === 'true') {
    // Demo: 1.02x multiplier (2% dividend accrual)
    return 102n * (WAD_PRECISION / 100n);
  }

  const client = getPublicClient();
  const address = B20_TOKENS[symbol];

  try {
    const multiplier = await client.readContract({
      address,
      abi: B20_ABI,
      functionName: 'multiplier',
    });
    return multiplier as bigint;
  } catch (error) {
    console.error(`Error fetching multiplier for ${symbol}:`, error);
    return WAD_PRECISION; // Default 1.0
  }
}

// Get token price from Chainlink (returns price in USD with 8 decimals)
export async function getTokenPrice(symbol: B20TokenSymbol): Promise<{ price: bigint; updatedAt: bigint; decimals: number } | null> {
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

    const [, answer, , updatedAt] = roundData as [bigint, bigint, bigint, bigint];
    
    return {
      price: answer,
      updatedAt,
      decimals: Number(decimals),
    };
  } catch (error) {
    console.error(`Error fetching price for ${symbol}:`, error);
    return null;
  }
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
  
  const portfolio = await Promise.all(
    symbols.map(async (symbol) => {
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

      return {
        symbol,
        name: metadata.name,
        rawBalance,
        scaledBalance,
        price: priceData?.price || 0n,
        valueUSD,
        multiplier,
      };
    })
  );

  // Filter out zero balances
  return portfolio.filter(p => p.scaledBalance > 0n);
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
