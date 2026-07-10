/**
 * Regression: the old gsc_index_coverage tool fabricated an index-coverage report from
 * sitemap counts — including an `excluded` field (totalUrls − indexed) with no referent
 * in the API, and an `error` field that actually counted sitemap FILE errors. Verified
 * live: totalUrls 672 / indexed 133 / excluded 539 / error 2 on sc-domain:seobandwagon.com.
 *
 * gsc_sitemap_indexation_summary must report only API-traceable fields, surface
 * last_downloaded staleness, and never emit `excluded`.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SitemapsApi } from '../../../src/api/sitemaps.js';

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

// Mirrors the live property: Σ submitted = 672, Σ indexed = 133, two sitemap file errors,
// and two sitemaps whose files Google hasn't re-fetched since March.
const LIVE_SHAPED_SITEMAPS = [
  {
    path: 'https://example.com/sitemap.xml',
    lastSubmitted: '2026-04-13T17:33:49.994Z',
    isPending: false,
    isSitemapsIndex: false,
    lastDownloaded: '2026-07-02T22:27:43.550Z',
    warnings: '1',
    errors: '0',
    contents: [
      { type: 'web', submitted: '201', indexed: '94' },
      { type: 'image', submitted: '0', indexed: '3' }
    ]
  },
  {
    path: 'https://example.com/post-sitemap.xml',
    lastSubmitted: '2026-02-23T17:19:17.710Z',
    isPending: false,
    isSitemapsIndex: false,
    lastDownloaded: '2026-03-15T02:54:45.186Z',
    warnings: '3',
    errors: '1',
    contents: [
      { type: 'web', submitted: '110', indexed: '0' },
      { type: 'image', submitted: '91', indexed: '0' }
    ]
  },
  {
    path: 'https://example.com/sitemap_index.xml',
    lastSubmitted: '2022-10-20T14:10:10.814Z',
    isPending: false,
    isSitemapsIndex: true,
    lastDownloaded: '2026-03-31T02:48:49.714Z',
    warnings: '8',
    errors: '1',
    contents: [
      { type: 'web', submitted: '110', indexed: '0' },
      { type: 'image', submitted: '91', indexed: '0' }
    ]
  },
  {
    path: 'http://old.example.com/rss',
    lastSubmitted: '2014-05-27T20:08:45.579Z',
    isPending: false,
    isSitemapsIndex: false,
    lastDownloaded: '2025-01-14T13:02:12.893Z',
    warnings: '3',
    errors: '0',
    contents: [{ type: 'web', submitted: '21', indexed: '1' }]
  },
  {
    path: 'http://old.example.com/sitemap1.xml',
    lastSubmitted: '2014-05-27T20:08:45.579Z',
    isPending: false,
    isSitemapsIndex: false,
    lastDownloaded: '2025-01-19T03:28:46.444Z',
    warnings: '2',
    errors: '0',
    contents: [{ type: 'web', submitted: '48', indexed: '35' }]
  }
];

const listMock = vi.fn().mockResolvedValue({ data: { sitemap: LIVE_SHAPED_SITEMAPS } });

const cacheStore = new Map<string, unknown>();
const mockClient = {
  getSearchConsole: vi.fn(() => ({ sitemaps: { list: listMock } })),
  withRetry: vi.fn(async (operation: () => Promise<unknown>) => operation()),
  getCache: vi.fn(() => ({
    get: vi.fn((k: string) => cacheStore.get(k)),
    set: vi.fn((k: string, v: unknown) => cacheStore.set(k, v)),
    delete: vi.fn((k: string) => cacheStore.delete(k)),
    generateKey: vi.fn((ns: string) => ns)
  }))
};

describe('getSitemapIndexationSummary', () => {
  let api: SitemapsApi;

  beforeEach(() => {
    vi.clearAllMocks();
    cacheStore.clear();
    api = new SitemapsApi(mockClient as never);
  });

  it('sums only API-reported fields: 672 submitted, 133 indexed, 2 file errors', async () => {
    const result = await api.getSitemapIndexationSummary({ siteUrl: 'sc-domain:example.com' });

    expect(result.summary.submitted_urls).toBe(672);
    expect(result.summary.indexed_urls).toBe(133);
    expect(result.summary.sitemap_file_errors).toBe(2);
    expect(result.summary.sitemap_file_warnings).toBe(17);
  });

  it("never emits the fabricated 'excluded' field (or the old field names)", async () => {
    const result = await api.getSitemapIndexationSummary({ siteUrl: 'sc-domain:example.com' });
    const summaryKeys = Object.keys(result.summary);

    expect(summaryKeys).not.toContain('excluded');
    expect(summaryKeys).not.toContain('error');
    expect(summaryKeys).not.toContain('totalUrls');
    expect(Object.keys(result)).not.toContain('exclusionReasons');
  });

  it('surfaces last_downloaded per sitemap and the oldest as the staleness bound', async () => {
    const result = await api.getSitemapIndexationSummary({ siteUrl: 'sc-domain:example.com' });

    const postSitemap = result.sitemaps.find((s) => s.path.includes('post-sitemap'));
    expect(postSitemap?.last_downloaded).toBe('2026-03-15T02:54:45.186Z');
    expect(result.summary.oldest_last_downloaded).toBe('2025-01-14T13:02:12.893Z');
    expect(result.warnings.some((w) => w.includes('Stale'))).toBe(true);
  });

  it('filters to a single sitemap when requested and warns on no match', async () => {
    const single = await api.getSitemapIndexationSummary({
      siteUrl: 'sc-domain:example.com',
      sitemapUrl: 'https://example.com/sitemap.xml'
    });
    expect(single.summary.submitted_urls).toBe(201);
    expect(single.summary.indexed_urls).toBe(97);

    const missing = await api.getSitemapIndexationSummary({
      siteUrl: 'sc-domain:example.com',
      sitemapUrl: 'https://example.com/nope.xml'
    });
    expect(missing.sitemaps).toHaveLength(0);
    expect(missing.warnings.some((w) => w.includes('No submitted sitemap matches'))).toBe(true);
  });
});
