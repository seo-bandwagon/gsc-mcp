import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AnalysisApi } from '../../../src/api/analysis.js';
import type { Sitemap, SearchAnalyticsRow } from '../../../src/types/index.js';

// Per-test fixture state. Tests mutate these before invoking the API; the
// mockSearchConsole methods read them on each call.
let sitemapsResponse: Sitemap[] = [];
let pageRows: SearchAnalyticsRow[] = [];

const mockSearchConsole = {
  searchanalytics: {
    query: vi.fn()
  },
  sitemaps: {
    list: vi.fn()
  }
};

const mockClient = {
  getSearchConsole: vi.fn(() => mockSearchConsole),
  withRetry: vi.fn(async (operation: () => Promise<unknown>) => operation()),
  getCache: vi.fn(() => ({
    get: vi.fn(),
    set: vi.fn(),
    delete: vi.fn(),
    generateKey: vi.fn(() => 'cache-key')
  }))
};

vi.mock('../../../src/api/sites.js', () => ({
  SitesApi: vi.fn(function SitesApi() {
    return {
      listSites: vi.fn().mockResolvedValue({
        sites: [{ siteUrl: 'sc-domain:example.com', permissionLevel: 'siteOwner' }]
      })
    };
  })
}));

vi.mock('../../../src/utils/site-url.js', () => ({
  resolveSiteUrl: vi.fn().mockResolvedValue('sc-domain:example.com')
}));

vi.mock('../../../src/utils/logger.js', () => ({
  getGlobalLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  })
}));

// Helper: build a sitemap entry with just the fields we care about for these tests
function makeSitemap(opts: {
  path?: string;
  submitted: number;
  indexed?: number;
  errors?: number;
  warnings?: number;
}): Sitemap {
  return {
    path: opts.path ?? 'https://example.com/sitemap.xml',
    lastSubmitted: '2026-04-01T00:00:00Z',
    isPending: false,
    isSitemapsIndex: false,
    warnings: opts.warnings ?? 0,
    errors: opts.errors ?? 0,
    contents: [{ type: 'web', submitted: opts.submitted, indexed: opts.indexed ?? 0 }]
  };
}

// The googleapis sitemaps.list response shape uses string-typed numeric fields
// for warnings/errors and `contents[].submitted`/`indexed`.
function toApiShape(s: Sitemap) {
  return {
    path: s.path,
    lastSubmitted: s.lastSubmitted,
    isPending: s.isPending,
    isSitemapsIndex: s.isSitemapsIndex,
    warnings: String(s.warnings),
    errors: String(s.errors),
    contents: s.contents.map((c) => ({
      type: c.type,
      submitted: String(c.submitted),
      indexed: String(c.indexed)
    }))
  };
}

