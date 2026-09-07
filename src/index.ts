import { createServer, IncomingMessage, ServerResponse } from 'http';
import { Spectrum } from 'spectrum-ts';
import { imessage, terminal } from 'spectrum-ts/providers';
import { typing } from 'spectrum-ts';
import { PROJECT_ID, PROJECT_SECRET, validateEnv, DEMO_MODE, SPECTRUM_WEBHOOK_SECRET, WEBHOOK_PORT } from './env.js';
import { BASE_RPC_URL } from './env.js';
import { handleConversation, ensureWalletConnected } from './conversation.js';
import { startProactiveMonitoring } from './proactive.js';
import { getUserWalletAddress } from './wallet.js';
import { startHealthServer } from './health.js';
import { type Address } from 'viem';

// Structured logging
const log = {
  info: (msg: string, meta?: Record<string, any>) => console.log(JSON.stringify({ level: 'info', msg, ...meta, timestamp: new Date().toISOString() })),
  warn: (msg: string, meta?: Record<string, any>) => console.warn(JSON.stringify({ level: 'warn', msg, ...meta, timestamp: new Date().toISOString() })),
  error: (msg: string, meta?: Record<string, any>) => console.error(JSON.stringify({ level: 'error', msg, ...meta, timestamp: new Date().toISOString() })),
};

// Start health check server for AtlasFlow/container orchestration
await startHealthServer();

// Validate environment on startup
const envValidation = validateEnv();
if (!envValidation.valid && DEMO_MODE !== 'true') {
  log.error('Missing required environment variables', { missing: envValidation.missing });
  process.exit(1);
}

// Simple session tracking (in production, use Redis or database)
const userSessions = new Map<string, { 
  walletAddress: Address | null; 
  authenticated: boolean;
  lastActive: number;
}>();

// Session cleanup interval (5 minutes)
const SESSION_TTL = 5 * 60 * 1000;
const CLEANUP_INTERVAL = 5 * 60 * 1000;

function getSession(userId: string) {
  let session = userSessions.get(userId);
  if (!session) {
    session = { walletAddress: null, authenticated: false, lastActive: Date.now() };
    userSessions.set(userId, session);
  }
  session.lastActive = Date.now();
  return session;
}

