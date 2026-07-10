/**
 * Regression tests keyed to defects reproduced live against sc-domain:seobandwagon.com
 * (window 2026-07-01 → 2026-07-07). The fixtures encode the measured identities:
 *
 *   no-dims byProperty total ............ 1,076 impressions
 *   country×device byProperty, summed ... 1,076 (exact — lossless)
 *   country×device byPage, summed ....... 1,208 (unit change, not loss)
 *   page dimension, summed .............. 1,208 (exact — page drops nothing)
 *   query dimension, summed ............. 928 → 86.2% coverage (query IS lossy)
 *
 * The mock searchanalytics endpoint emulates the API's documented server-side behavior:
 * rows sorted by clicks descending (ties broken alphabetically) and sliced by
 * startRow/rowLimit — which is exactly what made the old top-N tools return an
 * arbitrary alphabetical slice.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SearchAnalyticsApi } from '../../../src/api/search-analytics.js';
import type { SearchAnalyticsRow } from '../../../src/types/index.js';

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
  getGlobalLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() })
}));

type FixtureRow = { keys: string[]; clicks: number; impressions: number; ctr: number; position: number };

// ---- Fixtures encoding the measured live identities -------------------------------

/** country×device under byProperty — sums to exactly 1,076. */
const COUNTRY_DEVICE_BY_PROPERTY: FixtureRow[] = [
  { keys: ['usa', 'DESKTOP'], clicks: 1, impressions: 733, ctr: 1 / 733, position: 45.3 },
  { keys: ['usa', 'MOBILE'], clicks: 0, impressions: 273, ctr: 0, position: 46.7 },
  { keys: ['can', 'DESKTOP'], clicks: 0, impressions: 70, ctr: 0, position: 54.5 }
];

/** country×device under byPage — same traffic, page-unit counting — sums to exactly 1,208. */
const COUNTRY_DEVICE_BY_PAGE: FixtureRow[] = [
  { keys: ['usa', 'DESKTOP'], clicks: 1, impressions: 833, ctr: 1 / 833, position: 41.0 },
  { keys: ['usa', 'MOBILE'], clicks: 0, impressions: 281, ctr: 0, position: 45.9 },
  { keys: ['can', 'DESKTOP'], clicks: 0, impressions: 94, ctr: 0, position: 41.0 }
];

/** page dimension — sums to exactly 1,208 (page is NOT lossy). */
const PAGE_ROWS: FixtureRow[] = [
  { keys: ['https://example.com/'], clicks: 1, impressions: 788, ctr: 1 / 788, position: 48.7 },
  { keys: ['https://example.com/seo-chrome-extension'], clicks: 0, impressions: 111, ctr: 0, position: 47.5 },
  { keys: ['https://example.com/local-seo'], clicks: 0, impressions: 82, ctr: 0, position: 40.4 },
  { keys: ['https://example.com/tools/lat-lng'], clicks: 0, impressions: 61, ctr: 0, position: 8.5 },
  { keys: ['https://example.com/misc'], clicks: 0, impressions: 166, ctr: 0, position: 20.0 }
];

/** query dimension — sums to exactly 928 of the 1,076 byProperty total (query IS lossy). */
const QUERY_ROWS: FixtureRow[] = [
  { keys: ['seo bandwagon'], clicks: 1, impressions: 10, ctr: 0.1, position: 1 },
  { keys: ['ballard seo'], clicks: 0, impressions: 34, ctr: 0, position: 24.3 },
  { keys: ['ames lake seo'], clicks: 0, impressions: 25, ctr: 0, position: 51.4 },
  { keys: ['carlsbad seo'], clicks: 0, impressions: 141, ctr: 0, position: 71.5 },
  { keys: ['yext local seo'], clicks: 0, impressions: 122, ctr: 0, position: 39.4 },
  { keys: ['seo carlsbad'], clicks: 0, impressions: 118, ctr: 0, position: 62.5 },
  { keys: ['roanoke seo'], clicks: 0, impressions: 129, ctr: 0, position: 67.0 },
  { keys: ['woburn seo'], clicks: 0, impressions: 120, ctr: 0, position: 42.2 },
  { keys: ['seo thunder bay'], clicks: 0, impressions: 112, ctr: 0, position: 36.3 },
  { keys: ['artondale seo'], clicks: 0, impressions: 117, ctr: 0, position: 38.6 }
];
const QUERY_SUM = 928;
const PROPERTY_TOTAL: FixtureRow[] = [
  { keys: [], clicks: 1, impressions: 1076, ctr: 1 / 1076, position: 45.57 }
];
const PAGE_UNIT_TOTAL: FixtureRow[] = [
  { keys: [], clicks: 1, impressions: 1208, ctr: 1 / 1208, position: 41.6 }
];

