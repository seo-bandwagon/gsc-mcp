import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  formatDate,
  parseDate,
  getDateRange,
  getDaysAgo,
  isValidDateRange,
  getComparisonPeriods
} from '../../../src/utils/date.js';

describe('date utilities', () => {
  beforeEach(() => {
    // Fix the date to 2025-01-15 12:00:00 UTC for consistent tests
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-01-15T12:00:00Z'));
  });

  describe('formatDate', () => {
    it('formats date as YYYY-MM-DD', () => {
      const date = new Date('2025-01-15T12:00:00Z');
      expect(formatDate(date)).toBe('2025-01-15');
    });

    it('handles single-digit months and days', () => {
      const date = new Date('2025-05-05T00:00:00Z');
      expect(formatDate(date)).toBe('2025-05-05');
    });

    it('handles end of year', () => {
      const date = new Date('2024-12-31T23:59:59Z');
      expect(formatDate(date)).toBe('2024-12-31');
    });
  });

  describe('parseDate', () => {
    it('parses YYYY-MM-DD string to Date', () => {
      const result = parseDate('2025-01-15');
      expect(result.getFullYear()).toBe(2025);
      expect(result.getMonth()).toBe(0); // January is 0
      expect(result.getDate()).toBe(15);
    });

    it('handles single-digit months and days', () => {
      const result = parseDate('2025-05-05');
      expect(result.getFullYear()).toBe(2025);
      expect(result.getMonth()).toBe(4); // May is 4
      expect(result.getDate()).toBe(5);
    });
  });

  describe('getDateRange', () => {
    it('returns correct range for 7 days', () => {
      const { startDate, endDate } = getDateRange(7);
      // End date should be yesterday (2025-01-14)
      expect(endDate).toBe('2025-01-14');
      // Start date should be 7 days before end date inclusive
      expect(startDate).toBe('2025-01-08');
    });

    it('returns correct range for 28 days', () => {
      const { startDate, endDate } = getDateRange(28);
      expect(endDate).toBe('2025-01-14');
      expect(startDate).toBe('2024-12-18');
    });

    it('returns correct range for 90 days', () => {
      const { startDate, endDate } = getDateRange(90);
      expect(endDate).toBe('2025-01-14');
      expect(startDate).toBe('2024-10-17');
    });

    it('handles 1 day range', () => {
      const { startDate, endDate } = getDateRange(1);
      expect(endDate).toBe('2025-01-14');
      expect(startDate).toBe('2025-01-14');
    });
  });

  describe('getDaysAgo', () => {
    it('returns date string for N days ago', () => {
      expect(getDaysAgo(0)).toBe('2025-01-15');
      expect(getDaysAgo(1)).toBe('2025-01-14');
      expect(getDaysAgo(7)).toBe('2025-01-08');
    });

    it('handles month boundaries', () => {
      expect(getDaysAgo(15)).toBe('2024-12-31');
    });
  });

  describe('isValidDateRange', () => {
    it('returns true for valid date range', () => {
      expect(isValidDateRange('2025-01-01', '2025-01-10')).toBe(true);
    });

    it('returns true when start equals end', () => {
      expect(isValidDateRange('2025-01-10', '2025-01-10')).toBe(true);
    });

    it('returns false when end date is before start date', () => {
      expect(isValidDateRange('2025-01-15', '2025-01-10')).toBe(false);
    });

    it('returns false for dates older than 16 months', () => {
      // 16 months ago from 2025-01-15 would be around September 2023
      expect(isValidDateRange('2023-01-01', '2023-01-31')).toBe(false);
    });

    it('returns false for future dates', () => {
      expect(isValidDateRange('2025-01-01', '2025-02-01')).toBe(false);
    });

    it('returns false for invalid date formats', () => {
      expect(isValidDateRange('invalid', '2025-01-10')).toBe(false);
      expect(isValidDateRange('2025-01-01', 'invalid')).toBe(false);
    });

    it('accepts dates within the 16-month window', () => {
      // 15 months ago should be valid
      expect(isValidDateRange('2023-10-15', '2023-10-20')).toBe(true);
    });
  });

  describe('getComparisonPeriods', () => {
    it('returns correct periods for 7d comparison', () => {
      const result = getComparisonPeriods('7d');

      // Current period: last 7 days ending yesterday
      expect(result.current.end).toBe('2025-01-14');
      expect(result.current.start).toBe('2025-01-08');

      // Previous period: 7 days before current period
      expect(result.previous.end).toBe('2025-01-07');
      expect(result.previous.start).toBe('2025-01-01');
    });

    it('returns correct periods for 28d comparison', () => {
      const result = getComparisonPeriods('28d');

      expect(result.current.end).toBe('2025-01-14');
      expect(result.current.start).toBe('2024-12-18');

      expect(result.previous.end).toBe('2024-12-17');
      expect(result.previous.start).toBe('2024-11-20');
    });

    it('returns correct periods for 90d comparison', () => {
      const result = getComparisonPeriods('90d');

      expect(result.current.end).toBe('2025-01-14');
      expect(result.current.start).toBe('2024-10-17');

      expect(result.previous.end).toBe('2024-10-16');
      expect(result.previous.start).toBe('2024-07-19');
    });

    it('periods do not overlap', () => {
      const periods = ['7d', '28d', '90d'] as const;

      for (const period of periods) {
        const result = getComparisonPeriods(period);
        const currentStart = new Date(result.current.start);
        const previousEnd = new Date(result.previous.end);

        // Previous end should be before current start
        expect(previousEnd < currentStart).toBe(true);
      }
    });
  });
});
