// Centralized environment variable access
export const PROJECT_ID = process.env.PROJECT_ID || '';
export const PROJECT_SECRET = process.env.PROJECT_SECRET || '';
export const PRIVY_APP_ID = process.env.PRIVY_APP_ID || '';
export const PRIVY_APP_SECRET = process.env.PRIVY_APP_SECRET || '';
export const BASE_RPC_URL = process.env.BASE_RPC_URL || '';
export const ONEINCH_API_KEY = process.env.ONEINCH_API_KEY || '';
export const LETTA_API_KEY = process.env.LETTA_API_KEY || '';
export const LETTA_BASE_URL = process.env.LETTA_BASE_URL || 'https://api.letta.com';
export const DEMO_MODE = process.env.DEMO_MODE || 'true';

// Validation
export function validateEnv(): { valid: boolean; missing: string[] } {
  const missing = [
    ...(!PROJECT_ID ? ['PROJECT_ID'] : []),
    ...(!PROJECT_SECRET ? ['PROJECT_SECRET'] : []),
    ...(!PRIVY_APP_ID ? ['PRIVY_APP_ID'] : []),
    ...(!PRIVY_APP_SECRET ? ['PRIVY_APP_SECRET'] : []),
    ...(!BASE_RPC_URL || BASE_RPC_URL.trim() === '' ? ['BASE_RPC_URL'] : []),
  ];

  const isDemo = DEMO_MODE === 'true';
  const requiredInDemo = missing.filter(k => k !== 'PROJECT_ID' && k !== 'PROJECT_SECRET');

  return {
    valid: isDemo ? requiredInDemo.length === 0 : missing.length === 0,
    missing: isDemo ? requiredInDemo : missing,
  };
}