// ---- Mock GSC server ---------------------------------------------------------------

/**
 * Dispatch a dataset per request shape, then emulate the API's row selection:
 * clicks descending, ties alphabetical by key, sliced by startRow/rowLimit.
 */
function apiSlice(rows: FixtureRow[], startRow: number, rowLimit: number): FixtureRow[] {
  const sorted = [...rows].sort(
    (a, b) => b.clicks - a.clicks || a.keys.join('|').localeCompare(b.keys.join('|'))
  );
  return sorted.slice(startRow, startRow + rowLimit);
}

interface MockRequest {
  siteUrl?: string;
  requestBody: {
    dimensions: string[];
    aggregationType?: string;
    startRow: number;
    rowLimit: number;
    startDate: string;
    endDate: string;
  };
}

function createApi(datasetFor: (body: MockRequest['requestBody']) => FixtureRow[]) {
  const queryMock = vi.fn(async (req: MockRequest) => {
    const body = req.requestBody;
    const rows = apiSlice(datasetFor(body), body.startRow, body.rowLimit);
    return {
      data: {
        rows,
        responseAggregationType: body.dimensions.includes('page') || body.aggregationType === 'byPage' ? 'byPage' : 'byProperty'
      }
    };
  });

  const mockClient = {
    getSearchConsole: vi.fn(() => ({ searchanalytics: { query: queryMock } })),
    withRetry: vi.fn(async (operation: () => Promise<unknown>) => operation()),
    getCache: vi.fn(() => ({ get: vi.fn(), set: vi.fn(), generateKey: vi.fn() }))
  };

  return { api: new SearchAnalyticsApi(mockClient as never), queryMock };
}

const sum = (rows: SearchAnalyticsRow[]) => rows.reduce((s, r) => s + r.impressions, 0);

const WINDOW = { siteUrl: 'sc-domain:example.com', startDate: '2026-07-01', endDate: '2026-07-07' };

beforeEach(() => {
  vi.clearAllMocks();
});

// ---- byProperty / byPage identity ---------------------------------------------------

