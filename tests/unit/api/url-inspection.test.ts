/**
 * Regression: gsc_inspect_url crashed with MCP -32602 ("Structured content does not
 * match the tool's output schema") when Google returned a verdict outside the old
 * PASS/NEUTRAL/FAIL enum (reproduced live with mobileUsabilityResult.verdict on
 * https://seobandwagon.com/seo-services). Unknown enum values must pass through.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { UrlInspectionApi } from '../../../src/api/url-inspection.js';

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

const inspectMock = vi.fn();

const mockClient = {
  getSearchConsole: vi.fn(() => ({ urlInspection: { index: { inspect: inspectMock } } })),
  withRetry: vi.fn(async (operation: () => Promise<unknown>) => operation()),
  getCache: vi.fn(() => ({ get: vi.fn(), set: vi.fn(), generateKey: vi.fn(() => 'k') }))
};

describe('UrlInspectionApi verdict passthrough', () => {
  let api: UrlInspectionApi;

  beforeEach(() => {
    vi.clearAllMocks();
    api = new UrlInspectionApi(mockClient as never);
  });

  it('passes unknown verdict values through verbatim instead of crashing or coercing', async () => {
    inspectMock.mockResolvedValue({
      data: {
        inspectionResult: {
          inspectionResultLink: 'https://search.google.com/search-console/inspect?x=1',
          indexStatusResult: {
            verdict: 'PASS',
            coverageState: 'Submitted and indexed',
            robotsTxtState: 'ALLOWED',
            indexingState: 'INDEXING_ALLOWED',
            pageFetchState: 'SUCCESSFUL'
          },
          mobileUsabilityResult: {
            // The live crash: a value outside the old PASS/NEUTRAL/FAIL enum.
            verdict: 'VERDICT_UNSPECIFIED',
            issues: []
          },
          richResultsResult: {
            verdict: 'PARTIAL',
            detectedItems: []
          }
        }
      }
    });

    const result = await api.inspectUrl({
      siteUrl: 'sc-domain:example.com',
      inspectionUrl: 'https://example.com/seo-services'
    });

    expect(result.inspectionResult.mobileUsabilityResult?.verdict).toBe('VERDICT_UNSPECIFIED');
    expect(result.inspectionResult.richResultsResult?.verdict).toBe('PARTIAL');
    expect(result.inspectionResult.indexStatusResult.verdict).toBe('PASS');
  });

  it("uses the documented 'UNKNOWN' fallback only for genuinely missing fields", async () => {
    inspectMock.mockResolvedValue({
      data: {
        inspectionResult: {
          indexStatusResult: {}
        }
      }
    });

    const result = await api.inspectUrl({
      siteUrl: 'sc-domain:example.com',
      inspectionUrl: 'https://example.com/'
    });

    const status = result.inspectionResult.indexStatusResult;
    expect(status.verdict).toBe('UNKNOWN');
    expect(status.robotsTxtState).toBe('UNKNOWN');
    expect(status.indexingState).toBe('UNKNOWN');
    expect(status.pageFetchState).toBe('UNKNOWN');
  });
});
