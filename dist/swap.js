import { ONEINCH_BASE_URL, ONEINCH_SWAP_V6, ONEINCH_SUPPORTED_TOKENS } from './constants.js';
import { ONEINCH_API_KEY, BASE_RPC_URL, DEMO_MODE } from './env.js';
// Get swap quote from 1inch
export async function getSwapQuote(fromToken, toToken, amount, slippage = 1.0) {
    if (DEMO_MODE === 'true') {
        // Return mock quote for demo
        const mockRate = getMockRate(fromToken, toToken);
        // Determine fromToken decimals for proper conversion
        const fromTokenDecimals = fromToken === '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' ? 6 : 18; // USDC = 6, others = 18
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
        const chainId = BASE_RPC_URL.includes('sepolia') ? 84532 : 8453;
        const url = `${ONEINCH_BASE_URL}${ONEINCH_SWAP_V6}/${chainId}/quote?src=${fromToken}&dst=${toToken}&amount=${amount}&slippage=${slippage}`;
        const response = await fetch(url, {
            headers: {
                'Authorization': `Bearer ${ONEINCH_API_KEY}`,
                'Accept': 'application/json',
            },
        });
        if (!response.ok) {
            throw new Error(`1inch API error: ${response.status}`);
        }
        const data = await response.json();
        return data;
    }
    catch (error) {
        console.error('Error getting swap quote:', error);
        return null;
    }
}
// Get swap transaction data from 1inch
export async function getSwapTransaction(fromToken, toToken, amount, fromAddress, slippage = 1.0) {
    if (DEMO_MODE === 'true') {
        // Return mock transaction for demo
        return {
            from: fromAddress,
            to: '0x1111111254EEB25477B68FB85Ed929f73A960582', // 1inch router
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
        const chainId = BASE_RPC_URL.includes('sepolia') ? 84532 : 8453;
        const url = `${ONEINCH_BASE_URL}${ONEINCH_SWAP_V6}/${chainId}/swap`;
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${ONEINCH_API_KEY}`,
                'Accept': 'application/json',
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                src: fromToken,
                dst: toToken,
                amount,
                from: fromAddress,
                slippage,
                disableEstimate: false,
                allowPartialFill: false,
            }),
        });
        if (!response.ok) {
            throw new Error(`1inch API error: ${response.status}`);
        }
        const data = await response.json();
        return data;
    }
    catch (error) {
        console.error('Error getting swap transaction:', error);
        return null;
    }
}
// Get token price from 1inch Price API
export async function getTokenPrice1inch(tokenAddress) {
    if (DEMO_MODE === 'true') {
        return { price: '100', timestamp: Date.now() };
    }
    if (!ONEINCH_API_KEY) {
        return null;
    }
    try {
        const chainId = BASE_RPC_URL.includes('sepolia') ? 84532 : 8453;
        const url = `${ONEINCH_BASE_URL}/price/v1.1/${chainId}/${tokenAddress}`;
        const response = await fetch(url, {
            headers: {
                'Authorization': `Bearer ${ONEINCH_API_KEY}`,
                'Accept': 'application/json',
            },
        });
        if (!response.ok) {
            throw new Error(`1inch Price API error: ${response.status}`);
        }
        const data = await response.json();
        return data;
    }
    catch (error) {
        console.error('Error getting 1inch price:', error);
        return null;
    }
}
// Get supported tokens from 1inch
export async function getSupportedTokens() {
    if (DEMO_MODE === 'true') {
        return ONEINCH_SUPPORTED_TOKENS;
    }
    if (!ONEINCH_API_KEY) {
        return null;
    }
    try {
        const chainId = BASE_RPC_URL.includes('sepolia') ? 84532 : 8453;
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
        const data = await response.json();
        return data;
    }
    catch (error) {
        console.error('Error getting supported tokens:', error);
        return null;
    }
}
// Mock rates for demo (fromToken -> toToken)
function getMockRate(fromToken, toToken) {
    // Simplified mock rates (18 decimals)
    const rates = {
        '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913': {
            '0xb200000000000000000000C2e324d24d7eEcd1fb': 5000000000000000n, // USDC -> AAPL (1 AAPL = $200, so 1 USDC = 0.005 AAPL)
            '0xb20000000000000000000078ee7ce2fE4908108C': 1111111111111111n, // USDC -> NVDA (1 NVDA = $900, so 1 USDC = 0.00111... NVDA)
        },
        '0xb200000000000000000000C2e324d24d7eEcd1fb': {
            '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913': 200000000000000000000n, // AAPL -> USDC (1 AAPL = $200)
        },
        '0xb20000000000000000000078ee7ce2fE4908108C': {
            '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913': 900000000000000000000n, // NVDA -> USDC (1 NVDA = $900)
        },
    };
    return rates[fromToken]?.[toToken] || 10n ** 18n;
}
// Parse amount with decimals
export function parseAmount(amount, decimals) {
    const [whole, fraction = ''] = amount.split('.');
    const paddedFraction = fraction.padEnd(decimals, '0').slice(0, decimals);
    return BigInt(whole) * 10n ** BigInt(decimals) + BigInt(paddedFraction);
}
// Format amount from wei
export function formatAmount(amount, decimals) {
    const divisor = 10n ** BigInt(decimals);
    const whole = amount / divisor;
    const fraction = amount % divisor;
    if (fraction === 0n) {
        return whole.toString();
    }
    const fractionStr = fraction.toString().padStart(decimals, '0').replace(/0+$/, '');
    return `${whole}.${fractionStr}`;
}
//# sourceMappingURL=swap.js.map