describe('aggregation identity (1,076 byProperty vs 1,208 byPage)', () => {
  const datasetFor = (body: MockRequest['requestBody']): FixtureRow[] => {
    if (body.dimensions.length === 0) {
      return body.aggregationType === 'byPage' ? PAGE_UNIT_TOTAL : PROPERTY_TOTAL;
    }
    if (body.dimensions.join() === 'country,device') {
      return body.aggregationType === 'byPage' ? COUNTRY_DEVICE_BY_PAGE : COUNTRY_DEVICE_BY_PROPERTY;
    }
    if (body.dimensions.join() === 'page') return PAGE_ROWS;
    if (body.dimensions.join() === 'query') return QUERY_ROWS;
    return [];
  };

  it('country×device byProperty sums to the byProperty total (1,076 — lossless)', async () => {
    const { api } = createApi(datasetFor);
    const result = await api.query({ ...WINDOW, dimensions: ['country', 'device'], aggregationType: 'byProperty' });
    expect(sum(result.rows)).toBe(1076);
    expect(result.aggregation_type).toBe('byProperty');
  });

  it('country×device byPage sums to the byPage total (1,208 — a unit change, not loss)', async () => {
    const { api } = createApi(datasetFor);
    const result = await api.query({ ...WINDOW, dimensions: ['country', 'device'], aggregationType: 'byPage' });
    expect(sum(result.rows)).toBe(1208);
    expect(result.aggregation_type).toBe('byPage');
  });

  it('page dimension sums to exactly the byPage total — page drops nothing', async () => {
    const { api } = createApi(datasetFor);
    const result = await api.query({ ...WINDOW, dimensions: ['page'] });
    expect(sum(result.rows)).toBe(1208);
    expect(result.aggregation_type).toBe('byPage');
  });

  it("defaults aggregation to byPage when 'page' is grouped, with an explicit warning", async () => {
    const { api, queryMock } = createApi(datasetFor);
    const result = await api.query({ ...WINDOW, dimensions: ['page'] });
    expect(queryMock).toHaveBeenCalledWith(
      expect.objectContaining({ requestBody: expect.objectContaining({ aggregationType: 'byPage' }) })
    );
    expect(result.warnings.some((w) => w.includes("defaulted to 'byPage'"))).toBe(true);
  });

  it("defaults aggregation to byProperty when 'page' is absent — never sends 'auto'", async () => {
    const { api, queryMock } = createApi(datasetFor);
    await api.query({ ...WINDOW, dimensions: ['country', 'device'] });
    expect(queryMock).toHaveBeenCalledWith(
      expect.objectContaining({ requestBody: expect.objectContaining({ aggregationType: 'byProperty' }) })
    );
  });

  it("rejects byProperty combined with the 'page' dimension with an actionable error", async () => {
    const { api } = createApi(datasetFor);
    await expect(
      api.query({ ...WINDOW, dimensions: ['page'], aggregationType: 'byProperty' })
    ).rejects.toThrow(/byPage|aggregation/i);
  });

  it('rows carry additive sum_position = impressions × position', async () => {
    const { api } = createApi(datasetFor);
    const result = await api.query({ ...WINDOW, dimensions: ['page'] });
    for (const row of result.rows) {
      expect(row.sum_position).toBeCloseTo(row.impressions * row.position, 6);
    }
  });

  it('flags lossy grains: query rows warn, country/device rows do not', async () => {
    const { api } = createApi(datasetFor);
    const lossy = await api.query({ ...WINDOW, dimensions: ['query'] });
    expect(lossy.warnings.some((w) => w.includes('drops some data') || w.includes('under-counts'))).toBe(true);
    const lossless = await api.query({ ...WINDOW, dimensions: ['country', 'device'] });
    expect(lossless.warnings.filter((w) => w.includes('under-counts'))).toHaveLength(0);
  });
});

// ---- Coverage report (928 / 1,076 → 86.2%) -----------------------------------------

describe('coverageReport (query grain: 928 of 1,076 → 86.2%)', () => {
  const datasetFor = (body: MockRequest['requestBody']): FixtureRow[] => {
    if (body.dimensions.join() === 'query') return QUERY_ROWS;
    if (body.dimensions.length === 0) return PROPERTY_TOTAL;
    return [];
  };

  it('reports coverage_pct and dropped_impressions against the accurate denominator', async () => {
    const { api } = createApi(datasetFor);
    const report = await api.coverageReport({ ...WINDOW, entityType: 'query' });

    expect(sum(QUERY_ROWS.map((r) => ({ ...r, sum_position: 0 })))).toBe(QUERY_SUM); // fixture self-check
    expect(report.property_impressions).toBe(1076);
    expect(report.entity_impressions).toBe(928);
    expect(report.coverage_pct).toBe(86.2);
    expect(report.dropped_impressions).toBe(148);
    expect(report.aggregation_type).toBe('byProperty');
    expect(report.warnings.some((w) => w.includes('86.2%'))).toBe(true);
  });

  it('uses byPage for page-involving grains so the denominator unit matches', async () => {
    const { api } = createApi((body) => {
      if (body.dimensions.join() === 'page') return PAGE_ROWS;
      if (body.dimensions.length === 0) {
        return body.aggregationType === 'byPage' ? PAGE_UNIT_TOTAL : PROPERTY_TOTAL;
      }
      return [];
    });
    const report = await api.coverageReport({ ...WINDOW, entityType: 'page' });
    expect(report.property_impressions).toBe(1208);
    expect(report.entity_impressions).toBe(1208);
    expect(report.coverage_pct).toBe(100);
    expect(report.aggregation_type).toBe('byPage');
  });
});

// ---- top-N: metric must select rows, not just re-order a truncated slice -----------

