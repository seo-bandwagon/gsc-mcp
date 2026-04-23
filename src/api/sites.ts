import type { GSCClient } from './client.js';
import { CACHE_TTL } from '../cache/cache.js';
import type { Site, SitesListResponse } from '../types/index.js';

export class SitesApi {
  private client: GSCClient;

  constructor(client: GSCClient) {
    this.client = client;
  }

  async listSites(): Promise<SitesListResponse> {
    const cache = this.client.getCache();
    const cacheKey = 'sites:list';

    // Check cache
    const cached = cache.get<SitesListResponse>(cacheKey);
    if (cached) {
      return cached;
    }

    // Fetch from API
    const result = await this.client.withRetry(async () => {
      const response = await this.client.getSearchConsole().sites.list();
      return response.data;
    }, 'sites.list');

    const sites: Site[] = (result.siteEntry || []).map((entry) => ({
      siteUrl: entry.siteUrl!,
      permissionLevel: entry.permissionLevel as Site['permissionLevel']
    }));

    const response: SitesListResponse = { sites };

    // Cache the result
    cache.set(cacheKey, response, CACHE_TTL.SITES);

    return response;
  }

  async getSite(siteUrl: string): Promise<Site | null> {
    const { sites } = await this.listSites();
    return sites.find((site) => site.siteUrl === siteUrl) || null;
  }

  async verifySiteAccess(siteUrl: string): Promise<boolean> {
    const site = await this.getSite(siteUrl);
    return site !== null;
  }

  normalizeSiteUrl(url: string): string {
    // Ensure URL ends with trailing slash for domain properties
    // and uses proper format for sc-domain: properties
    if (url.startsWith('sc-domain:')) {
      return url;
    }

    try {
      const parsed = new URL(url);
      // Ensure trailing slash for domain-level properties
      if (parsed.pathname === '' || parsed.pathname === '/') {
        return `${parsed.protocol}//${parsed.host}/`;
      }
      return url;
    } catch {
      return url;
    }
  }
}
