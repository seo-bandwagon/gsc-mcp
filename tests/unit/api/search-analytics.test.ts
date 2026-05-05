import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SearchAnalyticsApi } from '../../../src/api/search-analytics.js';
import { mockSearchAnalyticsRows, mockSearchAnalyticsWithDimensions } from '../../fixtures/api-responses.js';

// Mock the GSCClient
const mockSearchConsole = {
  searchanalytics: {
    query: vi.fn()
  }
};

const mockClient = {
  getSearchConsole: vi.fn(() => mockSearchConsole),
  withRetry: vi.fn(async (operation: () => Promise<unknown>) => operation()),
  getCache: vi.fn(() => ({
    get: vi.fn(),
    set: vi.fn(),
    generateKey: vi.fn()
  }))
};

// Mock SitesApi and resolveSiteUrl. vitest 4 requires a function declaration
// (not arrow) when a mock is constructed with `new` — SitesApi is.
vi.mock('../../../src/api/sites.js', () => ({
  SitesApi: vi.fn(function SitesApi() {
    return {
      listSites: vi.fn().mockResolvedValue({
        sites: [
          { siteUrl: 'sc-domain:example.com', permissionLevel: 'siteOwner' },
          { siteUrl: 'https://example.com/', permissionLevel: 'siteFullUser' }
        ]
      })
    };
  })
}));

vi.mock('../../../src/utils/site-url.js', () => ({
  resolveSiteUrl: vi.fn().mockResolvedValue('sc-domain:example.com')
}));

// Mock logger
vi.mock('../../../src/utils/logger.js', () => ({
  getGlobalLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  })
}));