describe('topQueries/topPages rank over the FULL row set (metric-is-display-only regression)', () => {
  const datasetFor = (body: MockRequest['requestBody']): FixtureRow[] => {
    if (body.dimensions.join() === 'query') return QUERY_ROWS;
    if (body.dimensions.join() === 'page') return PAGE_ROWS;
    if (body.dimensions.length === 0) return PROPERTY_TOTAL;
    return [];
  };

  it('limit-5 by impressions surfaces the largest rows even when the API pre-sorts by clicks/alphabet', async () => {
    const { api, queryMock } = createApi(datasetFor);
    const result = await api.topQueries({
      ...WINDOW,
      limit: 5,
      metric: 'impressions',
      includeTrend: false
    });

    // The old implementation passed limit as rowLimit: the API would return the
    // clicks-then-alphabetical top 5 ("ames lake seo", "artondale seo", ...), and
    // 141-impression "carlsbad seo" / 122-impression "yext local seo" vanished.
    const keys = result.rows.map((r) => r.keys[0]);
    expect(keys).toEqual(['carlsbad seo', 'roanoke seo', 'yext local seo', 'woburn seo', 'seo carlsbad']);

    // The full set must have been fetched (25,000-row page), not a limit-sized slice.
    expect(queryMock).toHaveBeenCalledWith(
      expect.objectContaining({ requestBody: expect.objectContaining({ rowLimit: 25000 }) })
    );
    expect(result.total_count).toBe(QUERY_ROWS.length);
    expect(result.has_more).toBe(true);
    expect(result.count).toBe(5);
  });

  it('different metrics select different row sets (not the identical truncation re-sorted)', async () => {
    const { api } = createApi(datasetFor);
    const byImpressions = await api.topQueries({ ...WINDOW, limit: 3, metric: 'impressions', includeTrend: false });
    const byPosition = await api.topQueries({ ...WINDOW, limit: 3, metric: 'position', includeTrend: false });

    expect(byImpressions.rows.map((r) => r.keys[0])).toEqual(['carlsbad seo', 'roanoke seo', 'yext local seo']);
    expect(byPosition.rows[0].keys[0]).toBe('seo bandwagon'); // position 1 is best
    expect(byImpressions.rows.map((r) => r.keys[0])).not.toEqual(byPosition.rows.map((r) => r.keys[0]));
  });

  it('topPages by impressions never omits a large page in favor of alphabetically-early small ones', async () => {
    const { api } = createApi(datasetFor);
    const result = await api.topPages({ ...WINDOW, limit: 2, metric: 'impressions', includeQueryBreakdown: false });
    expect(result.rows.map((r) => r.keys[0])).toEqual([
      'https://example.com/',
      'https://example.com/misc'
    ]);
    expect(result.aggregation_type).toBe('byPage');
  });
});

// ---- Pagination past the 25,000-row boundary ----------------------------------------

describe('internal pagination (synthetic 60,500-row dataset)', () => {
  function bigDataset(n: number): FixtureRow[] {
    // Distinct zero-click rows; clicks on the first few so the API sort is stable.
    return Array.from({ length: n }, (_, i) => ({
      keys: [`query-${String(i).padStart(6, '0')}`],
      clicks: i < 3 ? 3 - i : 0,
      impressions: 1,
      ctr: 0,
      position: 10
    }));
  }

  it('re-issues the request with startRow += 25,000 until the page is short, and returns the full set', async () => {
    const rows = bigDataset(60500);
    const { api, queryMock } = createApi(() => rows);
    const result = await api.query({ ...WINDOW, dimensions: ['query'] });

    expect(result.rows).toHaveLength(60500);
    expect(result.total_count).toBe(60500);
    expect(result.has_more).toBe(false);
    expect(queryMock).toHaveBeenCalledTimes(3);
    const startRows = queryMock.mock.calls.map((c) => (c[0] as MockRequest).requestBody.startRow);
    expect(startRows).toEqual([0, 25000, 50000]);
  });

  it('manual paging (explicit rowLimit/startRow) makes exactly one request and reports next_offset', async () => {
    const rows = bigDataset(60500);
    const { api, queryMock } = createApi(() => rows);
    const result = await api.query({ ...WINDOW, dimensions: ['query'], rowLimit: 25000, startRow: 25000 });

    expect(queryMock).toHaveBeenCalledTimes(1);
    expect(result.rows).toHaveLength(25000);
    expect(result.has_more).toBe(true);
    expect(result.next_offset).toBe(50000);
    expect(result.total_count).toBeUndefined();
  });

  it('flags the 50,000-rows/day ceiling on a single-day pull and names the dropped tail', async () => {
    const rows = bigDataset(50000);
    const { api } = createApi(() => rows);
    const result = await api.query({
      siteUrl: 'sc-domain:example.com',
      startDate: '2026-07-01',
      endDate: '2026-07-01',
      dimensions: ['query']
    });

    expect(result.row_ceiling_reached).toBe(true);
    expect(result.warnings.some((w) => w.includes('click-descending') || w.includes('lowest-click'))).toBe(true);
  });

  it('warns (without flagging the ceiling) from 40,000 rows', async () => {
    const rows = bigDataset(41000);
    const { api } = createApi(() => rows);
    const result = await api.query({
      siteUrl: 'sc-domain:example.com',
      startDate: '2026-07-01',
      endDate: '2026-07-01',
      dimensions: ['query']
    });

    expect(result.row_ceiling_reached).toBe(false);
    expect(result.warnings.some((w) => w.includes('50,000'))).toBe(true);
  });
});