describe('AnalysisApi.analyzeOpportunities (coverage focus)', () => {
  let api: AnalysisApi;

  beforeEach(() => {
    vi.clearAllMocks();

    sitemapsResponse = [];
    pageRows = [];

    mockSearchConsole.sitemaps.list.mockImplementation(async () => ({
      data: { sitemap: sitemapsResponse.map(toApiShape) }
    }));

    mockSearchConsole.searchanalytics.query.mockImplementation(async () => ({
      data: { rows: pageRows, responseAggregationType: 'auto' }
    }));

    api = new AnalysisApi(mockClient as never);
  });

  it('does NOT flag indexing_issue when sitemap API returns indexed=0 but pages have impressions (regression: false-positive bug)', async () => {
    // Reproduces the reported bug: GSC Sitemaps API returns indexed=0 for a
    // sitemap that's actually healthy. With the new SA-based signal, 36 of
    // 62 submitted URLs received impressions (~58% coverage) — well above
    // the 30% threshold, so no opportunity should be emitted.
    sitemapsResponse = [makeSitemap({ submitted: 62, indexed: 0 })];
    pageRows = Array.from({ length: 36 }, (_, i) => ({
      keys: [`https://example.com/page-${i}`],
      clicks: 1,
      impressions: 10,
      ctr: 0.1,
      position: 5
    }));

    const result = await api.analyzeOpportunities({
      siteUrl: 'example.com',
      focus: ['coverage']
    });

    const indexingIssues = result.opportunities.filter((o) => o.type === 'indexing_issue');
    expect(indexingIssues).toEqual([]);
  });

  it('flags indexing_issue with medium priority when SA coverage is between 10% and 30%', async () => {
    // 50 of 1000 submitted URLs have impressions = 5% — wait, 5% is below 10%.
    // Use 200/1000 = 20% for medium tier.
    sitemapsResponse = [makeSitemap({ submitted: 1000, indexed: 0 })];
    pageRows = Array.from({ length: 200 }, (_, i) => ({
      keys: [`https://example.com/page-${i}`],
      clicks: 0,
      impressions: 5,
      ctr: 0,
      position: 30
    }));

    const result = await api.analyzeOpportunities({
      siteUrl: 'example.com',
      focus: ['coverage']
    });

    const issue = result.opportunities.find((o) => o.type === 'indexing_issue');
    expect(issue).toBeDefined();
    expect(issue!.priority).toBe('medium');
    expect(issue!.title).toMatch(/visibility|indexed/i);
    expect(issue!.description).toContain('200');
    expect(issue!.description).toContain('1000');
  });

  it('flags indexing_issue with high priority when SA coverage is below 10%', async () => {
    sitemapsResponse = [makeSitemap({ submitted: 1000, indexed: 0 })];
    pageRows = Array.from({ length: 30 }, (_, i) => ({
      keys: [`https://example.com/page-${i}`],
      clicks: 0,
      impressions: 1,
      ctr: 0,
      position: 60
    }));

    const result = await api.analyzeOpportunities({
      siteUrl: 'example.com',
      focus: ['coverage']
    });

    const issue = result.opportunities.find((o) => o.type === 'indexing_issue');
    expect(issue).toBeDefined();
    expect(issue!.priority).toBe('high');
  });

  it('skips the indexation heuristic for tiny sitemaps (totalUrls < 20)', async () => {
    sitemapsResponse = [makeSitemap({ submitted: 5, indexed: 0 })];
    pageRows = []; // Even with zero pages with impressions, we should not flag

    const result = await api.analyzeOpportunities({
      siteUrl: 'example.com',
      focus: ['coverage']
    });

    expect(result.opportunities.filter((o) => o.type === 'indexing_issue')).toEqual([]);
    // Should also not have called Search Analytics for the tiny site
    expect(mockSearchConsole.searchanalytics.query).not.toHaveBeenCalled();
  });

  it('still emits the high-priority "Sitemap errors detected" opportunity when errors > 0', async () => {
    sitemapsResponse = [makeSitemap({ submitted: 100, indexed: 95, errors: 2 })];
    // High coverage (95%) so no indexation-rate opportunity, but errors should still flag
    pageRows = Array.from({ length: 95 }, (_, i) => ({
      keys: [`https://example.com/page-${i}`],
      clicks: 1,
      impressions: 10,
      ctr: 0.1,
      position: 5
    }));

    const result = await api.analyzeOpportunities({
      siteUrl: 'example.com',
      focus: ['coverage']
    });

    const errorIssue = result.opportunities.find(
      (o) => o.type === 'indexing_issue' && o.title === 'Sitemap errors detected'
    );
    expect(errorIssue).toBeDefined();
    expect(errorIssue!.priority).toBe('high');
  });

  it('does NOT emit a "Sitemap warnings" opportunity when warnings > 0 and errors = 0', async () => {
    // The Sitemaps API's warnings counter often diverges from the GSC UI;
    // we drop this opportunity entirely to avoid false positives.
    sitemapsResponse = [makeSitemap({ submitted: 100, indexed: 95, warnings: 2, errors: 0 })];
    pageRows = Array.from({ length: 95 }, (_, i) => ({
      keys: [`https://example.com/page-${i}`],
      clicks: 1,
      impressions: 10,
      ctr: 0.1,
      position: 5
    }));

    const result = await api.analyzeOpportunities({
      siteUrl: 'example.com',
      focus: ['coverage']
    });

    expect(result.opportunities.filter((o) => /warning/i.test(o.title))).toEqual([]);
    expect(result.opportunities).toEqual([]);
  });

  it('queries Search Analytics with dimensions=["page"] for the coverage signal', async () => {
    sitemapsResponse = [makeSitemap({ submitted: 100, indexed: 0 })];
    pageRows = Array.from({ length: 80 }, (_, i) => ({
      keys: [`https://example.com/page-${i}`],
      clicks: 1,
      impressions: 5,
      ctr: 0.2,
      position: 10
    }));

    await api.analyzeOpportunities({
      siteUrl: 'example.com',
      focus: ['coverage']
    });

    expect(mockSearchConsole.searchanalytics.query).toHaveBeenCalledWith(
      expect.objectContaining({
        requestBody: expect.objectContaining({
          dimensions: ['page']
        })
      })
    );
  });
});

