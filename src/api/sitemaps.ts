import type { GSCClient } from './client.js';
import { SitesApi } from './sites.js';
import { CACHE_TTL } from '../cache/cache.js';
import { resolveSiteUrl } from '../utils/site-url.js';
import type {
  Sitemap,
  SitemapsListResponse,
  SitemapQuery,
  IndexCoverageQuery,
  IndexCoverageResponse
} from '../types/index.js';

export class SitemapsApi {
  private client: GSCClient;
  private sitesApi: SitesApi;

  constructor(client: GSCClient) {
    this.client = client;
    this.sitesApi = new SitesApi(client);
  }

  async listSitemaps(siteUrl: string): Promise<SitemapsListResponse> {
    // Resolve user input to actual GSC property
    const resolvedSiteUrl = await resolveSiteUrl(this.sitesApi, siteUrl);

    const cache = this.client.getCache();
    const cacheKey = cache.generateKey('sitemaps', { siteUrl: resolvedSiteUrl });

    // Check cache
    const cached = cache.get<SitemapsListResponse>(cacheKey);
    if (cached) {
      return cached;
    }

    // Fetch from API
    const result = await this.client.withRetry(async () => {
      const response = await this.client.getSearchConsole().sitemaps.list({
        siteUrl: resolvedSiteUrl
      });
      return response.data;
    }, 'sitemaps.list');

    const sitemaps: Sitemap[] = (result.sitemap || []).map((sitemap) => ({
      path: sitemap.path || '',
      lastSubmitted: sitemap.lastSubmitted || '',
      isPending: sitemap.isPending || false,
      isSitemapsIndex: sitemap.isSitemapsIndex || false,
      lastDownloaded: sitemap.lastDownloaded || undefined,
      warnings: typeof sitemap.warnings === 'string' ? parseInt(sitemap.warnings, 10) : (sitemap.warnings || 0),
      errors: typeof sitemap.errors === 'string' ? parseInt(sitemap.errors, 10) : (sitemap.errors || 0),
      contents: (sitemap.contents || []).map((content) => ({
        type: content.type as Sitemap['contents'][0]['type'],
        submitted: parseInt(content.submitted || '0', 10),
        indexed: parseInt(content.indexed || '0', 10)
      }))
    }));

    const response: SitemapsListResponse = { sitemap: sitemaps };

    // Cache the result
    cache.set(cacheKey, response, CACHE_TTL.SITEMAPS);

    return response;
  }

  async getSitemap(siteUrl: string, sitemapUrl: string): Promise<Sitemap | null> {
    const { sitemap: sitemaps } = await this.listSitemaps(siteUrl);
    return sitemaps.find((s) => s.path === sitemapUrl) || null;
  }

  async submitSitemap(params: SitemapQuery): Promise<{ success: boolean; message: string }> {
    try {
      // Resolve user input to actual GSC property
      const resolvedSiteUrl = await resolveSiteUrl(this.sitesApi, params.siteUrl);

      await this.client.withRetry(async () => {
        await this.client.getSearchConsole().sitemaps.submit({
          siteUrl: resolvedSiteUrl,
          feedpath: params.sitemapUrl
        });
      }, 'sitemaps.submit');

      // Invalidate cache
      const cache = this.client.getCache();
      const cacheKey = cache.generateKey('sitemaps', { siteUrl: resolvedSiteUrl });
      cache.delete(cacheKey);

      return {
        success: true,
        message: `Sitemap ${params.sitemapUrl} submitted successfully`
      };
    } catch (error) {
      return {
        success: false,
        message: `Failed to submit sitemap: ${error instanceof Error ? error.message : String(error)}`
      };
    }
  }

  async deleteSitemap(params: SitemapQuery): Promise<{ success: boolean; message: string }> {
    try {
      // Resolve user input to actual GSC property
      const resolvedSiteUrl = await resolveSiteUrl(this.sitesApi, params.siteUrl);

      await this.client.withRetry(async () => {
        await this.client.getSearchConsole().sitemaps.delete({
          siteUrl: resolvedSiteUrl,
          feedpath: params.sitemapUrl
        });
      }, 'sitemaps.delete');

      // Invalidate cache
      const cache = this.client.getCache();
      const cacheKey = cache.generateKey('sitemaps', { siteUrl: resolvedSiteUrl });
      cache.delete(cacheKey);

      return {
        success: true,
        message: `Sitemap ${params.sitemapUrl} deleted successfully`
      };
    } catch (error) {
      return {
        success: false,
        message: `Failed to delete sitemap: ${error instanceof Error ? error.message : String(error)}`
      };
    }
  }

  async getIndexCoverage(params: IndexCoverageQuery): Promise<IndexCoverageResponse> {
    // Get sitemap data
    const sitemapsResponse = await this.listSitemaps(params.siteUrl);

    let totalUrls = 0;
    let indexed = 0;
    const exclusionReasons: Record<string, number> = {};

    // Filter by specific sitemap if provided
    const sitemaps = params.sitemapUrl
      ? sitemapsResponse.sitemap.filter((s) => s.path === params.sitemapUrl)
      : sitemapsResponse.sitemap;

    for (const sitemap of sitemaps) {
      for (const content of sitemap.contents) {
        totalUrls += content.submitted;
        indexed += content.indexed;
      }

      if (sitemap.errors > 0) {
        exclusionReasons['sitemapErrors'] = (exclusionReasons['sitemapErrors'] || 0) + sitemap.errors;
      }

      if (sitemap.warnings > 0) {
        exclusionReasons['sitemapWarnings'] = (exclusionReasons['sitemapWarnings'] || 0) + sitemap.warnings;
      }
    }

    const excluded = totalUrls - indexed;

    return {
      summary: {
        totalUrls,
        indexed,
        excluded,
        error: exclusionReasons['sitemapErrors'] || 0
      },
      exclusionReasons
    };
  }

  async getSitemapHealth(siteUrl: string): Promise<{
    totalSitemaps: number;
    indexSitemaps: number;
    totalUrls: number;
    indexedUrls: number;
    indexRate: number;
    issues: Array<{ sitemap: string; type: 'error' | 'warning'; count: number }>;
  }> {
    const { sitemap: sitemaps } = await this.listSitemaps(siteUrl);

    let totalUrls = 0;
    let indexedUrls = 0;
    const issues: Array<{ sitemap: string; type: 'error' | 'warning'; count: number }> = [];

    for (const sitemap of sitemaps) {
      for (const content of sitemap.contents) {
        totalUrls += content.submitted;
        indexedUrls += content.indexed;
      }

      if (sitemap.errors > 0) {
        issues.push({
          sitemap: sitemap.path,
          type: 'error',
          count: sitemap.errors
        });
      }

      if (sitemap.warnings > 0) {
        issues.push({
          sitemap: sitemap.path,
          type: 'warning',
          count: sitemap.warnings
        });
      }
    }

    return {
      totalSitemaps: sitemaps.length,
      indexSitemaps: sitemaps.filter((s) => s.isSitemapsIndex).length,
      totalUrls,
      indexedUrls,
      indexRate: totalUrls > 0 ? (indexedUrls / totalUrls) * 100 : 0,
      issues
    };
  }
}
