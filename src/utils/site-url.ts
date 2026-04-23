import type { SitesApi } from '../api/sites.js';
import { GSCApiError } from '../types/index.js';
import { getGlobalLogger } from './logger.js';

/**
 * Resolve a user-provided URL to a verified GSC property.
 * Handles cases like:
 *   "example.com" -> "sc-domain:example.com" or "https://example.com/"
 *   "https://example.com" -> "https://example.com/"
 */
export async function resolveSiteUrl(
  sitesApi: SitesApi,
  userInput: string
): Promise<string> {
  const logger = getGlobalLogger();
  const { sites } = await sitesApi.listSites();

  // 1. Exact match - return as-is
  const exactMatch = sites.find((s) => s.siteUrl === userInput);
  if (exactMatch) {
    logger.debug('Site URL exact match', { input: userInput });
    return exactMatch.siteUrl;
  }

  // 2. Normalize input and try again
  const normalized = normalizeSiteUrl(userInput);
  const normalizedMatch = sites.find((s) => s.siteUrl === normalized);
  if (normalizedMatch) {
    logger.debug('Site URL normalized match', { input: userInput, resolved: normalizedMatch.siteUrl });
    return normalizedMatch.siteUrl;
  }

  // 3. Try sc-domain: prefix
  const domainMatch = sites.find((s) => s.siteUrl === `sc-domain:${userInput}`);
  if (domainMatch) {
    logger.debug('Site URL domain property match', { input: userInput, resolved: domainMatch.siteUrl });
    return domainMatch.siteUrl;
  }

  // 4. Fuzzy match - extract domain and find any matching property
  // Prefer domain properties (sc-domain:) over URL prefix properties for complete data
  const inputDomain = extractDomain(userInput);
  const matchingSites = sites.filter((s) => {
    const siteDomain = extractDomain(s.siteUrl);
    return siteDomain === inputDomain;
  });

  if (matchingSites.length > 0) {
    // Prefer domain property if available
    const domainProperty = matchingSites.find((s) => s.siteUrl.startsWith('sc-domain:'));
    const urlPrefixProperty = matchingSites.find((s) => !s.siteUrl.startsWith('sc-domain:'));

    if (domainProperty) {
      logger.debug('Site URL fuzzy match (domain property)', { input: userInput, resolved: domainProperty.siteUrl });
      return domainProperty.siteUrl;
    }

    if (urlPrefixProperty) {
      // Warn user that a domain property would give more complete data
      logger.warn(
        `Using URL prefix property "${urlPrefixProperty.siteUrl}". ` +
        `For more complete data (including www, http, and subdomain traffic), ` +
        `add domain property "sc-domain:${inputDomain}" in Google Search Console.`
      );
      return urlPrefixProperty.siteUrl;
    }
  }

  // 5. No match - throw helpful error
  const availableSites = sites.map((s) => s.siteUrl);
  logger.warn('Site URL not found', { input: userInput, availableSites });

  throw new GSCApiError({
    code: 'SITE_NOT_FOUND',
    message: `Site "${userInput}" not found. Available sites: ${availableSites.join(', ')}`,
    details: { providedUrl: userInput, availableSites }
  });
}

/**
 * Extract the domain from a URL or sc-domain: property
 */
function extractDomain(url: string): string {
  if (url.startsWith('sc-domain:')) {
    return url.replace('sc-domain:', '').toLowerCase();
  }
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    // Fallback: strip protocol and path
    return url
      .toLowerCase()
      .replace(/^https?:\/\//, '')
      .replace(/\/.*$/, '');
  }
}

/**
 * Normalize a URL to the format GSC expects
 */
export function normalizeSiteUrl(url: string): string {
  // Already a domain property
  if (url.startsWith('sc-domain:')) {
    return url;
  }

  try {
    // Add protocol if missing
    const urlWithProtocol = url.includes('://') ? url : `https://${url}`;
    const parsed = new URL(urlWithProtocol);

    // URL properties need trailing slash
    if (parsed.pathname === '' || parsed.pathname === '/') {
      return `${parsed.protocol}//${parsed.host}/`;
    }

    return urlWithProtocol;
  } catch {
    return url;
  }
}
