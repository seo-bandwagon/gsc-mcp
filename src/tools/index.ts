import type { GSCClient } from '../api/client.js';
import { SitesApi } from '../api/sites.js';
import { SearchAnalyticsApi } from '../api/search-analytics.js';
import { UrlInspectionApi } from '../api/url-inspection.js';
import { SitemapsApi } from '../api/sitemaps.js';
import { AnalysisApi } from '../api/analysis.js';

import { createSitesTools } from './sites.js';
import { createAnalyticsTools } from './analytics.js';
import { createInspectionTools } from './inspection.js';
import { createSitemapsTools } from './sitemaps.js';
import { createAnalysisTools } from './analysis.js';
import { createCacheTools } from './cache.js';

export type { Tool, ToolHandler, ToolAnnotations } from './types.js';

export function createTools(client: GSCClient): { tools: import('./types.js').Tool[]; handlers: Map<string, import('./types.js').ToolHandler> } {
  // Initialize API clients
  const sitesApi = new SitesApi(client);
  const searchAnalyticsApi = new SearchAnalyticsApi(client);
  const urlInspectionApi = new UrlInspectionApi(client);
  const sitemapsApi = new SitemapsApi(client);
  const analysisApi = new AnalysisApi(client);

  // Create tools for each domain
  const sites = createSitesTools(sitesApi);
  const analytics = createAnalyticsTools(searchAnalyticsApi);
  const inspection = createInspectionTools(urlInspectionApi);
  const sitemaps = createSitemapsTools(sitemapsApi);
  const analysis = createAnalysisTools(analysisApi);
  const cache = createCacheTools(client);

  // Combine all tools
  const tools = [
    ...sites.tools,
    ...analytics.tools,
    ...inspection.tools,
    ...sitemaps.tools,
    ...analysis.tools,
    ...cache.tools
  ];

  // Combine all handlers
  const handlers = new Map<string, import('./types.js').ToolHandler>();

  for (const [name, handler] of sites.handlers) {
    handlers.set(name, handler);
  }
  for (const [name, handler] of analytics.handlers) {
    handlers.set(name, handler);
  }
  for (const [name, handler] of inspection.handlers) {
    handlers.set(name, handler);
  }
  for (const [name, handler] of sitemaps.handlers) {
    handlers.set(name, handler);
  }
  for (const [name, handler] of analysis.handlers) {
    handlers.set(name, handler);
  }
  for (const [name, handler] of cache.handlers) {
    handlers.set(name, handler);
  }

  return { tools, handlers };
}