// Periodic cleanup of stale sessions
function startSessionCleanup(): NodeJS.Timeout {
  return setInterval(() => {
    const now = Date.now();
    let cleaned = 0;
    for (const [userId, session] of userSessions.entries()) {
      if (now - session.lastActive > SESSION_TTL) {
        userSessions.delete(userId);
        cleaned++;
      }
    }
    if (cleaned > 0) {
      log.info('Cleaned up stale sessions', { count: cleaned, remaining: userSessions.size });
    }
  }, CLEANUP_INTERVAL);
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

// Rate limiting (simple in-memory, per user)
const rateLimits = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT_WINDOW = 60 * 1000; // 1 minute
const RATE_LIMIT_MAX = 30; // 30 messages per minute

function checkRateLimit(userId: string): boolean {
  const now = Date.now();
  const limit = rateLimits.get(userId);
  
  if (!limit || now > limit.resetAt) {
    rateLimits.set(userId, { count: 1, resetAt: now + RATE_LIMIT_WINDOW });
    return true;
  }
  
  if (limit.count >= RATE_LIMIT_MAX) {
    return false;
  }
  
  limit.count++;
  return true;
}

// Helper to send a message with typing indicator
async function sendWithTyping(space: any, content: string | any) {
  // Start typing indicator
  await space.send(typing('start'));
  
  try {
    // Send the actual content
    await space.send(content);
  } finally {
    // Stop typing indicator
    await space.send(typing('stop'));
  }
}

// Main message handler - conversational
async function handleMessage(space: any, userId: string, text: string) {
  // Rate limiting
  if (!checkRateLimit(userId)) {
    await sendWithTyping(space, '⚠️ Too many messages. Please slow down.');
    return;
  }

  const trimmed = text.trim();
  const lower = trimmed.toLowerCase();

  // Quick wallet connect shortcut
  if (lower === '/connect' || lower === '/wallet' || lower === '/login') {
    const walletAddress = await initializeWallet(userId);
    if (walletAddress) {
      await sendWithTyping(space, `✅ Wallet connected: ${walletAddress.slice(0,6)}...${walletAddress.slice(-4)}`);
    } else if (DEMO_MODE === 'true') {
      const demoAddress = '0x742d35Cc6634C0532925a3b8D4C0532925a3b8D4' as Address;
      const session = getSession(userId);
      session.walletAddress = demoAddress;
      session.authenticated = true;
      await sendWithTyping(space, `✅ Demo wallet connected: ${demoAddress.slice(0,6)}...${demoAddress.slice(-4)}\nAll trades are simulated.`);
    } else {
      await sendWithTyping(space, `🔐 Connect your wallet via Privy:\nhttps://auth.privy.io/connect?app_id=${process.env.PRIVY_APP_ID}`);
    }
    return;
  }

  // Help command
  if (lower === '/help' || lower === '/commands') {
    await sendWithTyping(space,
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
  try {
    await handleConversation(space, userId, text);
  } catch (error) {
    log.error('Error handling message', { userId, error: (error as Error).message });
    await sendWithTyping(space, '❌ Something went wrong. Please try again.');
  }
}

// Graceful shutdown handler
let isShuttingDown = false;
let cleanupInterval: NodeJS.Timeout | null = null;

async function shutdown(signal: string) {
  if (isShuttingDown) return;
  isShuttingDown = true;
  
  log.info(`Received ${signal}, starting graceful shutdown...`);
  
  // Stop session cleanup
  if (cleanupInterval) {
    clearInterval(cleanupInterval);
  }
  
  // Clear sessions
  userSessions.clear();
  rateLimits.clear();
  
  log.info('Shutdown complete');
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('unhandledRejection', (reason) => {
  log.error('Unhandled rejection', { reason: String(reason) });
});
process.on('uncaughtException', (error) => {
  log.error('Uncaught exception', { error: error.message, stack: error.stack });
  shutdown('uncaughtException');
});

// Check if we have valid Spectrum credentials
const hasSpectrumCredentials = PROJECT_ID && PROJECT_SECRET && PROJECT_ID.length > 10;

// Check if we're in an interactive TTY (for CLI mode)
const isInteractive = process.stdin.isTTY;

// Create Spectrum app or run in appropriate mode
if (hasSpectrumCredentials) {
  const providers = DEMO_MODE === 'true'
    ? [imessage.config(), terminal.config()]
    : [imessage.config(), terminal.config()];

  const app = await Spectrum({
    projectId: PROJECT_ID,
    projectSecret: PROJECT_SECRET,
    providers,
    webhookSecret: SPECTRUM_WEBHOOK_SECRET || undefined,
  });

  log.info('Moni iMessage Trading Agent started', { demoMode: DEMO_MODE, baseRpc: BASE_RPC_URL });

  // Start session cleanup
  cleanupInterval = startSessionCleanup();

  // Start proactive monitoring in background
  if (DEMO_MODE === 'true') {
    log.info('Proactive monitoring enabled (demo mode)');
  }

  // Start webhook server if webhook secret is configured
  if (SPECTRUM_WEBHOOK_SECRET) {
    const webhookServer = createServer(async (req: IncomingMessage, res: ServerResponse) => {
      if (req.method === 'POST' && req.url?.endsWith('/spectrum/webhook')) {
        // Collect raw body for HMAC verification
        const chunks: Buffer[] = [];
        for await (const chunk of req) {
          chunks.push(chunk);
        }
        const body = Buffer.concat(chunks);
        
        const headers: Record<string, string> = {};
        for (const [key, value] of Object.entries(req.headers)) {
          if (value) headers[key] = Array.isArray(value) ? value[0] : value;
        }
        
        try {
          const result = await app.webhook(
            { body, headers },
            async (space: any, message: any) => {
              // Handle message (fire-and-forget)
              if (message.content?.type === 'text' && message.content.text) {
                const userId = space.user?.id || space.id || 'unknown';
                await handleMessage(space, userId, message.content.text);
              }
            }
          );
          
          res.writeHead(result.status, result.headers);
          res.end(Buffer.from(result.body));
        } catch (error) {
          console.error('Webhook error:', error);
          res.writeHead(500, { 'Content-Type': 'text/plain' });
          res.end('Internal Server Error');
        }
        return;
      }
      
      // Health check endpoint
      if (req.method === 'GET' && req.url?.endsWith('/health')) {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('OK');
        return;
      }
      
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not Found');
    });
    
    webhookServer.listen(WEBHOOK_PORT, () => {
      log.info(`Webhook server listening`, { port: WEBHOOK_PORT, path: '/spectrum/webhook' });
      log.info(`Health check`, { path: '/health' });
    });
  }

  // Handle incoming messages via streaming (FIXED: proper destructuring)
  for await (const [space, message] of app.messages) {
    // Skip outbound messages (our own responses)
    if (message.direction === 'outbound') continue;
    
    // @ts-ignore - Spectrum space types
    const userId = space.user?.id || space.id || 'unknown';
    
    if (message.content?.type === 'text' && message.content.text) {
      await handleMessage(space, userId, message.content.text);
    }
  }
} else if (isInteractive) {
  // CLI mode for demo/testing without Spectrum credentials (only in interactive TTY)
  log.info('Moni Trading Agent (CLI Demo Mode)', { demoMode: DEMO_MODE, baseRpc: BASE_RPC_URL });
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
  
  // Handle CLI shutdown
  rl.on('close', () => {
    shutdown('CLI close');
  });
} else {
  // Production mode without Spectrum credentials - keep health server running
  log.info('Moni Trading Agent (Background Mode)', { demoMode: DEMO_MODE, baseRpc: BASE_RPC_URL });
  
  // Start session cleanup
  cleanupInterval = startSessionCleanup();

  // Keep process alive for health checks
  await new Promise(() => {}); // Never resolves - keeps process running
}
