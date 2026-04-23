import { describe, it, expect, beforeEach, vi } from 'vitest';
import { RateLimiter } from '../../../src/utils/rate-limiter.js';

describe('RateLimiter', () => {
  let limiter: RateLimiter;

  beforeEach(() => {
    limiter = new RateLimiter();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-01-15T12:00:00Z'));
  });

  describe('acquire', () => {
    it('allows requests under the limit', async () => {
      await expect(limiter.acquire('searchAnalytics.query')).resolves.toBeUndefined();
    });

    it('allows multiple requests up to the limit', async () => {
      // searchAnalytics has 200 requests per minute limit
      for (let i = 0; i < 10; i++) {
        await limiter.acquire('searchAnalytics.query');
      }

      expect(limiter.getRemainingRequests('searchAnalytics')).toBe(190);
    });

    it('categorizes searchAnalytics endpoints correctly', async () => {
      await limiter.acquire('searchAnalytics.query');
      await limiter.acquire('searchAnalytics.compare');

      expect(limiter.getRemainingRequests('searchAnalytics')).toBe(198);
    });

    it('categorizes urlInspection endpoints correctly', async () => {
      await limiter.acquire('urlInspection.inspect');

      expect(limiter.getRemainingRequests('urlInspection')).toBe(599);
    });

    it('categorizes sitemap endpoints correctly', async () => {
      await limiter.acquire('sitemaps.list');
      await limiter.acquire('sitemap.submit');

      expect(limiter.getRemainingRequests('sitemaps')).toBe(98);
    });

    it('categorizes site endpoints correctly', async () => {
      await limiter.acquire('sites.list');

      expect(limiter.getRemainingRequests('sites')).toBe(99);
    });

    it('uses default category for unknown endpoints', async () => {
      await limiter.acquire('unknown.endpoint');

      expect(limiter.getRemainingRequests('unknown')).toBe(99);
    });

    it('waits when rate limit is exceeded', async () => {
      // Fill up the searchAnalytics limit (200 requests)
      for (let i = 0; i < 200; i++) {
        await limiter.acquire('searchAnalytics.query');
      }

      expect(limiter.getRemainingRequests('searchAnalytics')).toBe(0);

      // Start the acquire call that should wait
      const acquirePromise = limiter.acquire('searchAnalytics.query');

      // Advance time past the window (60 seconds)
      await vi.advanceTimersByTimeAsync(61000);

      // Should resolve after waiting
      await expect(acquirePromise).resolves.toBeUndefined();
    });

    it('removes expired timestamps from the window', async () => {
      // Make 10 requests
      for (let i = 0; i < 10; i++) {
        await limiter.acquire('searchAnalytics.query');
      }

      expect(limiter.getRemainingRequests('searchAnalytics')).toBe(190);

      // Advance time past the window
      vi.advanceTimersByTime(61000);

      // Remaining should be back to max after window expires
      expect(limiter.getRemainingRequests('searchAnalytics')).toBe(200);
    });
  });

  describe('getRemainingRequests', () => {
    it('returns max requests when no requests made', () => {
      expect(limiter.getRemainingRequests('searchAnalytics')).toBe(200);
      expect(limiter.getRemainingRequests('urlInspection')).toBe(600);
      expect(limiter.getRemainingRequests('sitemaps')).toBe(100);
    });

    it('returns correct count after requests', async () => {
      await limiter.acquire('searchAnalytics.query');
      await limiter.acquire('searchAnalytics.query');
      await limiter.acquire('searchAnalytics.query');

      expect(limiter.getRemainingRequests('searchAnalytics')).toBe(197);
    });

    it('never returns negative values', async () => {
      // This shouldn't happen in practice, but test the Math.max protection
      for (let i = 0; i < 200; i++) {
        await limiter.acquire('searchAnalytics.query');
      }

      expect(limiter.getRemainingRequests('searchAnalytics')).toBe(0);
    });

    it('uses default config for unknown endpoints', () => {
      expect(limiter.getRemainingRequests('totally-unknown')).toBe(100);
    });
  });

  describe('getResetTime', () => {
    it('returns null when no requests made', () => {
      expect(limiter.getResetTime('searchAnalytics')).toBeNull();
    });

    it('returns reset time after requests', async () => {
      const startTime = Date.now();
      await limiter.acquire('searchAnalytics.query');

      const resetTime = limiter.getResetTime('searchAnalytics');

      expect(resetTime).not.toBeNull();
      // Reset time should be start time + window (60 seconds for searchAnalytics)
      expect(resetTime).toBe(startTime + 60000);
    });

    it('returns correct reset time for different categories', async () => {
      const startTime = Date.now();

      await limiter.acquire('searchAnalytics.query');
      await limiter.acquire('urlInspection.inspect');

      // searchAnalytics: 60 second window
      expect(limiter.getResetTime('searchAnalytics')).toBe(startTime + 60000);

      // urlInspection: 24 hour window
      expect(limiter.getResetTime('urlInspection')).toBe(startTime + 24 * 60 * 60 * 1000);
    });

    it('returns reset time based on oldest timestamp', async () => {
      const startTime = Date.now();

      await limiter.acquire('searchAnalytics.query');
      vi.advanceTimersByTime(1000);
      await limiter.acquire('searchAnalytics.query');
      vi.advanceTimersByTime(1000);
      await limiter.acquire('searchAnalytics.query');

      // Reset time should still be based on the oldest request
      expect(limiter.getResetTime('searchAnalytics')).toBe(startTime + 60000);
    });
  });

  describe('rate limit configurations', () => {
    it('has correct searchAnalytics limits', async () => {
      // 200 requests per minute
      for (let i = 0; i < 200; i++) {
        await limiter.acquire('searchAnalytics.query');
      }
      expect(limiter.getRemainingRequests('searchAnalytics')).toBe(0);
    });

    it('has correct urlInspection limits', async () => {
      // 600 requests per day
      for (let i = 0; i < 100; i++) {
        await limiter.acquire('urlInspection.inspect');
      }
      expect(limiter.getRemainingRequests('urlInspection')).toBe(500);
    });

    it('has correct sitemaps limits', async () => {
      // 100 requests per minute
      for (let i = 0; i < 50; i++) {
        await limiter.acquire('sitemaps.list');
      }
      expect(limiter.getRemainingRequests('sitemaps')).toBe(50);
    });

    it('has correct sites limits', async () => {
      // 100 requests per minute
      for (let i = 0; i < 25; i++) {
        await limiter.acquire('sites.list');
      }
      expect(limiter.getRemainingRequests('sites')).toBe(75);
    });
  });

  describe('concurrent requests', () => {
    it('handles multiple concurrent acquires', async () => {
      const promises = [];
      for (let i = 0; i < 50; i++) {
        promises.push(limiter.acquire('searchAnalytics.query'));
      }

      await Promise.all(promises);

      expect(limiter.getRemainingRequests('searchAnalytics')).toBe(150);
    });
  });
});