describe('SearchAnalyticsApi', () => {
  let api: SearchAnalyticsApi;

  beforeEach(() => {
    vi.clearAllMocks();

    mockSearchConsole.searchanalytics.query.mockResolvedValue({
      data: {
        rows: mockSearchAnalyticsRows,
        responseAggregationType: 'auto'
      }
    });

    api = new SearchAnalyticsApi(mockClient as never);
  });

  describe('query', () => {
    it('returns search analytics data', async () => {
      const result = await api.query({
        siteUrl: 'example.com',
        startDate: '2025-01-01',
        endDate: '2025-01-14'
      });

      expect(result.rows).toHaveLength(mockSearchAnalyticsRows.length);
      expect(result.responseAggregationType).toBe('auto');
    });

    it('defaults to web search type', async () => {
      await api.query({
        siteUrl: 'example.com',
        startDate: '2025-01-01',
        endDate: '2025-01-14'
      });

      expect(mockSearchConsole.searchanalytics.query).toHaveBeenCalledWith(
        expect.objectContaining({
          requestBody: expect.objectContaining({
            type: 'web'
          })
        })
      );
    });

    it('passes specified search type', async () => {
      await api.query({
        siteUrl: 'example.com',
        startDate: '2025-01-01',
        endDate: '2025-01-14',
        type: 'image'
      });

      expect(mockSearchConsole.searchanalytics.query).toHaveBeenCalledWith(
        expect.objectContaining({
          requestBody: expect.objectContaining({
            type: 'image'
          })
        })
      );
    });

    it('includes dimensions in request', async () => {
      await api.query({
        siteUrl: 'example.com',
        startDate: '2025-01-01',
        endDate: '2025-01-14',
        dimensions: ['query', 'page']
      });

      expect(mockSearchConsole.searchanalytics.query).toHaveBeenCalledWith(
        expect.objectContaining({
          requestBody: expect.objectContaining({
            dimensions: ['query', 'page']
          })
        })
      );
    });

    it('applies filters correctly', async () => {
      await api.query({
        siteUrl: 'example.com',
        startDate: '2025-01-01',
        endDate: '2025-01-14',
        filters: [
          { dimension: 'query', operator: 'contains', expression: 'test' }
        ]
      });

      expect(mockSearchConsole.searchanalytics.query).toHaveBeenCalledWith(
        expect.objectContaining({
          requestBody: expect.objectContaining({
            dimensionFilterGroups: [
              {
                groupType: 'and',
                filters: [
                  { dimension: 'query', operator: 'contains', expression: 'test' }
                ]
              }
            ]
          })
        })
      );
    });

    it('defaults to 25000 row limit', async () => {
      await api.query({
        siteUrl: 'example.com',
        startDate: '2025-01-01',
        endDate: '2025-01-14'
      });

      expect(mockSearchConsole.searchanalytics.query).toHaveBeenCalledWith(
        expect.objectContaining({
          requestBody: expect.objectContaining({
            rowLimit: 25000
          })
        })
      );
    });

    it('respects custom row limit', async () => {
      await api.query({
        siteUrl: 'example.com',
        startDate: '2025-01-01',
        endDate: '2025-01-14',
        rowLimit: 100
      });

      expect(mockSearchConsole.searchanalytics.query).toHaveBeenCalledWith(
        expect.objectContaining({
          requestBody: expect.objectContaining({
            rowLimit: 100
          })
        })
      );
    });

    it('handles empty results', async () => {
      mockSearchConsole.searchanalytics.query.mockResolvedValueOnce({
        data: {
          rows: [],
          responseAggregationType: 'auto'
        }
      });

      const result = await api.query({
        siteUrl: 'example.com',
        startDate: '2025-01-01',
        endDate: '2025-01-14'
      });

      expect(result.rows).toHaveLength(0);
    });

    it('handles null/undefined row values', async () => {
      mockSearchConsole.searchanalytics.query.mockResolvedValueOnce({
        data: {
          rows: [
            { keys: ['test'], clicks: null, impressions: undefined, ctr: null, position: null }
          ],
          responseAggregationType: 'auto'
        }
      });

      const result = await api.query({
        siteUrl: 'example.com',
        startDate: '2025-01-01',
        endDate: '2025-01-14'
      });

      expect(result.rows[0]).toEqual({
        keys: ['test'],
        clicks: 0,
        impressions: 0,
        ctr: 0,
        position: 0
      });
    });

    it('uses withRetry for API calls', async () => {
      await api.query({
        siteUrl: 'example.com',
        startDate: '2025-01-01',
        endDate: '2025-01-14'
      });

      expect(mockClient.withRetry).toHaveBeenCalledWith(
        expect.any(Function),
        'searchAnalytics.query'
      );
    });
  });

  describe('comparePeriods', () => {
    it('fetches data for both periods', async () => {
      const result = await api.comparePeriods({
        siteUrl: 'example.com',
        period1Start: '2025-01-01',
        period1End: '2025-01-07',
        period2Start: '2025-01-08',
        period2End: '2025-01-14'
      });

      expect(result.period1).toBeDefined();
      expect(result.period2).toBeDefined();
      expect(result.changes).toBeDefined();
    });

    it('calculates changes correctly', async () => {
      // Period 1: 185 clicks, Period 2: same data
      const result = await api.comparePeriods({
        siteUrl: 'example.com',
        period1Start: '2025-01-01',
        period1End: '2025-01-07',
        period2Start: '2025-01-08',
        period2End: '2025-01-14'
      });

      // Same data in both periods should result in 0% change
      expect(result.changes.clicks.percentage).toBe(0);
    });

    it('includes row-level comparison when dimensions specified', async () => {
      mockSearchConsole.searchanalytics.query.mockResolvedValue({
        data: {
          rows: mockSearchAnalyticsWithDimensions,
          responseAggregationType: 'byPage'
        }
      });

      const result = await api.comparePeriods({
        siteUrl: 'example.com',
        period1Start: '2025-01-01',
        period1End: '2025-01-07',
        period2Start: '2025-01-08',
        period2End: '2025-01-14',
        dimensions: ['query', 'page']
      });

      expect(result.rows).toBeDefined();
      expect(result.rows!.length).toBeGreaterThan(0);
    });
  });

  describe('topQueries', () => {
    it('returns queries sorted by specified metric', async () => {
      const result = await api.topQueries({
        siteUrl: 'example.com',
        startDate: '2025-01-01',
        endDate: '2025-01-14',
        limit: 10,
        metric: 'clicks'
      });

      expect(result.rows.length).toBeLessThanOrEqual(10);
      // Verify sorted by clicks descending
      for (let i = 0; i < result.rows.length - 1; i++) {
        expect(result.rows[i].clicks).toBeGreaterThanOrEqual(result.rows[i + 1].clicks);
      }
    });

    it('requests query dimension', async () => {
      await api.topQueries({
        siteUrl: 'example.com',
        startDate: '2025-01-01',
        endDate: '2025-01-14',
        limit: 10,
        metric: 'clicks'
      });

      expect(mockSearchConsole.searchanalytics.query).toHaveBeenCalledWith(
        expect.objectContaining({
          requestBody: expect.objectContaining({
            dimensions: ['query']
          })
        })
      );
    });

    it('sorts by impressions when specified', async () => {
      const result = await api.topQueries({
        siteUrl: 'example.com',
        startDate: '2025-01-01',
        endDate: '2025-01-14',
        limit: 10,
        metric: 'impressions'
      });

      for (let i = 0; i < result.rows.length - 1; i++) {
        expect(result.rows[i].impressions).toBeGreaterThanOrEqual(result.rows[i + 1].impressions);
      }
    });

    it('sorts by position when specified (ascending)', async () => {
      const result = await api.topQueries({
        siteUrl: 'example.com',
        startDate: '2025-01-01',
        endDate: '2025-01-14',
        limit: 10,
        metric: 'position'
      });

      // Position should be sorted ascending (lower is better)
      for (let i = 0; i < result.rows.length - 1; i++) {
        expect(result.rows[i].position).toBeLessThanOrEqual(result.rows[i + 1].position);
      }
    });
  });

  describe('topPages', () => {
    it('returns pages sorted by specified metric', async () => {
      const result = await api.topPages({
        siteUrl: 'example.com',
        startDate: '2025-01-01',
        endDate: '2025-01-14',
        limit: 10,
        metric: 'clicks'
      });

      expect(result.rows.length).toBeLessThanOrEqual(10);
    });

    it('requests page dimension', async () => {
      await api.topPages({
        siteUrl: 'example.com',
        startDate: '2025-01-01',
        endDate: '2025-01-14',
        limit: 10,
        metric: 'clicks'
      });

      expect(mockSearchConsole.searchanalytics.query).toHaveBeenCalledWith(
        expect.objectContaining({
          requestBody: expect.objectContaining({
            dimensions: ['page']
          })
        })
      );
    });

    it('includes query breakdown when requested', async () => {
      // Mock for both the main page query and the breakdown queries
      mockSearchConsole.searchanalytics.query.mockResolvedValue({
        data: {
          rows: [{ keys: ['https://example.com/page1'], clicks: 100, impressions: 1000, ctr: 0.1, position: 5 }],
          responseAggregationType: 'auto'
        }
      });

      const result = await api.topPages({
        siteUrl: 'example.com',
        startDate: '2025-01-01',
        endDate: '2025-01-14',
        limit: 10,
        metric: 'clicks',
        includeQueryBreakdown: true
      });

      expect(result.queryBreakdown).toBeDefined();
    });
  });

  describe('aggregate metrics calculation', () => {
    it('calculates total clicks and impressions', async () => {
      const result = await api.comparePeriods({
        siteUrl: 'example.com',
        period1Start: '2025-01-01',
        period1End: '2025-01-07',
        period2Start: '2025-01-08',
        period2End: '2025-01-14'
      });

      // Sum of mock data: 100 + 50 + 5 + 30 = 185 clicks
      expect(result.period1.clicks).toBe(185);
    });

    it('calculates weighted average position', async () => {
      const result = await api.comparePeriods({
        siteUrl: 'example.com',
        period1Start: '2025-01-01',
        period1End: '2025-01-07',
        period2Start: '2025-01-08',
        period2End: '2025-01-14'
      });

      // Weighted average = sum(position * impressions) / sum(impressions)
      expect(result.period1.position).toBeGreaterThan(0);
    });

    it('handles empty rows', async () => {
      mockSearchConsole.searchanalytics.query.mockResolvedValueOnce({
        data: { rows: [], responseAggregationType: 'auto' }
      }).mockResolvedValueOnce({
        data: { rows: mockSearchAnalyticsRows, responseAggregationType: 'auto' }
      });

      const result = await api.comparePeriods({
        siteUrl: 'example.com',
        period1Start: '2025-01-01',
        period1End: '2025-01-07',
        period2Start: '2025-01-08',
        period2End: '2025-01-14'
      });

      expect(result.period1.clicks).toBe(0);
      expect(result.period1.impressions).toBe(0);
      expect(result.period1.ctr).toBe(0);
      expect(result.period1.position).toBe(0);
    });
  });

  describe('change calculation', () => {
    it('calculates absolute change correctly', async () => {
      mockSearchConsole.searchanalytics.query
        .mockResolvedValueOnce({
          data: {
            rows: [{ keys: ['test'], clicks: 100, impressions: 1000, ctr: 0.1, position: 5 }],
            responseAggregationType: 'auto'
          }
        })
        .mockResolvedValueOnce({
          data: {
            rows: [{ keys: ['test'], clicks: 150, impressions: 1200, ctr: 0.125, position: 4 }],
            responseAggregationType: 'auto'
          }
        });

      const result = await api.comparePeriods({
        siteUrl: 'example.com',
        period1Start: '2025-01-01',
        period1End: '2025-01-07',
        period2Start: '2025-01-08',
        period2End: '2025-01-14'
      });

      expect(result.changes.clicks.absolute).toBe(50);
      expect(result.changes.impressions.absolute).toBe(200);
    });

    it('calculates percentage change correctly', async () => {
      mockSearchConsole.searchanalytics.query
        .mockResolvedValueOnce({
          data: {
            rows: [{ keys: ['test'], clicks: 100, impressions: 1000, ctr: 0.1, position: 5 }],
            responseAggregationType: 'auto'
          }
        })
        .mockResolvedValueOnce({
          data: {
            rows: [{ keys: ['test'], clicks: 150, impressions: 1000, ctr: 0.15, position: 5 }],
            responseAggregationType: 'auto'
          }
        });

      const result = await api.comparePeriods({
        siteUrl: 'example.com',
        period1Start: '2025-01-01',
        period1End: '2025-01-07',
        period2Start: '2025-01-08',
        period2End: '2025-01-14'
      });

      expect(result.changes.clicks.percentage).toBe(50); // 50% increase
    });

    it('handles zero values in change calculation', async () => {
      mockSearchConsole.searchanalytics.query
        .mockResolvedValueOnce({
          data: {
            rows: [{ keys: ['test'], clicks: 0, impressions: 0, ctr: 0, position: 0 }],
            responseAggregationType: 'auto'
          }
        })
        .mockResolvedValueOnce({
          data: {
            rows: [{ keys: ['test'], clicks: 100, impressions: 1000, ctr: 0.1, position: 5 }],
            responseAggregationType: 'auto'
          }
        });

      const result = await api.comparePeriods({
        siteUrl: 'example.com',
        period1Start: '2025-01-01',
        period1End: '2025-01-07',
        period2Start: '2025-01-08',
        period2End: '2025-01-14'
      });

      // Division by zero should return 0 percentage
      expect(result.changes.clicks.percentage).toBe(0);
    });
  });

  describe('comparePeriods row-level comparison (regression: period2-only rows)', () => {
    it('includes rows that exist only in period2', async () => {
      // Bug: compareRows iterated only period1Rows, dropping any new keys
      // that appeared in period2. This is a major use case — surfacing
      // queries/pages that started ranking in the comparison period.
      mockSearchConsole.searchanalytics.query
        .mockResolvedValueOnce({
          data: {
            rows: [
              { keys: ['existing query'], clicks: 10, impressions: 100, ctr: 0.1, position: 5 }
            ],
            responseAggregationType: 'auto'
          }
        })
        .mockResolvedValueOnce({
          data: {
            rows: [
              { keys: ['existing query'], clicks: 15, impressions: 120, ctr: 0.125, position: 4 },
              { keys: ['new query'], clicks: 8, impressions: 80, ctr: 0.1, position: 7 }
            ],
            responseAggregationType: 'auto'
          }
        });

      const result = await api.comparePeriods({
        siteUrl: 'example.com',
        period1Start: '2025-01-01',
        period1End: '2025-01-07',
        period2Start: '2025-01-08',
        period2End: '2025-01-14',
        dimensions: ['query']
      });

      expect(result.rows).toBeDefined();
      const newQueryRow = result.rows!.find((r) => r.key === 'new query');
      expect(newQueryRow).toBeDefined();
      expect(newQueryRow!.period1.clicks).toBe(0);
      expect(newQueryRow!.period2.clicks).toBe(8);
    });

    it('includes rows that exist only in period1', async () => {
      mockSearchConsole.searchanalytics.query
        .mockResolvedValueOnce({
          data: {
            rows: [
              { keys: ['old query'], clicks: 20, impressions: 200, ctr: 0.1, position: 6 }
            ],
            responseAggregationType: 'auto'
          }
        })
        .mockResolvedValueOnce({
          data: { rows: [], responseAggregationType: 'auto' }
        });

      const result = await api.comparePeriods({
        siteUrl: 'example.com',
        period1Start: '2025-01-01',
        period1End: '2025-01-07',
        period2Start: '2025-01-08',
        period2End: '2025-01-14',
        dimensions: ['query']
      });

      const oldQueryRow = result.rows!.find((r) => r.key === 'old query');
      expect(oldQueryRow).toBeDefined();
      expect(oldQueryRow!.period1.clicks).toBe(20);
      expect(oldQueryRow!.period2.clicks).toBe(0);
    });
  });

  describe('topQueries includeTrend (regression: AND-conjunction filter on multiple queries)', () => {
    it('does not produce an AND-conjunction filter that matches no rows', async () => {
      // Bug: getTrendData built a single filterGroup with all queries OR'd
      // together — but the implementation hardcodes groupType='and' so
      // `query equals A AND query equals B` matches zero rows. The fix is to
      // make per-query parallel calls (one trend query at a time) so each
      // call has at most one query filter.
      mockSearchConsole.searchanalytics.query.mockReset();

      // First call: topQueries() (dimensions=['query'])
      mockSearchConsole.searchanalytics.query.mockResolvedValueOnce({
        data: {
          rows: [
            { keys: ['query1'], clicks: 100, impressions: 1000, ctr: 0.1, position: 3 },
            { keys: ['query2'], clicks: 80, impressions: 800, ctr: 0.1, position: 4 }
          ],
          responseAggregationType: 'auto'
        }
      });
      // Subsequent calls: per-query trend fetches
      mockSearchConsole.searchanalytics.query.mockResolvedValue({
        data: { rows: [], responseAggregationType: 'auto' }
      });

      await api.topQueries({
        siteUrl: 'example.com',
        startDate: '2025-01-01',
        endDate: '2025-01-14',
        limit: 10,
        metric: 'clicks',
        includeTrend: true
      });

      // Inspect the trend-related calls: every dimensionFilterGroups should
      // contain exactly ONE filter (not multiple ANDed query=X filters).
      const calls = mockSearchConsole.searchanalytics.query.mock.calls;
      const trendCalls = calls.filter((c) => {
        const body = c[0]?.requestBody as Record<string, unknown> | undefined;
        const dims = body?.dimensions as string[] | undefined;
        return Array.isArray(dims) && dims.includes('date');
      });

      expect(trendCalls.length).toBeGreaterThan(0);
      for (const call of trendCalls) {
        const body = call[0]?.requestBody as Record<string, unknown>;
        const groups = body?.dimensionFilterGroups as Array<{ filters: unknown[] }> | undefined;
        if (groups && groups.length > 0) {
          for (const group of groups) {
            expect(group.filters.length).toBeLessThanOrEqual(1);
          }
        }
      }
    });
  });
});
