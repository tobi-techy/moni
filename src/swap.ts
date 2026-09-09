import { ONEINCH_BASE_URL, ONEINCH_SWAP_V6, ONEINCH_SUPPORTED_TOKENS, BASE_CHAIN_ID, B20_DECIMALS } from './constants.js';
import { ONEINCH_API_KEY, DEMO_MODE } from './env.js';

// 1inch Swap API Integration
export interface SwapQuote {
  fromToken: string;
  toToken: string;
  fromAmount: string;
  toAmount: string;
  estimatedGas: string;
  protocols: any[];
  gasPrice: string;
}

export interface SwapTransaction {
  from: string;
  to: string;
  data: string;
  value: string;
  gas: string;
  gasPrice: string;
}

// Get swap quote from 1inch
export async function getSwapQuote(
  fromToken: string,
  toToken: string,
  amount: string,
  slippage: number = 1.0
): Promise<SwapQuote | null> {
  if (DEMO_MODE === 'true') {
    // Return mock quote for demo
    const mockRate = getMockRate(fromToken, toToken);
    
    // Determine fromToken decimals for proper conversion
    const fromTokenDecimals = fromToken === '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' ? 6 : B20_DECIMALS; // USDC = 6, B20 = 8
    const toAmount = (BigInt(amount) * mockRate) / 10n ** BigInt(fromTokenDecimals);
    
    return {
      fromToken,
      toToken,
      fromAmount: amount,
      toAmount: toAmount.toString(),
      estimatedGas: '150000',
      protocols: [],
      gasPrice: '1000000000', // 1 gwei
    };
  }

  if (!ONEINCH_API_KEY) {
    console.warn('1inch API key not configured');
    return null;
  }

  try {
    const chainId = BASE_CHAIN_ID;
    const url = `${ONEINCH_BASE_URL}${ONEINCH_SWAP_V6}/${chainId}/quote?src=${fromToken}&dst=${toToken}&amount=${amount}`;
    
    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${ONEINCH_API_KEY}`,
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      if (response.status === 400) {
        // Most B20 stocks ARE listed on 1inch now (AAPL, NVDA, MSFT, GOOGL,
        // META, TSLA, AMZN, MSTR, SNDK, SPCX), but COIN/INTC/CRCL are not —
        // pairs involving those get a 400. Log clearly: missing liquidity for
        // that pair, not a flaky API.
        console.warn(
          `[1inch] 400 quote ${fromToken} -> ${toToken} on chain ${chainId}: ` +
          `token pair has no 1inch liquidity (COIN/INTC/CRCL aren't listed yet). ` +
          `Body: ${body.slice(0, 200)}`
        );
      } else {
        console.error(`[1inch] ${response.status} on quote ${fromToken} -> ${toToken}: ${body.slice(0, 200)}`);
      }
      throw new Error(`1inch API error: ${response.status}`);
    }

    // 1inch v6.1 returns the destination amount as `dstAmount` and the gas
    // estimate as a numeric `gas`. Normalize into the consumer-facing shape so
    // callers can rely on `fromAmount`/`toAmount`/`estimatedGas`.
    const data = await response.json() as any;
    return {
      fromToken,
      toToken,
      fromAmount: amount,
      toAmount: String(data?.dstAmount ?? data?.toAmount ?? data?.toTokenAmount ?? '0'),
      estimatedGas: String(data?.gas ?? data?.estimatedGas ?? ''),
      protocols: data?.protocols ?? [],
      gasPrice: String(data?.gasPrice ?? '0'),
    };
  } catch (error) {
    console.error('Error getting swap quote:', error);
    return null;
  }
}

// Get swap transaction data from 1inch
export async function getSwapTransaction(
  fromToken: string,
  toToken: string,
  amount: string,
  fromAddress: string,
  slippage: number = 1.0
): Promise<SwapTransaction | null> {
  if (DEMO_MODE === 'true') {
    // Return mock transaction for demo
    return {
      from: fromAddress,
      to: '0x111111125421ca6dc452d289314280a0f8842a65', // 1inch V6 router
      data: '0x',
      value: '0',
      gas: '150000',
      gasPrice: '1000000000',
    };
  }

  if (!ONEINCH_API_KEY) {
    console.warn('1inch API key not configured');
    return null;
  }

  try {
    const chainId = BASE_CHAIN_ID;

    // v6.1 /swap is a GET endpoint. `origin` is the EOA that signs/broadcasts
    // the tx — the Para-managed wallet itself — and must equal `from`.
    const params = new URLSearchParams({
      src: fromToken,
      dst: toToken,
      amount,
      from: fromAddress,
      origin: fromAddress,
      slippage: String(slippage),
      disableEstimate: 'false',
      allowPartialFill: 'false',
    });
    const url = `${ONEINCH_BASE_URL}${ONEINCH_SWAP_V6}/${chainId}/swap?${params.toString()}`;

    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${ONEINCH_API_KEY}`,
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      if (response.status === 400) {
        console.warn(
          `[1inch] 400 swap ${fromToken} -> ${toToken} on chain ${chainId}: ` +
          `token pair has no 1inch liquidity (B20 stocks aren't tradable there). ` +
          `Body: ${body.slice(0, 200)}`
        );
      } else {
        console.error(`[1inch] ${response.status} on swap ${fromToken} -> ${toToken}: ${body.slice(0, 200)}`);
      }
      throw new Error(`1inch API error: ${response.status}`);
    }

    // 1inch v6 returns the tx payload nested under `tx`. Unwrap it (and
    // tolerate a flat response shape) so callers always get a complete,
    // string-normalized SwapTransaction.
    const data = await response.json() as any;
    const t = data?.tx ?? data;
    return {
      from: t.from ?? fromAddress,
      to: t.to,
      data: t.data,
      value: String(t.value ?? '0'),
      gas: String(t.gas ?? t.gasLimit ?? '200000'),
      gasPrice: String(t.gasPrice ?? '1000000000'),
    };
  } catch (error) {
    console.error('Error getting swap transaction:', error);
    return null;
  }
}

