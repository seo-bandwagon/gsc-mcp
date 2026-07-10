import type { GSCClient } from './client.js';
import { SitesApi } from './sites.js';
import { CACHE_TTL } from '../cache/cache.js';
import { resolveSiteUrl } from '../utils/site-url.js';
import type {
  Sitemap,
  SitemapsListResponse,
  SitemapQuery,
  SitemapIndexationQuery,
  SitemapIndexationSummaryResponse,
  SitemapIndexationEntry
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

  /**
   * Summarize what the Sitemaps API reports about submitted vs indexed URL counts.
   *
   * Every number here traces to sitemaps.list. This is NOT the Search Console Index
   * Coverage report (the public API does not expose it); counts are only as fresh as
   * each sitemap's last_downloaded date, which is surfaced for exactly that reason.
   */
  async getSitemapIndexationSummary(params: SitemapIndexationQuery): Promise<SitemapIndexationSummaryResponse> {
    const sitemapsResponse = await this.listSitemaps(params.siteUrl);

    const sitemaps = params.sitemapUrl
      ? sitemapsResponse.sitemap.filter((s) => s.path === params.sitemapUrl)
      : sitemapsResponse.sitemap;

    const entries: SitemapIndexationEntry[] = sitemaps.map((sitemap) => ({
      path: sitemap.path,
      last_submitted: sitemap.lastSubmitted,
      last_downloaded: sitemap.lastDownloaded ?? null,
      is_pending: sitemap.isPending,
      is_sitemaps_index: sitemap.isSitemapsIndex,
      sitemap_file_errors: sitemap.errors,
      sitemap_file_warnings: sitemap.warnings,
      submitted_urls: sitemap.contents.reduce((s, c) => s + c.submitted, 0),
      indexed_urls: sitemap.contents.reduce((s, c) => s + c.indexed, 0),
      by_content_type: sitemap.contents
    }));

    const downloadedDates = entries.map((e) => e.last_downloaded).filter((d): d is string => d !== null);
    const oldestDownloaded = downloadedDates.length > 0 ? [...downloadedDates].sort()[0] : null;

    const warnings: string[] = [];
    if (params.sitemapUrl && entries.length === 0) {
      warnings.push(`No submitted sitemap matches ${params.sitemapUrl}. Use gsc_list_sitemaps to see what exists.`);
    }
    const staleCutoff = Date.now() - 30 * 86400000;
    const stale = entries.filter((e) => e.last_downloaded && Date.parse(e.last_downloaded) < staleCutoff);
    if (stale.length > 0) {
      warnings.push(
        `Stale counts: Google last fetched ${stale.map((e) => `${e.path} on ${e.last_downloaded!.slice(0, 10)}`).join('; ')}. ` +
        'Submitted/indexed counts for those sitemaps have not been refreshed since then.'
      );
    }

    return {
      summary: {
        submitted_urls: entries.reduce((s, e) => s + e.submitted_urls, 0),
        indexed_urls: entries.reduce((s, e) => s + e.indexed_urls, 0),
        sitemap_file_errors: entries.reduce((s, e) => s + e.sitemap_file_errors, 0),
        sitemap_file_warnings: entries.reduce((s, e) => s + e.sitemap_file_warnings, 0),
        oldest_last_downloaded: oldestDownloaded
      },
      sitemaps: entries,
      warnings
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