// ---- accurateTotals & searchAppearance guards ---------------------------------------

describe('accurateTotals', () => {
  it('computes impression-weighted position and additive sum_position from lossless rows', async () => {
    const { api } = createApi((body) =>
      body.dimensions.length === 0 ? PROPERTY_TOTAL : COUNTRY_DEVICE_BY_PROPERTY
    );
    const result = await api.accurateTotals({ ...WINDOW, aggregationType: 'byProperty', dimensions: ['country', 'device'] });

    expect(result.totals.impressions).toBe(1076);
    const expectedSumPos = 733 * 45.3 + 273 * 46.7 + 70 * 54.5;
    expect(result.totals.sum_position).toBeCloseTo(expectedSumPos, 3);
    expect(result.totals.position).toBeCloseTo(expectedSumPos / 1076, 6);
    expect(result.aggregation_type).toBe('byProperty');
  });
});

describe('searchAppearance two-step', () => {
  it('rejects combining searchAppearance with other dimensions in a raw query', async () => {
    const { api } = createApi(() => []);
    await expect(
      api.query({ ...WINDOW, dimensions: ['searchAppearance', 'query'] })
    ).rejects.toThrow(/gsc_search_appearance/);
  });

  it("sends byPage for searchAppearance grouping (the API 400s on byProperty — verified live)", async () => {
    const { api, queryMock } = createApi(() => []);
    await api.searchAppearance({ ...WINDOW });
    expect(queryMock).toHaveBeenCalledWith(
      expect.objectContaining({ requestBody: expect.objectContaining({ aggregationType: 'byPage' }) })
    );
  });

  it('rejects explicit byProperty with searchAppearance grouping before hitting the API', async () => {
    const { api, queryMock } = createApi(() => []);
    await expect(
      api.query({ ...WINDOW, dimensions: ['searchAppearance'], aggregationType: 'byProperty' })
    ).rejects.toThrow(/byPage/);
    expect(queryMock).not.toHaveBeenCalled();
  });

  it('returns cleanly (not an error) when the property has no rich results', async () => {
    const { api } = createApi(() => []);
    const result = await api.searchAppearance({ ...WINDOW, dimensions: ['page'] });
    expect(result.appearance_types).toEqual([]);
    expect(result.breakdowns).toEqual([]);
    expect(result.warnings.some((w) => w.includes('No search-appearance'))).toBe(true);
  });

  it('enumerates types first, then issues one filtered query per type', async () => {
    const APPEARANCE: FixtureRow[] = [
      { keys: ['RICH_SNIPPET'], clicks: 2, impressions: 40, ctr: 0.05, position: 4 }
    ];
    const { api, queryMock } = createApi((body) =>
      body.dimensions.join() === 'searchAppearance' ? APPEARANCE : PAGE_ROWS
    );
    const result = await api.searchAppearance({ ...WINDOW, dimensions: ['page'] });

    expect(result.appearance_types).toHaveLength(1);
    expect(result.breakdowns).toHaveLength(1);
    expect(result.breakdowns[0].appearance_type).toBe('RICH_SNIPPET');
    const filteredCall = queryMock.mock.calls
      .map((c) => c[0] as MockRequest)
      .find((r) => (r.requestBody as unknown as { dimensionFilterGroups?: unknown }).dimensionFilterGroups);
    expect(filteredCall).toBeDefined();
  });
});
