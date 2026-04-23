import type { Tool, ToolHandler } from './types.js';
import { ok } from './types.js';
import type { SearchAnalyticsApi } from '../api/search-analytics.js';
import { handleToolError } from '../utils/errors.js';
import {
  SearchAnalyticsQuerySchema,
  ComparePeriodsQuerySchema,
  TopQueriesQuerySchema,
  TopPagesQuerySchema
} from '../types/index.js';

const SEARCH_TYPE_ENUM = ['web', 'image', 'video', 'news', 'discover', 'googleNews'];
const DIMENSION_ENUM = ['query', 'page', 'country', 'device', 'searchAppearance', 'date'];
const METRIC_ENUM = ['clicks', 'impressions', 'ctr', 'position'];

/** Shared shape of a search analytics row in output schemas. */
const SEARCH_ANALYTICS_ROW = {
  type: 'object',
  properties: {
    keys: { type: 'array', items: { type: 'string' } },
    clicks: { type: 'number' },
    impressions: { type: 'number' },
    ctr: { type: 'number' },
    position: { type: 'number' }
  },
  required: ['keys', 'clicks', 'impressions', 'ctr', 'position']
} as const;

const PERIOD_METRICS = {
  type: 'object',
  properties: {
    clicks: { type: 'number' },
    impressions: { type: 'number' },
    ctr: { type: 'number' },
    position: { type: 'number' }
  },
  required: ['clicks', 'impressions', 'ctr', 'position']
} as const;

const METRIC_CHANGE = {
  type: 'object',
  properties: {
    absolute: { type: 'number' },
    percentage: { type: 'number' }
  },
  required: ['absolute', 'percentage']
} as const;

const CHANGES_BLOCK = {
  type: 'object',
  properties: {
    clicks: METRIC_CHANGE,
    impressions: METRIC_CHANGE,
    ctr: METRIC_CHANGE,
    position: METRIC_CHANGE
  },
  required: ['clicks', 'impressions', 'ctr', 'position']
} as const;