describe('AnalysisApi.findContentGaps', () => {
  let api: AnalysisApi;

  beforeEach(() => {
    vi.clearAllMocks();
    api = new AnalysisApi(mockClient as never);
  });

  it('clusters all "how to" queries into one cluster (regression: clusterQueries captured full match)', async () => {
    // Three different "how to ..." queries should cluster together. Before the
    // fix, each captured its own full query as the cluster key, then the
    // length>=2 filter discarded them — clustering was effectively dead.
    mockSearchConsole.searchanalytics.query.mockResolvedValueOnce({
      data: {
        rows: [
          { keys: ['how to bake bread', 'https://example.com/bread'], clicks: 5, impressions: 100, ctr: 0.05, position: 8 },
          { keys: ['how to bake cake', 'https://example.com/cake'], clicks: 3, impressions: 50, ctr: 0.06, position: 9 },
          { keys: ['how to fry eggs', 'https://example.com/eggs'], clicks: 2, impressions: 30, ctr: 0.067, position: 10 }
        ],
        responseAggregationType: 'auto'
      }
    });

    const result = await api.findContentGaps({
      siteUrl: 'example.com',
      startDate: '2026-01-01',
      endDate: '2026-01-28',
      minImpressions: 1
    });

    expect(result.gaps.length).toBeGreaterThan(0);
    const howToCluster = result.gaps.find((g) => g.queryCluster === 'how to');
    expect(howToCluster).toBeDefined();
    expect(howToCluster!.queries.length).toBe(3);
  });

  it('clusters " vs " queries together', async () => {
    mockSearchConsole.searchanalytics.query.mockResolvedValueOnce({
      data: {
        rows: [
          { keys: ['react vs vue', 'https://example.com/a'], clicks: 1, impressions: 100, ctr: 0.01, position: 8 },
          { keys: ['svelte vs solid', 'https://example.com/b'], clicks: 1, impressions: 80, ctr: 0.013, position: 9 }
        ],
        responseAggregationType: 'auto'
      }
    });

    const result = await api.findContentGaps({
      siteUrl: 'example.com',
      startDate: '2026-01-01',
      endDate: '2026-01-28',
      minImpressions: 1
    });

    const vsCluster = result.gaps.find((g) => g.queryCluster === 'vs');
    expect(vsCluster).toBeDefined();
    expect(vsCluster!.queries.length).toBe(2);
  });

  it('does not emit gaps with NaN avgPosition when totalImpressions is 0', async () => {
    // Edge case: minImpressions=0 admits zero-impression rows. The cluster's
    // weighted avgPosition would be 0/0 = NaN. We must drop these silently.
    mockSearchConsole.searchanalytics.query.mockResolvedValueOnce({
      data: {
        rows: [
          { keys: ['how to a', 'https://example.com/a'], clicks: 0, impressions: 0, ctr: 0, position: 5 },
          { keys: ['how to b', 'https://example.com/b'], clicks: 0, impressions: 0, ctr: 0, position: 7 }
        ],
        responseAggregationType: 'auto'
      }
    });

    const result = await api.findContentGaps({
      siteUrl: 'example.com',
      startDate: '2026-01-01',
      endDate: '2026-01-28',
      minImpressions: 0
    });

    for (const gap of result.gaps) {
      expect(Number.isFinite(gap.avgPosition)).toBe(true);
      expect(Number.isFinite(gap.totalImpressions)).toBe(true);
    }
  });
});