// Get token price from 1inch Price API (USD per whole token)
export async function getTokenPrice1inch(tokenAddress: string): Promise<{ price: string; timestamp: number } | null> {
  if (DEMO_MODE === 'true') {
    return { price: '100', timestamp: Date.now() };
  }

  if (!ONEINCH_API_KEY) {
    return null;
  }

  try {
    const chainId = BASE_CHAIN_ID;
    const url = `${ONEINCH_BASE_URL}/price/v1.1/${chainId}/${tokenAddress}?currency=USD`;
    
    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${ONEINCH_API_KEY}`,
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`1inch Price API error: ${response.status}`);
    }

// Spot Price API v1.1 with currency=USD returns the price keyed by the
    // requested token address, e.g. { "0x833589...": "228.5" }.
    const data = await response.json() as Record<string, unknown>;
    const price = data[tokenAddress];
    if (typeof price !== 'string' && typeof price !== 'number') return null;
    return { price: String(price), timestamp: Date.now() };
  } catch (error) {
    console.error('Error getting 1inch price:', error);
    return null;
  }
}

// Get supported tokens from 1inch
export async function getSupportedTokens(): Promise<Record<string, any> | null> {
  if (DEMO_MODE === 'true') {
    return ONEINCH_SUPPORTED_TOKENS;
  }

  if (!ONEINCH_API_KEY) {
    return null;
  }

  try {
    const chainId = BASE_CHAIN_ID;
    const url = `${ONEINCH_BASE_URL}/token/v1.2/${chainId}`;
    
    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${ONEINCH_API_KEY}`,
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`1inch Token API error: ${response.status}`);
    }

    const data = await response.json() as Record<string, any>;
    return data;
  } catch (error) {
    console.error('Error getting supported tokens:', error);
    return null;
  }
}

// Mock rates for demo (fromToken -> toToken)
// Rates are in terms of: 1 fromToken unit (in its native decimals) = rate / 10^toDecimals toToken units
function getMockRate(fromToken: string, toToken: string): bigint {
  // Simplified mock rates (toToken quantities in B20_DECIMALS / USDC 6 units)
  const rates: Record<string, Record<string, bigint>> = {
    '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913': { // USDC (6 decimals)
      '0xb200000000000000000000C2e324d24d7eEcd1fb': 500000n, // USDC -> AAPL (1 AAPL = $200, so 1 USDC = 0.005 AAPL = 5e5 units @8)
      '0xb20000000000000000000078ee7ce2fE4908108C': 111111n,   // USDC -> NVDA (1 NVDA = $900, so 1 USDC = 0.00111... NVDA)
    },
    '0xb200000000000000000000C2e324d24d7eEcd1fb': { // AAPL (B20_DECIMALS)
      '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913': 200000000n, // AAPL -> USDC (1 AAPL = $200, rate = 200 * 1e6 = 2e8)
    },
    '0xb20000000000000000000078ee7ce2fE4908108C': { // NVDA (B20_DECIMALS)
      '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913': 900000000n, // NVDA -> USDC (1 NVDA = $900, rate = 900 * 1e6 = 9e8)
    },
  };

  return rates[fromToken]?.[toToken] || 10n ** 18n;
}

// Parse amount with decimals
export function parseAmount(amount: string, decimals: number): bigint {
  const [whole, fraction = ''] = amount.split('.');
  const paddedFraction = fraction.padEnd(decimals, '0').slice(0, decimals);
  return BigInt(whole) * 10n ** BigInt(decimals) + BigInt(paddedFraction);
}

// Format amount from wei
export function formatAmount(amount: bigint, decimals: number): string {
  const divisor = 10n ** BigInt(decimals);
  const whole = amount / divisor;
  const fraction = amount % divisor;
  
  if (fraction === 0n) {
    return whole.toString();
  }
  
  const fractionStr = fraction.toString().padStart(decimals, '0').replace(/0+$/, '');
  return `${whole}.${fractionStr}`;
}
