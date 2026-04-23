import { homedir } from 'os';
import { join } from 'path';
import type { GSCConfig } from '../types/index.js';

export function getConfig(): GSCConfig {
  const home = homedir();

  return {
    clientId: process.env.GSC_CLIENT_ID || '',
    clientSecret: process.env.GSC_CLIENT_SECRET || '',
    redirectUri: process.env.GSC_REDIRECT_URI || 'http://localhost:3000/callback',
    tokenPath: process.env.GSC_TOKEN_PATH || join(home, '.gsc-mcp', 'tokens.json'),
    cachePath: process.env.GSC_CACHE_PATH || join(home, '.gsc-mcp', 'cache.db'),
    cacheTtl: parseInt(process.env.GSC_CACHE_TTL || '3600', 10),
    logLevel: (process.env.GSC_LOG_LEVEL as GSCConfig['logLevel']) || 'info'
  };
}

export function validateConfig(config: GSCConfig): void {
  if (!config.clientId) {
    throw new Error('GSC_CLIENT_ID environment variable is required');
  }
  if (!config.clientSecret) {
    throw new Error('GSC_CLIENT_SECRET environment variable is required');
  }
}
