// Centralized environment variable access
export const PROJECT_ID = process.env.PROJECT_ID || '';
export const PROJECT_SECRET = process.env.PROJECT_SECRET || '';
export const PRIVY_APP_ID = process.env.PRIVY_APP_ID || '';
export const PRIVY_APP_SECRET = process.env.PRIVY_APP_SECRET || '';
export const BASE_RPC_URL = process.env.BASE_RPC_URL || 'https://mainnet.base.org';
export const ONEINCH_API_KEY = process.env.ONEINCH_API_KEY || '';
export const CENCORI_API_KEY = process.env.CENCORI_API_KEY || '';
export const CENCORI_MODEL = process.env.CENCORI_MODEL || 'claude-sonnet-4.5';
export const DEMO_MODE = process.env.DEMO_MODE || 'true';
export const SPECTRUM_WEBHOOK_SECRET = process.env.SPECTRUM_WEBHOOK_SECRET || '';
export const WEBHOOK_PORT = parseInt(process.env.WEBHOOK_PORT || '3001', 10);

// Validation
export function validateEnv(): { valid: boolean; missing: string[] } {
  const required = [
    { key: 'PROJECT_ID', value: PROJECT_ID },
    { key: 'PROJECT_SECRET', value: PROJECT_SECRET },
    { key: 'PRIVY_APP_ID', value: PRIVY_APP_ID },
    { key: 'PRIVY_APP_SECRET', value: PRIVY_APP_SECRET },
  ];

  const missing = required
    .filter(({ value }) => !value)
    .map(({ key }) => key);

  // In demo mode, Spectrum credentials are optional (for local testing)
  const isDemo = DEMO_MODE === 'true';
  const requiredInDemo = missing.filter(k => k !== 'PROJECT_ID' && k !== 'PROJECT_SECRET');
  
  return {
    valid: isDemo ? requiredInDemo.length === 0 : missing.length === 0,
    missing: isDemo ? requiredInDemo : missing,
  };
}
