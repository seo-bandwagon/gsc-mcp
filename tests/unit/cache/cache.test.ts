import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { vol } from 'memfs';
import { Cache, CACHE_TTL } from '../../../src/cache/cache.js';

// Mock the fs module with memfs
vi.mock('fs', async () => {
  const memfs = await import('memfs');
  return memfs.fs;
});

describe('Cache', () => {
  let cache: Cache;
  const testCachePath = '/tmp/gsc-test/cache.json';

  beforeEach(() => {
    vol.reset();
    vol.mkdirSync('/tmp/gsc-test', { recursive: true });
    cache = new Cache(testCachePath);
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-01-15T12:00:00Z'));
  });

  afterEach(() => {
    if (cache) {
      try {
        cache.close();
      } catch {
        // Ignore errors on close
      }
    }
    vi.useRealTimers();
  });

  describe('initialize', () => {
    it('creates directory if it does not exist', () => {
      vol.reset();
      const newCache = new Cache('/new/path/cache.json');
      newCache.initialize();

      expect(vol.existsSync('/new/path')).toBe(true);
    });

    it('loads existing cache file', () => {
      const existingData = {
        'test-key': {
          data: '"test-value"',
          timestamp: Date.now(),
          ttl: 3600
        }
      };
      vol.writeFileSync(testCachePath, JSON.stringify(existingData));

      cache.initialize();

      expect(cache.get('test-key')).toBe('test-value');
    });

    it('handles corrupted cache file gracefully', () => {
      vol.writeFileSync(testCachePath, 'not valid json');

      expect(() => cache.initialize()).not.toThrow();
      expect(cache.get('any-key')).toBeNull();
    });

    it('starts with empty store if file does not exist', () => {
      cache.initialize();
      expect(cache.get('any-key')).toBeNull();
    });

    it('replaces .db extension with .json', () => {
      const dbCache = new Cache('/tmp/gsc-test/cache.db');
      dbCache.initialize();
      dbCache.set('test', 'value');
      dbCache.close();

      expect(vol.existsSync('/tmp/gsc-test/cache.json')).toBe(true);
    });
  });

  describe('get and set', () => {
    beforeEach(() => {
      cache.initialize();
    });

    it('stores and retrieves string data', () => {
      cache.set('key1', 'value1');
      expect(cache.get('key1')).toBe('value1');
    });

    it('stores and retrieves object data', () => {
      const obj = { foo: 'bar', num: 42 };
      cache.set('key2', obj);
      expect(cache.get('key2')).toEqual(obj);
    });

    it('stores and retrieves array data', () => {
      const arr = [1, 2, 3, 'test'];
      cache.set('key3', arr);
      expect(cache.get('key3')).toEqual(arr);
    });

    it('returns null for non-existent keys', () => {
      expect(cache.get('non-existent')).toBeNull();
    });

    it('returns null for expired entries', () => {
      cache.set('expiring', 'value', 60); // 60 second TTL

      // Advance past TTL
      vi.advanceTimersByTime(61000);

      expect(cache.get('expiring')).toBeNull();
    });

    it('returns data within TTL window', () => {
      cache.set('valid', 'value', 60);

      // Advance but stay within TTL
      vi.advanceTimersByTime(30000);

      expect(cache.get('valid')).toBe('value');
    });

    it('uses default TTL when not specified', () => {
      cache.set('default-ttl', 'value');

      // Default TTL is 3600 seconds (1 hour)
      vi.advanceTimersByTime(3599000);
      expect(cache.get('default-ttl')).toBe('value');

      vi.advanceTimersByTime(2000);
      expect(cache.get('default-ttl')).toBeNull();
    });

    it('overwrites existing entries', () => {
      cache.set('key', 'value1');
      cache.set('key', 'value2');

      expect(cache.get('key')).toBe('value2');
    });
  });

  describe('delete', () => {
    beforeEach(() => {
      cache.initialize();
    });

    it('removes specific keys', () => {
      cache.set('key1', 'value1');
      cache.set('key2', 'value2');

      cache.delete('key1');

      expect(cache.get('key1')).toBeNull();
      expect(cache.get('key2')).toBe('value2');
    });

    it('handles deleting non-existent keys', () => {
      expect(() => cache.delete('non-existent')).not.toThrow();
    });
  });

  describe('clear', () => {
    beforeEach(() => {
      cache.initialize();
    });

    it('removes all entries', () => {
      cache.set('key1', 'value1');
      cache.set('key2', 'value2');
      cache.set('key3', 'value3');

      cache.clear();

      expect(cache.get('key1')).toBeNull();
      expect(cache.get('key2')).toBeNull();
      expect(cache.get('key3')).toBeNull();
    });
  });

  describe('clearByPrefix', () => {
    beforeEach(() => {
      cache.initialize();
    });

    it('removes entries matching prefix', () => {
      cache.set('sites:example.com', 'data1');
      cache.set('sites:test.com', 'data2');
      cache.set('analytics:query1', 'data3');

      const cleared = cache.clearByPrefix('sites');

      expect(cleared).toBe(2);
      expect(cache.get('sites:example.com')).toBeNull();
      expect(cache.get('sites:test.com')).toBeNull();
      expect(cache.get('analytics:query1')).toBe('data3');
    });

    it('returns 0 when no entries match', () => {
      cache.set('key1', 'value1');

      const cleared = cache.clearByPrefix('nonexistent');

      expect(cleared).toBe(0);
    });

    it('requires colon after prefix', () => {
      cache.set('sitesData', 'value1');
      cache.set('sites:data', 'value2');

      const cleared = cache.clearByPrefix('sites');

      expect(cleared).toBe(1);
      expect(cache.get('sitesData')).toBe('value1');
    });
  });

  describe('cleanup', () => {
    beforeEach(() => {
      cache.initialize();
    });

    it('removes expired entries', () => {
      cache.set('expires-soon', 'value1', 30);
      cache.set('expires-later', 'value2', 120);

      // Advance 60 seconds
      vi.advanceTimersByTime(60000);

      cache.cleanup();

      expect(cache.get('expires-soon')).toBeNull();
      expect(cache.get('expires-later')).toBe('value2');
    });

    it('does nothing when no entries are expired', () => {
      cache.set('key1', 'value1', 3600);
      cache.set('key2', 'value2', 3600);

      cache.cleanup();

      expect(cache.get('key1')).toBe('value1');
      expect(cache.get('key2')).toBe('value2');
    });
  });

  describe('generateKey', () => {
    beforeEach(() => {
      cache.initialize();
    });

    it('creates deterministic key from params', () => {
      const key1 = cache.generateKey('analytics', { site: 'example.com', days: 7 });
      const key2 = cache.generateKey('analytics', { site: 'example.com', days: 7 });

      expect(key1).toBe(key2);
    });

    it('sorts params for consistency', () => {
      const key1 = cache.generateKey('analytics', { a: 1, b: 2, c: 3 });
      const key2 = cache.generateKey('analytics', { c: 3, a: 1, b: 2 });

      expect(key1).toBe(key2);
    });

    it('creates different keys for different prefixes', () => {
      const key1 = cache.generateKey('analytics', { site: 'example.com' });
      const key2 = cache.generateKey('sites', { site: 'example.com' });

      expect(key1).not.toBe(key2);
    });

    it('creates different keys for different params', () => {
      const key1 = cache.generateKey('analytics', { site: 'example.com' });
      const key2 = cache.generateKey('analytics', { site: 'test.com' });

      expect(key1).not.toBe(key2);
    });

    it('includes prefix with colon separator', () => {
      const key = cache.generateKey('analytics', { site: 'example.com' });

      expect(key.startsWith('analytics:')).toBe(true);
    });
  });

  describe('close', () => {
    it('saves cache before closing', () => {
      cache.initialize();
      cache.set('key', 'value');
      cache.close();

      // Re-open and verify data persisted
      const newCache = new Cache(testCachePath);
      newCache.initialize();

      expect(newCache.get('key')).toBe('value');
      newCache.close();
    });
  });

  describe('persistence', () => {
    it('persists data across cache instances', () => {
      cache.initialize();
      cache.set('persistent-key', { data: 'test' });
      cache.close();

      const newCache = new Cache(testCachePath);
      newCache.initialize();

      expect(newCache.get('persistent-key')).toEqual({ data: 'test' });
      newCache.close();
    });

    it('saves on every set operation', () => {
      cache.initialize();
      cache.set('key1', 'value1');

      // Read file directly
      const fileContent = vol.readFileSync(testCachePath, 'utf-8') as string;
      const parsed = JSON.parse(fileContent);

      expect(parsed['key1']).toBeDefined();
    });
  });

  describe('error handling', () => {
    it('throws when not initialized', () => {
      const uninitCache = new Cache('/tmp/test.json');

      expect(() => uninitCache.get('key')).toThrow('Cache not initialized');
      expect(() => uninitCache.set('key', 'value')).toThrow('Cache not initialized');
      expect(() => uninitCache.delete('key')).toThrow('Cache not initialized');
      expect(() => uninitCache.clear()).toThrow('Cache not initialized');
    });
  });

  describe('CACHE_TTL constants', () => {
    it('has correct TTL values', () => {
      expect(CACHE_TTL.SITES).toBe(300);
      expect(CACHE_TTL.SEARCH_ANALYTICS).toBe(300);
      expect(CACHE_TTL.URL_INSPECTION).toBe(86400);
      expect(CACHE_TTL.SITEMAPS).toBe(900);
    });
  });
});
