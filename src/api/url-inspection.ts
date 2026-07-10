import type { GSCClient } from './client.js';
import { SitesApi } from './sites.js';
import { CACHE_TTL } from '../cache/cache.js';
import { resolveSiteUrl } from '../utils/site-url.js';
import type {
  InspectUrlQuery,
  BulkInspectQuery,
  UrlInspectionResponse,
  InspectionResult
} from '../types/index.js';

export class UrlInspectionApi {
  private client: GSCClient;
  private sitesApi: SitesApi;

  constructor(client: GSCClient) {
    this.client = client;
    this.sitesApi = new SitesApi(client);
  }

  async inspectUrl(params: InspectUrlQuery): Promise<UrlInspectionResponse> {
    // Resolve user input to actual GSC property
    const resolvedSiteUrl = await resolveSiteUrl(this.sitesApi, params.siteUrl);

    const cache = this.client.getCache();
    const cacheKey = cache.generateKey('urlInspection', { ...params, siteUrl: resolvedSiteUrl });

    // Check cache
    const cached = cache.get<UrlInspectionResponse>(cacheKey);
    if (cached) {
      return cached;
    }

    // Fetch from API
    const result = await this.client.withRetry(async () => {
      const response = await this.client.getSearchConsole().urlInspection.index.inspect({
        requestBody: {
          inspectionUrl: params.inspectionUrl,
          siteUrl: resolvedSiteUrl
        }
      });
      return response.data;
    }, 'urlInspection.inspect');

    const inspectionResult = result.inspectionResult;

    // Google's enums change over time (e.g. VERDICT_UNSPECIFIED, PARTIAL show up in live
    // responses). Values pass through verbatim; only genuinely missing fields get the
    // documented 'UNKNOWN' fallback. Never coerce unknown values into known ones — a
    // fabricated 'NEUTRAL' is worse than an honest unknown.
    const response: UrlInspectionResponse = {
      inspectionResult: {
        inspectionResultLink: inspectionResult?.inspectionResultLink || '',
        indexStatusResult: {
          verdict: inspectionResult?.indexStatusResult?.verdict || 'UNKNOWN',
          coverageState: inspectionResult?.indexStatusResult?.coverageState || 'UNKNOWN',
          robotsTxtState: inspectionResult?.indexStatusResult?.robotsTxtState || 'UNKNOWN',
          indexingState: inspectionResult?.indexStatusResult?.indexingState || 'UNKNOWN',
          lastCrawlTime: inspectionResult?.indexStatusResult?.lastCrawlTime || undefined,
          pageFetchState: inspectionResult?.indexStatusResult?.pageFetchState || 'UNKNOWN',
          googleCanonical: inspectionResult?.indexStatusResult?.googleCanonical || undefined,
          userCanonical: inspectionResult?.indexStatusResult?.userCanonical || undefined,
          referringUrls: inspectionResult?.indexStatusResult?.referringUrls || undefined,
          crawledAs: inspectionResult?.indexStatusResult?.crawledAs || undefined
        },
        mobileUsabilityResult: inspectionResult?.mobileUsabilityResult
          ? {
              verdict: inspectionResult.mobileUsabilityResult.verdict || 'UNKNOWN',
              issues: (inspectionResult.mobileUsabilityResult.issues || []).map((issue) => ({
                issueType: issue.issueType || 'UNKNOWN',
                severity: issue.severity || 'UNKNOWN',
                message: issue.message || ''
              }))
            }
          : undefined,
        richResultsResult: inspectionResult?.richResultsResult
          ? {
              verdict: inspectionResult.richResultsResult.verdict || 'UNKNOWN',
              detectedItems: (inspectionResult.richResultsResult.detectedItems || []).map((item) => ({
                richResultType: item.richResultType || 'Unknown',
                items: (item.items || []).map((i) => ({ name: i.name || '' }))
              }))
            }
          : undefined
      }
    };

    // Cache the result
    cache.set(cacheKey, response, CACHE_TTL.URL_INSPECTION);

    return response;
  }

  async bulkInspect(params: BulkInspectQuery): Promise<{
    results: Array<{ url: string; result?: UrlInspectionResponse; error?: string }>;
    summary: { success: number; failed: number };
  }> {
    const results: Array<{ url: string; result?: UrlInspectionResponse; error?: string }> = [];
    let success = 0;
    let failed = 0;

    // Process URLs in batches to respect rate limits
    const batchSize = 10;
    for (let i = 0; i < params.urls.length; i += batchSize) {
      const batch = params.urls.slice(i, i + batchSize);

      const batchResults = await Promise.allSettled(
        batch.map((url) =>
          this.inspectUrl({
            siteUrl: params.siteUrl,
            inspectionUrl: url
          })
        )
      );

      for (let j = 0; j < batchResults.length; j++) {
        const url = batch[j];
        const result = batchResults[j];

        if (result.status === 'fulfilled') {
          results.push({ url, result: result.value });
          success++;
        } else {
          results.push({ url, error: result.reason?.message || 'Unknown error' });
          failed++;
        }
      }

      // Small delay between batches to be respectful of rate limits
      if (i + batchSize < params.urls.length) {
        await this.sleep(100);
      }
    }

    return {
      results,
      summary: { success, failed }
    };
  }

  async getIndexStatus(siteUrl: string, url: string): Promise<{
    isIndexed: boolean;
    status: string;
    lastCrawl?: string;
    issues: string[];
  }> {
    const inspection = await this.inspectUrl({
      siteUrl,
      inspectionUrl: url
    });

    const indexStatus = inspection.inspectionResult.indexStatusResult;
    const issues: string[] = [];

    // Check for various issues
    if (indexStatus.verdict === 'FAIL') {
      issues.push(`Index status: ${indexStatus.coverageState}`);
    }

    if (indexStatus.robotsTxtState === 'DISALLOWED') {
      issues.push('Blocked by robots.txt');
    }

    if (indexStatus.indexingState !== 'INDEXING_ALLOWED') {
      issues.push(`Indexing: ${indexStatus.indexingState}`);
    }

    if (indexStatus.pageFetchState !== 'SUCCESSFUL') {
      issues.push(`Page fetch: ${indexStatus.pageFetchState}`);
    }

    // Check mobile usability
    const mobileResult = inspection.inspectionResult.mobileUsabilityResult;
    if (mobileResult && mobileResult.verdict === 'FAIL') {
      for (const issue of mobileResult.issues) {
        issues.push(`Mobile: ${issue.message}`);
      }
    }

    return {
      isIndexed: indexStatus.verdict === 'PASS',
      status: indexStatus.coverageState,
      lastCrawl: indexStatus.lastCrawlTime,
      issues
    };
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
