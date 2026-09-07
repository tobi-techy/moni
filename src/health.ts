import { createServer, IncomingMessage, ServerResponse } from 'http';
import { createPublicClient, http } from 'viem';
import { base, baseSepolia } from 'viem/chains';
import { DEMO_MODE, BASE_RPC_URL } from './env.js';

const PORT = parseInt(process.env.PORT || '3000', 10);
const RPC_TIMEOUT_MS = 3000;

interface HealthStatus {
  status: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: string;
  version: string;
  demoMode: boolean;
  uptime: number;
  checks: {
    env: boolean;
    rpc: boolean;
  };
}

let startTime = Date.now();

function getPublicClient() {
  const chain = BASE_RPC_URL.includes('sepolia') ? baseSepolia : base;
  return createPublicClient({
    chain,
    transport: http(BASE_RPC_URL, { timeout: RPC_TIMEOUT_MS }),
  });
}

async function checkRpcHealth(): Promise<boolean> {
  try {
    const client = getPublicClient();
    // Lightweight RPC call to verify connectivity
    await client.getBlockNumber();
    return true;
  } catch {
    return false;
  }
}

async function getHealthStatus(): Promise<HealthStatus> {
  const rpcHealthy = await checkRpcHealth();
  
  return {
    status: rpcHealthy ? 'healthy' : 'degraded',
    timestamp: new Date().toISOString(),
    version: process.env.npm_package_version || '1.0.0',
    demoMode: DEMO_MODE === 'true',
    uptime: Date.now() - startTime,
    checks: {
      env: true, // Basic env validation passed at startup
      rpc: rpcHealthy,
    },
  };
}

function requestListener(req: IncomingMessage, res: ServerResponse) {
  // CORS headers for health checks
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = req.url || '/';

  if (url === '/health' || url === '/') {
    getHealthStatus().then(status => {
      const statusCode = status.status === 'healthy' ? 200 : 503;
      res.writeHead(statusCode, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(status, null, 2));
    }).catch(err => {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'unhealthy', error: err.message }));
    });
    return;
  }

  // 404 for other routes
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not found' }));
}

export function startHealthServer(): Promise<void> {
  return new Promise((resolve, reject) => {
    const server = createServer(requestListener);
    
    server.on('error', (err) => {
      if ((err as NodeJS.ErrnoException).code === 'EADDRINUSE') {
        console.warn(`⚠️  Port ${PORT} in use, health server not started`);
        resolve(); // Don't fail startup if port is busy
      } else {
        reject(err);
      }
    });
    
    server.listen(PORT, () => {
      console.log(`🏥 Health server listening on port ${PORT} (GET /health)`);
      resolve();
    });
  });
}

// For testing
export { getHealthStatus };
