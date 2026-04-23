import type { GSCConfig } from '../../src/types/index.js';

export function createTestConfig(overrides: Partial<GSCConfig> = {}): GSCConfig {
  return {
    clientId: 'test-client-id',
    clientSecret: 'test-client-secret',
    redirectUri: 'http://localhost:3000/callback',
    tokenPath: '/tmp/gsc-test/tokens.json',
    cachePath: '/tmp/gsc-test/cache.json',
    cacheTtl: 300,
    logLevel: 'error',
    ...overrides
  };
}
