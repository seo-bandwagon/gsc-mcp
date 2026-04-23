import { vol } from 'memfs';
import { vi } from 'vitest';

// Setup memfs for in-memory file operations
export function setupFilesystemMock(initialFiles: Record<string, string> = {}) {
  vol.reset();
  vol.fromJSON(initialFiles, '/');
  return vol;
}

// Create mock token file content
export function createMockTokenFileContent(expiryDate?: number) {
  return JSON.stringify({
    access_token: 'test-access-token',
    refresh_token: 'test-refresh-token',
    scope: 'https://www.googleapis.com/auth/webmasters',
    token_type: 'Bearer',
    expiry_date: expiryDate ?? Date.now() + 3600000
  });
}

// Create mock cache file content
export function createMockCacheFileContent(entries: Record<string, { data: unknown; ttl: number }> = {}) {
  const store: Record<string, { data: string; timestamp: number; ttl: number }> = {};

  for (const [key, value] of Object.entries(entries)) {
    store[key] = {
      data: JSON.stringify(value.data),
      timestamp: Date.now(),
      ttl: value.ttl
    };
  }

  return JSON.stringify(store, null, 2);
}

// Create initial files for common test scenarios
export function createTestFilesystem(options: {
  withTokens?: boolean;
  withCache?: boolean;
  tokenExpiryDate?: number;
  cacheEntries?: Record<string, { data: unknown; ttl: number }>;
} = {}) {
  const files: Record<string, string> = {};

  if (options.withTokens) {
    files['/tmp/gsc-test/tokens.json'] = createMockTokenFileContent(options.tokenExpiryDate);
  }

  if (options.withCache) {
    files['/tmp/gsc-test/cache.json'] = createMockCacheFileContent(options.cacheEntries);
  }

  return setupFilesystemMock(files);
}

// Mock fs module with memfs
export function mockFsWithMemfs() {
  vi.mock('fs', async () => {
    const memfs = await import('memfs');
    return memfs.fs;
  });
}