describe('AnalysisApi.checkCannibalization', () => {
  let api: AnalysisApi;

  beforeEach(() => {
    vi.clearAllMocks();
    api = new AnalysisApi(mockClient as never);
  });

  it('flags cannibalization when click traffic is split across pages', async () => {
    // Two pages competing for "shoes" with a 50/50 split — top page gets only
    // 50% of the clicks (< 70% threshold), so this is cannibalization.
    mockSearchConsole.searchanalytics.query.mockResolvedValueOnce({
      data: {
        rows: [
          { keys: ['shoes', 'https://example.com/a'], clicks: 50, impressions: 1000, ctr: 0.05, position: 4 },
          { keys: ['shoes', 'https://example.com/b'], clicks: 50, impressions: 800, ctr: 0.0625, position: 6 }
        ],
        responseAggregationType: 'auto'
      }
    });

    const result = await api.checkCannibalization({
      siteUrl: 'example.com',
      startDate: '2026-01-01',
      endDate: '2026-01-28',
      minPages: 2
    });

    expect(result.cannibalizationIssues.length).toBe(1);
    expect(result.cannibalizationIssues[0].query).toBe('shoes');
    expect(result.cannibalizationIssues[0].pages.length).toBe(2);
  });

  it('does not emit issues for queries where all pages have zero clicks (regression: NaN ratio)', async () => {
    // 0/0 = NaN — without an explicit guard, the comparison NaN < 0.7 silently
    // returns false, so the issue is not emitted. We still don't want to emit
    // an issue (impression-only competition is too noisy), but we must do it
    // intentionally rather than via a NaN coincidence.
    mockSearchConsole.searchanalytics.query.mockResolvedValueOnce({
      data: {
        rows: [
          { keys: ['niche', 'https://example.com/a'], clicks: 0, impressions: 50, ctr: 0, position: 30 },
          { keys: ['niche', 'https://example.com/b'], clicks: 0, impressions: 40, ctr: 0, position: 35 }
        ],
        responseAggregationType: 'auto'
      }
    });

    const result = await api.checkCannibalization({
      siteUrl: 'example.com',
      startDate: '2026-01-01',
      endDate: '2026-01-28',
      minPages: 2
    });

    expect(result.cannibalizationIssues).toEqual([]);
  });

  it('does not flag when one page clearly dominates (>70% of clicks)', async () => {
    mockSearchConsole.searchanalytics.query.mockResolvedValueOnce({
      data: {
        rows: [
          { keys: ['shoes', 'https://example.com/a'], clicks: 90, impressions: 1000, ctr: 0.09, position: 3 },
          { keys: ['shoes', 'https://example.com/b'], clicks: 10, impressions: 200, ctr: 0.05, position: 12 }
        ],
        responseAggregationType: 'auto'
      }
    });

    const result = await api.checkCannibalization({
      siteUrl: 'example.com',
      startDate: '2026-01-01',
      endDate: '2026-01-28',
      minPages: 2
    });

    expect(result.cannibalizationIssues).toEqual([]);
  });
});
