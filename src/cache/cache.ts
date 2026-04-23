import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { dirname } from 'path';

interface CacheEntry {
  data: string;
  timestamp: number;
  ttl: number;
}

interface CacheStore {
  [key: string]: CacheEntry;
}

export class Cache {
  private store: CacheStore = {};
  private filePath: string;
  private initialized = false;

  constructor(filePath: string) {
    // Change extension from .db to .json
    this.filePath = filePath.replace(/\.db$/, '.json');
  }

  initialize(): void {
    const dir = dirname(this.filePath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    // Load existing cache if it exists
    if (existsSync(this.filePath)) {
      try {
        const data = readFileSync(this.filePath, 'utf-8');
        this.store = JSON.parse(data);
      } catch {
        // If file is corrupted, start fresh
        this.store = {};
      }
    }

    this.initialized = true;

    // Clean up expired entries on startup
    this.cleanup();
  }

  close(): void {
    // Save before closing
    if (this.initialized) {
      this.save();
    }
    this.initialized = false;
  }

  private ensureInitialized(): void {
    if (!this.initialized) {
      throw new Error('Cache not initialized. Call initialize() first.');
    }
  }

  private save(): void {
    try {
      writeFileSync(this.filePath, JSON.stringify(this.store, null, 2));
    } catch (error) {
      console.error('Failed to save cache:', error);
    }
  }

  get<T>(key: string): T | null {
    this.ensureInitialized();

    const entry = this.store[key];
    if (!entry) {
      return null;
    }

    // Check if expired
    if (entry.timestamp + entry.ttl * 1000 < Date.now()) {
      this.delete(key);
      return null;
    }

    try {
      return JSON.parse(entry.data) as T;
    } catch {
      this.delete(key);
      return null;
    }
  }

  set<T>(key: string, data: T, ttl?: number): void {
    this.ensureInitialized();

    this.store[key] = {
      data: JSON.stringify(data),
      timestamp: Date.now(),
      ttl: ttl || 3600
    };

    this.save();
  }

  delete(key: string): void {
    this.ensureInitialized();

    delete this.store[key];
    this.save();
  }

  clear(): void {
    this.ensureInitialized();

    this.store = {};
    this.save();
  }

  clearByPrefix(prefix: string): number {
    this.ensureInitialized();

    let cleared = 0;
    for (const key of Object.keys(this.store)) {
      if (key.startsWith(`${prefix}:`)) {
        delete this.store[key];
        cleared++;
      }
    }

    if (cleared > 0) {
      this.save();
    }

    return cleared;
  }

  cleanup(): void {
    this.ensureInitialized();

    const now = Date.now();
    let changed = false;

    for (const key of Object.keys(this.store)) {
      const entry = this.store[key];
      if (entry.timestamp + entry.ttl * 1000 < now) {
        delete this.store[key];
        changed = true;
      }
    }

    if (changed) {
      this.save();
    }
  }

  generateKey(prefix: string, params: Record<string, unknown>): string {
    const sortedParams = Object.keys(params)
      .sort()
      .reduce((acc, key) => {
        acc[key] = params[key];
        return acc;
      }, {} as Record<string, unknown>);

    return `${prefix}:${JSON.stringify(sortedParams)}`;
  }
}

// Cache TTL constants (in seconds)
export const CACHE_TTL = {
  SITES: 300,            // 5 minutes
  SEARCH_ANALYTICS: 300, // 5 minutes (reduced from 1 hour for fresher data)
  URL_INSPECTION: 86400, // 24 hours (crawl data changes infrequently)
  SITEMAPS: 900          // 15 minutes
};
