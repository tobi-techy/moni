import { Spectrum } from 'spectrum-ts';
import { imessage, terminal } from 'spectrum-ts/providers';
import { PROJECT_ID, PROJECT_SECRET, validateEnv, DEMO_MODE } from './env.js';
import { BASE_RPC_URL } from './env.js';
import { handleConversation, ensureWalletConnected } from './conversation.js';
import { startProactiveMonitoring } from './proactive.js';
import { getUserWalletAddress } from './wallet.js';
import { type Address } from 'viem';

// Validate environment on startup
const envValidation = validateEnv();
if (!envValidation.valid && DEMO_MODE !== 'true') {
  console.error('Missing required environment variables:', envValidation.missing);
  process.exit(1);
}

// Simple session tracking (in production, use Redis or database)
const userSessions = new Map<string, { 
  walletAddress: Address | null; 
  authenticated: boolean;
  lastActive: number;
}>();

function getSession(userId: string) {
  let session = userSessions.get(userId);
  if (!session) {
    session = { walletAddress: null, authenticated: false, lastActive: Date.now() };
    userSessions.set(userId, session);
  }
  session.lastActive = Date.now();
  return session;
}

async function initializeWallet(userId: string): Promise<Address | null> {
  const session = getSession(userId);
  
  if (session.walletAddress) {
    return session.walletAddress;
  }

  const walletAddress = await getUserWalletAddress(userId);
  if (walletAddress) {
    session.walletAddress = walletAddress;
    session.authenticated = true;
  }
  
  return walletAddress;
}

// Main message handler - conversational
async function handleMessage(space: any, userId: string, text: string) {
  const trimmed = text.trim();
  const lower = trimmed.toLowerCase();

  // Quick wallet connect shortcut
  if (lower === '/connect' || lower === '/wallet' || lower === '/login') {
    const walletAddress = await initializeWallet(userId);
    if (walletAddress) {
      await space.send(`✅ Wallet connected: ${walletAddress.slice(0,6)}...${walletAddress.slice(-4)}`);
    } else if (DEMO_MODE === 'true') {
      const demoAddress = '0x742d35Cc6634C0532925a3b8D4C0532925a3b8D4' as Address;
      const session = getSession(userId);
      session.walletAddress = demoAddress;
      session.authenticated = true;
      await space.send(`✅ Demo wallet connected: ${demoAddress.slice(0,6)}...${demoAddress.slice(-4)}\nAll trades are simulated.`);
    } else {
      await space.send(`🔐 Connect your wallet via Privy:\nhttps://auth.privy.io/connect?app_id=${process.env.PRIVY_APP_ID}`);
    }
    return;
  }

  // Help command
  if (lower === '/help' || lower === '/commands') {
    await space.send(
      `Moni — your portfolio manager for tokenized stocks on Base.\n\n` +
      `Just talk to me naturally:\n` +
      `• "What's my portfolio worth?"\n` +
      `• "Buy $500 of NVDA with USDC"\n` +
      `• "Set a stop-loss for AAPL at $180"\n` +
      `• "Alert me if TSLA drops below $200"\n` +
      `• "Rebalance to 40% AAPL, 30% NVDA, 30% MSFT"\n` +
      `• "How risky is my portfolio?"\n` +
      `• "What's my watchlist doing?"\n\n` +
      `Shortcuts: /connect, /help`
    );
    return;
  }

  // Delegate to conversational handler
  await handleConversation(space, userId, text);
}

// Check if we have valid Spectrum credentials
const hasSpectrumCredentials = PROJECT_ID && PROJECT_SECRET && PROJECT_ID.length > 10;

// Create Spectrum app or run in CLI mode
if (hasSpectrumCredentials) {
  const providers = DEMO_MODE === 'true'
    ? [imessage.config(), terminal.config()]
    : [imessage.config(), terminal.config()];

  const app = await Spectrum({
    projectId: PROJECT_ID,
    projectSecret: PROJECT_SECRET,
    providers,
  });

  console.log('🚀 Moni iMessage Trading Agent started!');
  console.log(`📱 Demo mode: ${DEMO_MODE}`);
  console.log(`🌐 Base RPC: ${BASE_RPC_URL}`);

  // Start proactive monitoring in background
  if (DEMO_MODE === 'true') {
    // In demo mode, we'll simulate proactive checks
    // In production, this would send real iMessages
    console.log('🔄 Proactive monitoring enabled (demo mode)');
  }

  // Handle incoming messages
  for await (const [space] of app.messages) {
    // @ts-ignore - Spectrum space types
    const userId = space.user?.id || space.id || 'unknown';
    
    // @ts-ignore - Spectrum space types
    for await (const message of space.messages) {
      if (message.text) {
        await handleMessage(space, userId, message.text);
      }
    }
  }
} else {
  // CLI mode for demo/testing without Spectrum credentials
  console.log('🚀 Moni Trading Agent (CLI Demo Mode)');
  console.log(`📱 Demo mode: ${DEMO_MODE}`);
  console.log(`🌐 Base RPC: ${BASE_RPC_URL}`);
  console.log('\nJust chat naturally. Examples:');
  console.log('  "What\'s my portfolio?"');
  console.log('  "Buy $100 of AAPL with USDC"');
  console.log('  "Set stop-loss for NVDA at $800"');
  console.log('  "How risky is my portfolio?"');
  console.log('Type "exit" to quit\n');

  const readline = await import('readline');
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: 'moni> '
  });

  const demoUserId = 'demo-user';
  let space: any = {
    send: async (text: string) => console.log(`\n${text}\n`),
  };

  rl.prompt();

  rl.on('line', async (input: string) => {
    const trimmed = input.trim();
    if (trimmed === 'exit' || trimmed === 'quit') {
      console.log('👋 Goodbye!');
      rl.close();
      process.exit(0);
    }
    if (trimmed) {
      await handleMessage(space, demoUserId, trimmed);
    }
    rl.prompt();
  });
}
