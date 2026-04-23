import type { SearchAnalyticsRow, Site, Sitemap, InspectionResult } from '../../src/types/index.js';

// Sites API responses
export const mockSites: Site[] = [
  { siteUrl: 'sc-domain:example.com', permissionLevel: 'siteOwner' },
  { siteUrl: 'https://example.com/', permissionLevel: 'siteFullUser' },
  { siteUrl: 'https://test.example.com/', permissionLevel: 'siteRestrictedUser' }
];

// Search Analytics responses
export const mockSearchAnalyticsRows: SearchAnalyticsRow[] = [
  { keys: ['test query'], clicks: 100, impressions: 1000, ctr: 0.1, position: 5.2 },
  { keys: ['another query'], clicks: 50, impressions: 500, ctr: 0.1, position: 3.1 },
  { keys: ['low ctr query'], clicks: 5, impressions: 1000, ctr: 0.005, position: 2.0 },
  { keys: ['striking distance'], clicks: 30, impressions: 400, ctr: 0.075, position: 6.5 }
];

export const mockSearchAnalyticsWithDimensions: SearchAnalyticsRow[] = [
  { keys: ['query1', 'https://example.com/page1'], clicks: 100, impressions: 1000, ctr: 0.1, position: 5.2 },
  { keys: ['query1', 'https://example.com/page2'], clicks: 50, impressions: 500, ctr: 0.1, position: 8.1 }
];

export const mockEmptySearchAnalytics: SearchAnalyticsRow[] = [];

// Sitemap responses
export const mockSitemaps: Sitemap[] = [
  {
    path: 'https://example.com/sitemap.xml',
    lastSubmitted: '2024-01-15T10:00:00Z',
    isPending: false,
    isSitemapsIndex: true,
    lastDownloaded: '2024-01-15T09:00:00Z',
    warnings: 0,
    errors: 0,
    contents: [
      { type: 'web', submitted: 100, indexed: 95 }
    ]
  },
  {
    path: 'https://example.com/sitemap-posts.xml',
    lastSubmitted: '2024-01-15T10:00:00Z',
    isPending: false,
    isSitemapsIndex: false,
    warnings: 2,
    errors: 0,
    contents: [
      { type: 'web', submitted: 50, indexed: 45 }
    ]
  }
];

// URL Inspection responses
export const mockInspectionResultPass: InspectionResult = {
  inspectionResultLink: 'https://search.google.com/search-console/inspect?resource_id=example.com',
  indexStatusResult: {
    verdict: 'PASS',
    coverageState: 'Submitted and indexed',
    robotsTxtState: 'ALLOWED',
    indexingState: 'INDEXING_ALLOWED',
    lastCrawlTime: '2024-01-15T08:00:00Z',
    pageFetchState: 'SUCCESSFUL',
    googleCanonical: 'https://example.com/page',
    crawledAs: 'MOBILE'
  },
  mobileUsabilityResult: {
    verdict: 'PASS',
    issues: []
  }
};

export const mockInspectionResultFail: InspectionResult = {
  inspectionResultLink: 'https://search.google.com/search-console/inspect?resource_id=example.com',
  indexStatusResult: {
    verdict: 'FAIL',
    coverageState: 'Crawled - currently not indexed',
    robotsTxtState: 'ALLOWED',
    indexingState: 'INDEXING_ALLOWED',
    lastCrawlTime: '2024-01-10T08:00:00Z',
    pageFetchState: 'SOFT_404',
    crawledAs: 'DESKTOP'
  },
  mobileUsabilityResult: {
    verdict: 'FAIL',
    issues: [
      { issueType: 'VIEWPORT_NOT_SET', severity: 'ERROR', message: 'Viewport not set' }
    ]
  }
};

// OAuth tokens. Expiry values are absolute epoch ms chosen to be unambiguously
// valid / expired across any sane fake system time. Tests use vi.setSystemTime
// with fixed dates, so Date.now() at module load is NOT reliable here.
const FAR_FUTURE = 32503680000000; // year 3000
// 1 ms past epoch. We intentionally don't use 0 — the `expiry_date && ...`
// truthy-check in OAuthManager.isAuthenticated would treat 0 as "no expiry set".
const FAR_PAST = 1;

export const mockTokens = {
  access_token: 'test-access-token',
  refresh_token: 'test-refresh-token',
  scope: 'https://www.googleapis.com/auth/webmasters',
  token_type: 'Bearer',
  expiry_date: FAR_FUTURE
};

export const mockExpiredTokens = {
  ...mockTokens,
  expiry_date: FAR_PAST
};
