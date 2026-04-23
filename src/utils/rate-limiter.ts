interface RateLimitConfig {
  maxRequests: number;
  windowMs: number;
}

interface RequestRecord {
  timestamps: number[];
}

// Google API rate limits
const RATE_LIMITS: Record<string, RateLimitConfig> = {
  'searchAnalytics': {
    maxRequests: 200,
    windowMs: 60 * 1000 // 200 per minute
  },
  'urlInspection': {
    maxRequests: 600,
    windowMs: 24 * 60 * 60 * 1000 // 600 per day (default, large sites get 2000)
  },
  'sitemaps': {
    maxRequests: 100,
    windowMs: 60 * 1000 // 100 per minute
  },
  'sites': {
    maxRequests: 100,
    windowMs: 60 * 1000 // 100 per minute
  },
  'default': {
    maxRequests: 100,
    windowMs: 60 * 1000
  }
};

export class RateLimiter {
  private requests: Map<string, RequestRecord> = new Map();

  async acquire(endpoint: string): Promise<void> {
    const category = this.getCategory(endpoint);
    const config = RATE_LIMITS[category] || RATE_LIMITS['default'];

    const record = this.requests.get(category) || { timestamps: [] };
    const now = Date.now();

    // Remove expired timestamps
    record.timestamps = record.timestamps.filter(
      (ts) => ts > now - config.windowMs
    );

    // Check if we're at the limit
    if (record.timestamps.length >= config.maxRequests) {
      const oldestTimestamp = record.timestamps[0];
      const waitTime = oldestTimestamp + config.windowMs - now;

      if (waitTime > 0) {
        await this.sleep(waitTime);
        return this.acquire(endpoint); // Retry after waiting
      }
    }

    // Record this request
    record.timestamps.push(now);
    this.requests.set(category, record);
  }

  private getCategory(endpoint: string): string {
    if (endpoint.includes('searchAnalytics')) return 'searchAnalytics';
    if (endpoint.includes('urlInspection')) return 'urlInspection';
    if (endpoint.includes('sitemap')) return 'sitemaps';
    if (endpoint.includes('site')) return 'sites';
    return 'default';
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  getRemainingRequests(endpoint: string): number {
    const category = this.getCategory(endpoint);
    const config = RATE_LIMITS[category] || RATE_LIMITS['default'];
    const record = this.requests.get(category);

    if (!record) {
      return config.maxRequests;
    }

    const now = Date.now();
    const validTimestamps = record.timestamps.filter(
      (ts) => ts > now - config.windowMs
    );

    return Math.max(0, config.maxRequests - validTimestamps.length);
  }

  getResetTime(endpoint: string): number | null {
    const category = this.getCategory(endpoint);
    const config = RATE_LIMITS[category] || RATE_LIMITS['default'];
    const record = this.requests.get(category);

    if (!record || record.timestamps.length === 0) {
      return null;
    }

    const oldestTimestamp = Math.min(...record.timestamps);
    return oldestTimestamp + config.windowMs;
  }
}