export function createAnalyticsTools(searchAnalyticsApi: SearchAnalyticsApi): { tools: Tool[]; handlers: Map<string, ToolHandler> } {
  const handlers = new Map<string, ToolHandler>();

  const tools: Tool[] = [
    {
      name: 'gsc_search_analytics',
      description: 'Query Google Search Console performance data with flexible filtering and grouping. Returns clicks, impressions, CTR, and average position.',
      inputSchema: {
        type: 'object',
        properties: {
          siteUrl: { type: 'string', description: 'The verified property URL (e.g. "https://example.com/" or "sc-domain:example.com"). Must match a property returned by gsc_list_sites.' },
          startDate: { type: 'string', description: 'Start of date range in YYYY-MM-DD format.' },
          endDate: { type: 'string', description: 'End of date range in YYYY-MM-DD format. Inclusive.' },
          dimensions: {
            type: 'array',
            items: { type: 'string', enum: DIMENSION_ENUM },
            description: 'Dimensions to group results by. Combine to slice data (e.g. ["query","page"] for per-query-per-page rows).'
          },
          filters: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                dimension: { type: 'string', enum: DIMENSION_ENUM },
                operator: { type: 'string', enum: ['equals', 'notEquals', 'contains', 'notContains', 'includingRegex', 'excludingRegex'] },
                expression: { type: 'string' }
              },
              required: ['dimension', 'operator', 'expression']
            },
            description: 'Filters to narrow the query. Applied as AND.'
          },
          rowLimit: { type: 'number', description: 'Max rows to return. Default 1000, max 25000.' },
          startRow: { type: 'number', description: 'Row offset for pagination. Default 0.' },
          dataState: { type: 'string', enum: ['all', 'final'], description: 'Include fresh (all) or only finalized data. Default final.' },
          aggregationType: { type: 'string', enum: ['auto', 'byPage', 'byProperty'], description: 'How Google aggregates metrics. Default auto.' },
          type: { type: 'string', enum: SEARCH_TYPE_ENUM, description: 'Search surface to query. Default web.' }
        },
        required: ['siteUrl', 'startDate', 'endDate'],
        additionalProperties: false
      },
      outputSchema: {
        type: 'object',
        properties: {
          rows: { type: 'array', items: SEARCH_ANALYTICS_ROW },
          responseAggregationType: { type: 'string', enum: ['auto', 'byPage', 'byProperty'] }
        },
        required: ['rows', 'responseAggregationType']
      },
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true }
    },
    {
      name: 'gsc_compare_periods',
      description: 'Compare Search Console performance between two date ranges. Returns absolute + percentage deltas for clicks, impressions, CTR, and average position.',
      inputSchema: {
        type: 'object',
        properties: {
          siteUrl: { type: 'string', description: 'The verified property URL.' },
          period1Start: { type: 'string', description: 'First period start date (YYYY-MM-DD). Usually the earlier/baseline period.' },
          period1End: { type: 'string', description: 'First period end date (YYYY-MM-DD).' },
          period2Start: { type: 'string', description: 'Second period start date (YYYY-MM-DD). Usually the more recent period.' },
          period2End: { type: 'string', description: 'Second period end date (YYYY-MM-DD).' },
          dimensions: { type: 'array', items: { type: 'string', enum: DIMENSION_ENUM }, description: 'Optional grouping dimensions. Omit for property-level totals.' },
          filters: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                dimension: { type: 'string', enum: DIMENSION_ENUM },
                operator: { type: 'string', enum: ['equals', 'notEquals', 'contains', 'notContains', 'includingRegex', 'excludingRegex'] },
                expression: { type: 'string' }
              },
              required: ['dimension', 'operator', 'expression']
            }
          },
          type: { type: 'string', enum: SEARCH_TYPE_ENUM, description: 'Search surface to query. Default web.' }
        },
        required: ['siteUrl', 'period1Start', 'period1End', 'period2Start', 'period2End'],
        additionalProperties: false
      },
      outputSchema: {
        type: 'object',
        properties: {
          period1: PERIOD_METRICS,
          period2: PERIOD_METRICS,
          changes: CHANGES_BLOCK,
          rows: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                key: { type: 'string' },
                period1: PERIOD_METRICS,
                period2: PERIOD_METRICS,
                changes: CHANGES_BLOCK
              },
              required: ['key', 'period1', 'period2', 'changes']
            }
          }
        },
        required: ['period1', 'period2', 'changes']
      },
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true }
    },
    {
      name: 'gsc_top_queries',
      description: 'Get the top performing search queries for a property, optionally with a 7-day trend. Sorted by the chosen metric.',
      inputSchema: {
        type: 'object',
        properties: {
          siteUrl: { type: 'string', description: 'The verified property URL.' },
          startDate: { type: 'string', description: 'Start date (YYYY-MM-DD).' },
          endDate: { type: 'string', description: 'End date (YYYY-MM-DD).' },
          limit: { type: 'number', description: 'Max queries to return. Default 1000, max 25000.' },
          metric: { type: 'string', enum: METRIC_ENUM, description: 'Sort metric. Default clicks.' },
          includeTrend: { type: 'boolean', description: 'Include a 7-day daily trend per query. Default false.' },
          type: { type: 'string', enum: SEARCH_TYPE_ENUM, description: 'Search surface. Default web.' }
        },
        required: ['siteUrl', 'startDate', 'endDate'],
        additionalProperties: false
      },
      outputSchema: {
        type: 'object',
        properties: {
          rows: { type: 'array', items: SEARCH_ANALYTICS_ROW },
          responseAggregationType: { type: 'string' }
        }
      },
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true }
    },
    {
      name: 'gsc_top_pages',
      description: 'Get the top performing pages for a property, optionally with a per-page query breakdown. Sorted by the chosen metric.',
      inputSchema: {
        type: 'object',
        properties: {
          siteUrl: { type: 'string', description: 'The verified property URL.' },
          startDate: { type: 'string', description: 'Start date (YYYY-MM-DD).' },
          endDate: { type: 'string', description: 'End date (YYYY-MM-DD).' },
          limit: { type: 'number', description: 'Max pages to return. Default 1000, max 25000.' },
          metric: { type: 'string', enum: METRIC_ENUM, description: 'Sort metric. Default clicks.' },
          includeQueryBreakdown: { type: 'boolean', description: 'Include top queries per page. Default false.' },
          type: { type: 'string', enum: SEARCH_TYPE_ENUM, description: 'Search surface. Default web.' }
        },
        required: ['siteUrl', 'startDate', 'endDate'],
        additionalProperties: false
      },
      outputSchema: {
        type: 'object',
        properties: {
          rows: { type: 'array', items: SEARCH_ANALYTICS_ROW },
          responseAggregationType: { type: 'string' }
        }
      },
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true }
    }
  ];

  handlers.set('gsc_search_analytics', async (args) => {
    try {
      const params = SearchAnalyticsQuerySchema.parse(args);
      return ok(await searchAnalyticsApi.query(params));
    } catch (error) {
      return handleToolError(error);
    }
  });

  handlers.set('gsc_compare_periods', async (args) => {
    try {
      const params = ComparePeriodsQuerySchema.parse(args);
      return ok(await searchAnalyticsApi.comparePeriods(params));
    } catch (error) {
      return handleToolError(error);
    }
  });

  handlers.set('gsc_top_queries', async (args) => {
    try {
      const params = TopQueriesQuerySchema.parse(args);
      return ok(await searchAnalyticsApi.topQueries(params));
    } catch (error) {
      return handleToolError(error);
    }
  });

  handlers.set('gsc_top_pages', async (args) => {
    try {
      const params = TopPagesQuerySchema.parse(args);
      return ok(await searchAnalyticsApi.topPages(params));
    } catch (error) {
      return handleToolError(error);
    }
  });

  return { tools, handlers };
}
