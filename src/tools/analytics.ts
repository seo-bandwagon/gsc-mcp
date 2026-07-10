import type { Tool, ToolHandler } from './types.js';
import { okFormatted, err, RESPONSE_FORMAT_PROP } from './types.js';
import type { SearchAnalyticsApi } from '../api/search-analytics.js';
import { handleToolError } from '../utils/errors.js';
import { analyticsRowsTable, tableFromObjects, toMarkdown, warningsBlock } from '../utils/markdown.js';
import {
  ResponseFormatSchema,
  SearchAnalyticsQuerySchema,
  ComparePeriodsQuerySchema,
  TopQueriesQuerySchema,
  TopPagesQuerySchema,
  VerifyDataAvailabilityQuerySchema,
  AccurateTotalsQuerySchema,
  CoverageReportQuerySchema,
  SearchAppearanceQuerySchema,
  QueryPagePairsQuerySchema
} from '../types/index.js';
import type { SearchAnalyticsResponse, ResponseFormat } from '../types/index.js';

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
    position: { type: 'number' },
    sum_position: {
      type: 'number',
      description: 'Derived: impressions × position. Additive across any grouping — use it (÷ total impressions) to recombine average positions; never average `position` directly.'
    }
  },
  required: ['keys', 'clicks', 'impressions', 'ctr', 'position', 'sum_position']
} as const;

/** Response metadata every search-analytics-backed tool carries. */
const RESPONSE_META_PROPS = {
  aggregation_type: {
    type: 'string',
    enum: ['byPage', 'byProperty'],
    description: 'The unit Google counted impressions in. byPage counts are higher than byProperty for the same traffic — never compare across the two.'
  },
  count: { type: 'number', description: 'Rows in this response.' },
  total_count: { type: 'number', description: 'Total rows the API exposes for this query (present when the server paginated to completeness).' },
  has_more: { type: 'boolean' },
  next_offset: { type: 'number', description: 'startRow for the next page (present only when has_more).' },
  row_ceiling_reached: {
    type: 'boolean',
    description: "True when the pull hit Google's 50,000 rows/day/search-type ceiling. Rows beyond it were dropped by Google in click-descending order — the omitted rows are the lowest-click ones."
  },
  warnings: { type: 'array', items: { type: 'string' } }
} as const;

const REQUIRED_META = ['aggregation_type', 'count', 'has_more', 'row_ceiling_reached', 'warnings'] as const;

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

const READ_ANNOTATIONS = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true } as const;

const PREFLIGHT_NOTE =
  'Data lands ~2–3 days late; run gsc_verify_data_availability first to learn which dates are final.';

function parseFormat(args: Record<string, unknown>): ResponseFormat {
  return ResponseFormatSchema.parse(args.response_format ?? undefined);
}

function analyticsMarkdown(title: string, dimensions: string[]) {
  return (data: SearchAnalyticsResponse): string => {
    const completeness =
      data.total_count !== undefined
        ? `${data.count} of ${data.total_count} rows`
        : `${data.count} rows${data.has_more ? ` (more available, next_offset ${data.next_offset})` : ''}`;
    return (
      `## ${title}\n\n**Aggregation:** ${data.aggregation_type} · **Rows:** ${completeness}` +
      `${data.row_ceiling_reached ? ' · **ROW CEILING REACHED**' : ''}\n\n` +
      warningsBlock(data.warnings) +
      analyticsRowsTable(data.rows, dimensions)
    );
  };
}

export function createAnalyticsTools(searchAnalyticsApi: SearchAnalyticsApi): { tools: Tool[]; handlers: Map<string, ToolHandler> } {
  const handlers = new Map<string, ToolHandler>();

  const tools: Tool[] = [
    {
      name: 'gsc_search_analytics',
      description:
        'Query Search Console performance data with flexible filtering and grouping. Returns clicks, impressions, CTR, average position and additive sum_position per row, plus the effective aggregation_type. ' +
        'By default the server paginates internally and returns the COMPLETE row set; pass rowLimit/startRow only for manual paging. ' +
        'Grouping by query and/or page drops data (Google-side) — measure the loss with gsc_coverage_report and get exact totals with gsc_accurate_totals. ' +
        PREFLIGHT_NOTE,
      inputSchema: {
        type: 'object',
        properties: {
          siteUrl: { type: 'string', description: 'The verified property URL (e.g. "https://example.com/" or "sc-domain:example.com"). Must match a property returned by gsc_list_sites.' },
          startDate: { type: 'string', description: 'Start of date range in YYYY-MM-DD format.' },
          endDate: { type: 'string', description: 'End of date range in YYYY-MM-DD format. Inclusive.' },
          dimensions: {
            type: 'array',
            items: { type: 'string', enum: DIMENSION_ENUM },
            description: 'Dimensions to group results by. date/country/device are lossless; query and page cause Google to drop rows (see gsc://guidance/data-loss). searchAppearance cannot be combined with others — use gsc_search_appearance.'
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
          rowLimit: { type: 'number', description: 'Manual paging: max rows for a single API request (max 25000). Omit for a complete, internally paginated pull.' },
          startRow: { type: 'number', description: 'Manual paging: row offset. Omit for a complete pull.' },
          dataState: { type: 'string', enum: ['all', 'final'], description: 'Include fresh (all) or only finalized data. Default final.' },
          aggregationType: {
            type: 'string',
            enum: ['byPage', 'byProperty'],
            description: "How impressions are counted. Defaults to byProperty; defaults to byPage (with a warning) when 'page' is grouped or filtered, because byProperty is invalid there. The effective value is always echoed as aggregation_type — never report impression counts without it."
          },
          type: { type: 'string', enum: SEARCH_TYPE_ENUM, description: 'Search surface to query. Default web.' },
          response_format: RESPONSE_FORMAT_PROP
        },
        required: ['siteUrl', 'startDate', 'endDate'],
        additionalProperties: false
      },
      outputSchema: {
        type: 'object',
        properties: {
          rows: { type: 'array', items: SEARCH_ANALYTICS_ROW },
          ...RESPONSE_META_PROPS
        },
        required: ['rows', ...REQUIRED_META]
      },
      annotations: READ_ANNOTATIONS
    },
    {
      name: 'gsc_compare_periods',
      description:
        'Compare Search Console performance between two date ranges. Returns absolute + percentage deltas for clicks, impressions, CTR, and average position, with the effective aggregation_type. Period totals use complete row pulls; position deltas are impression-weighted. ' +
        PREFLIGHT_NOTE,
      inputSchema: {
        type: 'object',
        properties: {
          siteUrl: { type: 'string', description: 'The verified property URL.' },
          period1Start: { type: 'string', description: 'First period start date (YYYY-MM-DD). Usually the earlier/baseline period.' },
          period1End: { type: 'string', description: 'First period end date (YYYY-MM-DD).' },
          period2Start: { type: 'string', description: 'Second period start date (YYYY-MM-DD). Usually the more recent period.' },
          period2End: { type: 'string', description: 'Second period end date (YYYY-MM-DD).' },
          dimensions: {
            type: 'array',
            items: { type: 'string', enum: DIMENSION_ENUM },
            description: 'Optional grouping dimensions. Omit for exact property-level totals — query/page make period totals lossy.'
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
            }
          },
          aggregationType: { type: 'string', enum: ['byPage', 'byProperty'], description: 'Impression counting unit, applied to both periods. Defaults like gsc_search_analytics.' },
          type: { type: 'string', enum: SEARCH_TYPE_ENUM, description: 'Search surface to query. Default web.' },
          response_format: RESPONSE_FORMAT_PROP
        },
        required: ['siteUrl', 'period1Start', 'period1End', 'period2Start', 'period2End'],
        additionalProperties: false
      },
      outputSchema: {
        type: 'object',
        properties: {
          aggregation_type: RESPONSE_META_PROPS.aggregation_type,
          warnings: RESPONSE_META_PROPS.warnings,
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
        required: ['aggregation_type', 'warnings', 'period1', 'period2', 'changes']
      },
      annotations: READ_ANNOTATIONS
    },
    {
      name: 'gsc_top_queries',
      description:
        'Get the top search queries for a property, ranked by the chosen metric over the COMPLETE query row set (the server paginates internally before sorting, so the ranking never silently omits large rows). ' +
        'Query rows are lossy: state coverage from gsc_coverage_report alongside any totals. ' +
        PREFLIGHT_NOTE,
      inputSchema: {
        type: 'object',
        properties: {
          siteUrl: { type: 'string', description: 'The verified property URL.' },
          startDate: { type: 'string', description: 'Start date (YYYY-MM-DD).' },
          endDate: { type: 'string', description: 'End date (YYYY-MM-DD).' },
          limit: { type: 'number', description: 'Max queries to return after ranking. Default 1000.' },
          metric: { type: 'string', enum: METRIC_ENUM, description: 'Ranking metric applied to the full row set. Default clicks.' },
          includeTrend: { type: 'boolean', description: 'Include a daily clicks trend for the top (≤20) queries. Default false.' },
          type: { type: 'string', enum: SEARCH_TYPE_ENUM, description: 'Search surface. Default web.' },
          response_format: RESPONSE_FORMAT_PROP
        },
        required: ['siteUrl', 'startDate', 'endDate'],
        additionalProperties: false
      },
      outputSchema: {
        type: 'object',
        properties: {
          rows: { type: 'array', items: SEARCH_ANALYTICS_ROW },
          trend: { type: 'object', additionalProperties: true },
          ...RESPONSE_META_PROPS
        },
        required: ['rows', ...REQUIRED_META]
      },
      annotations: READ_ANNOTATIONS
    },
    {
      name: 'gsc_top_pages',
      description:
        'Get the top pages for a property, ranked by the chosen metric over the COMPLETE page row set (the server paginates internally before sorting, so the ranking never silently omits large rows). Page counts use byPage aggregation — impressions are per page, not per property. ' +
        PREFLIGHT_NOTE,
      inputSchema: {
        type: 'object',
        properties: {
          siteUrl: { type: 'string', description: 'The verified property URL.' },
          startDate: { type: 'string', description: 'Start date (YYYY-MM-DD).' },
          endDate: { type: 'string', description: 'End date (YYYY-MM-DD).' },
          limit: { type: 'number', description: 'Max pages to return after ranking. Default 1000.' },
          metric: { type: 'string', enum: METRIC_ENUM, description: 'Ranking metric applied to the full row set. Default clicks.' },
          includeQueryBreakdown: { type: 'boolean', description: 'Include top queries per page (top 10 pages). Default false.' },
          type: { type: 'string', enum: SEARCH_TYPE_ENUM, description: 'Search surface. Default web.' },
          response_format: RESPONSE_FORMAT_PROP
        },
        required: ['siteUrl', 'startDate', 'endDate'],
        additionalProperties: false
      },
      outputSchema: {
        type: 'object',
        properties: {
          rows: { type: 'array', items: SEARCH_ANALYTICS_ROW },
          queryBreakdown: { type: 'object', additionalProperties: true },
          ...RESPONSE_META_PROPS
        },
        required: ['rows', ...REQUIRED_META]
      },
      annotations: READ_ANNOTATIONS
    },
    {
      name: 'gsc_verify_data_availability',
      description:
        "Google's recommended preflight before any analytics pull: a bare date-dimension query over the lookback window. Returns per-date rows plus latest_final_date and provisional_dates. Data lands ~2–3 days late — run this first and never assume the boundary.",
      inputSchema: {
        type: 'object',
        properties: {
          siteUrl: { type: 'string', description: 'The verified property URL.' },
          lookbackDays: { type: 'number', description: 'Days back from today to check. Default 10.' },
          type: { type: 'string', enum: SEARCH_TYPE_ENUM, description: 'Search surface. Default web.' },
          response_format: RESPONSE_FORMAT_PROP
        },
        required: ['siteUrl'],
        additionalProperties: false
      },
      outputSchema: {
        type: 'object',
        properties: {
          days: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                date: { type: 'string' },
                clicks: { type: 'number' },
                impressions: { type: 'number' },
                is_final: { type: 'boolean' }
              },
              required: ['date', 'clicks', 'impressions', 'is_final']
            }
          },
          latest_final_date: { type: ['string', 'null'], description: 'Most recent date with finalized data. Build reports only up to here.' },
          provisional_dates: { type: 'array', items: { type: 'string' } },
          warnings: RESPONSE_META_PROPS.warnings
        },
        required: ['days', 'latest_final_date', 'provisional_dates', 'warnings']
      },
      annotations: READ_ANNOTATIONS
    },
    {
      name: 'gsc_accurate_totals',
      description:
        'The ground-truth denominator: exact clicks/impressions/CTR/position totals with no lossy dimensions. Rejects page and query. Requires an explicit aggregationType because byProperty and byPage count impressions in different units. Use gsc_search_analytics for detail, and gsc_coverage_report to measure what detail pulls drop. ' +
        PREFLIGHT_NOTE,
      inputSchema: {
        type: 'object',
        properties: {
          siteUrl: { type: 'string', description: 'The verified property URL.' },
          startDate: { type: 'string', description: 'Start date (YYYY-MM-DD).' },
          endDate: { type: 'string', description: 'End date (YYYY-MM-DD).' },
          aggregationType: {
            type: 'string',
            enum: ['byPage', 'byProperty'],
            description: 'Required. byProperty: one impression per property per SERP. byPage: one impression per page per SERP (higher). Pick the unit your analysis needs and keep it consistent.'
          },
          dimensions: {
            type: 'array',
            items: { type: 'string', enum: ['country', 'device'] },
            description: 'Optional lossless breakdowns. Only country and device are permitted — page/query would make totals inaccurate.'
          },
          dataState: { type: 'string', enum: ['all', 'final'], description: 'Default final.' },
          type: { type: 'string', enum: SEARCH_TYPE_ENUM, description: 'Search surface. Default web.' },
          response_format: RESPONSE_FORMAT_PROP
        },
        required: ['siteUrl', 'startDate', 'endDate', 'aggregationType'],
        additionalProperties: false
      },
      outputSchema: {
        type: 'object',
        properties: {
          totals: {
            type: 'object',
            properties: {
              clicks: { type: 'number' },
              impressions: { type: 'number' },
              ctr: { type: 'number', description: 'Derived: clicks / impressions.' },
              position: { type: 'number', description: 'Derived: impression-weighted average (sum_position / impressions).' },
              sum_position: { type: 'number', description: 'Derived: Σ impressions × position. Additive.' }
            },
            required: ['clicks', 'impressions', 'ctr', 'position', 'sum_position']
          },
          aggregation_type: RESPONSE_META_PROPS.aggregation_type,
          rows: { type: 'array', items: SEARCH_ANALYTICS_ROW },
          warnings: RESPONSE_META_PROPS.warnings
        },
        required: ['totals', 'aggregation_type', 'warnings']
      },
      annotations: READ_ANNOTATIONS
    },
    {
      name: 'gsc_coverage_report',
      description:
        'Measure how much of the true impression total a query/page-grained pull actually accounts for. Runs the detail pull and the matching gsc_accurate_totals pull, and returns coverage_pct + dropped_impressions. Run this BEFORE presenting any query-level analysis, and state the coverage alongside conclusions. Coverage varies by window and over time — always measure, never assume.',
      inputSchema: {
        type: 'object',
        properties: {
          siteUrl: { type: 'string', description: 'The verified property URL.' },
          startDate: { type: 'string', description: 'Start date (YYYY-MM-DD).' },
          endDate: { type: 'string', description: 'End date (YYYY-MM-DD).' },
          entityType: { type: 'string', enum: ['query', 'page', 'query_page'], description: 'The detail grain to measure. query uses byProperty; page and query_page use byPage.' },
          type: { type: 'string', enum: SEARCH_TYPE_ENUM, description: 'Search surface. Default web.' },
          response_format: RESPONSE_FORMAT_PROP
        },
        required: ['siteUrl', 'startDate', 'endDate', 'entityType'],
        additionalProperties: false
      },
      outputSchema: {
        type: 'object',
        properties: {
          entity_type: { type: 'string', enum: ['query', 'page', 'query_page'] },
          property_impressions: { type: 'number', description: 'True total from the accurate-totals pull (no lossy dimensions).' },
          entity_impressions: { type: 'number', description: 'Σ impressions across the detail rows.' },
          coverage_pct: { type: 'number', description: 'Derived: entity_impressions / property_impressions × 100.' },
          dropped_impressions: { type: 'number', description: 'Derived: property_impressions − entity_impressions. Invisible at this grain.' },
          entity_row_count: { type: 'number' },
          aggregation_type: RESPONSE_META_PROPS.aggregation_type,
          warnings: RESPONSE_META_PROPS.warnings
        },
        required: ['entity_type', 'property_impressions', 'entity_impressions', 'coverage_pct', 'dropped_impressions', 'entity_row_count', 'aggregation_type', 'warnings']
      },
      annotations: READ_ANNOTATIONS
    },
    {
      name: 'gsc_search_appearance',
      description:
        "Break down performance by search appearance (rich result) type. The API forbids combining searchAppearance with other dimensions, so this tool runs Google's two-step: enumerate the types present, then one filtered query per type with your requested dimensions, and merges the results. Returns an empty list cleanly when the property has no rich results.",
      inputSchema: {
        type: 'object',
        properties: {
          siteUrl: { type: 'string', description: 'The verified property URL.' },
          startDate: { type: 'string', description: 'Start date (YYYY-MM-DD).' },
          endDate: { type: 'string', description: 'End date (YYYY-MM-DD).' },
          dimensions: {
            type: 'array',
            items: { type: 'string', enum: ['query', 'page', 'country', 'device', 'date'] },
            description: 'Dimensions for the per-type breakdown queries. Omit to only enumerate the appearance types.'
          },
          type: { type: 'string', enum: SEARCH_TYPE_ENUM, description: 'Search surface. Default web.' },
          response_format: RESPONSE_FORMAT_PROP
        },
        required: ['siteUrl', 'startDate', 'endDate'],
        additionalProperties: false
      },
      outputSchema: {
        type: 'object',
        properties: {
          appearance_types: { type: 'array', items: SEARCH_ANALYTICS_ROW },
          breakdowns: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                appearance_type: { type: 'string' },
                rows: { type: 'array', items: SEARCH_ANALYTICS_ROW }
              },
              required: ['appearance_type', 'rows']
            }
          },
          aggregation_type: RESPONSE_META_PROPS.aggregation_type,
          warnings: RESPONSE_META_PROPS.warnings
        },
        required: ['appearance_types', 'breakdowns', 'aggregation_type', 'warnings']
      },
      annotations: READ_ANNOTATIONS
    },
    {
      name: 'gsc_query_page_pairs',
      description:
        'Query→page attribution: the complete query×page row set (byPage aggregation). QUOTA WARNING: grouping by query AND page is the single most expensive request the API offers, and load scales with date-range length — keep windows short (≤30 days), avoid repeating identical pulls, and expect quota errors on large properties. See gsc://guidance/quota. Rows at this grain drop the most data — measure with gsc_coverage_report (entityType query_page).',
      inputSchema: {
        type: 'object',
        properties: {
          siteUrl: { type: 'string', description: 'The verified property URL.' },
          startDate: { type: 'string', description: 'Start date (YYYY-MM-DD).' },
          endDate: { type: 'string', description: 'End date (YYYY-MM-DD). Keep the window ≤30 days where possible.' },
          type: { type: 'string', enum: SEARCH_TYPE_ENUM, description: 'Search surface. Default web.' },
          response_format: RESPONSE_FORMAT_PROP
        },
        required: ['siteUrl', 'startDate', 'endDate'],
        additionalProperties: false
      },
      outputSchema: {
        type: 'object',
        properties: {
          rows: { type: 'array', items: SEARCH_ANALYTICS_ROW },
          ...RESPONSE_META_PROPS
        },
        required: ['rows', ...REQUIRED_META]
      },
      annotations: READ_ANNOTATIONS
    }
  ];

  handlers.set('gsc_search_analytics', async (args) => {
    try {
      const format = parseFormat(args);
      const params = SearchAnalyticsQuerySchema.parse(stripFormat(args));
      const data = await searchAnalyticsApi.query(params);
      return okFormatted(data, format, analyticsMarkdown('Search analytics', params.dimensions ?? []));
    } catch (error) {
      return handleToolError(error);
    }
  });

  handlers.set('gsc_compare_periods', async (args) => {
    try {
      const format = parseFormat(args);
      const params = ComparePeriodsQuerySchema.parse(stripFormat(args));
      const data = await searchAnalyticsApi.comparePeriods(params);
      return okFormatted(data, format, (d) =>
        `## Period comparison\n\n**Aggregation:** ${d.aggregation_type}\n\n` +
        warningsBlock(d.warnings) +
        tableFromObjects([
          { metric: 'clicks', period1: d.period1.clicks, period2: d.period2.clicks, change: d.changes.clicks.absolute, 'change %': d.changes.clicks.percentage },
          { metric: 'impressions', period1: d.period1.impressions, period2: d.period2.impressions, change: d.changes.impressions.absolute, 'change %': d.changes.impressions.percentage },
          { metric: 'ctr', period1: d.period1.ctr, period2: d.period2.ctr, change: d.changes.ctr.absolute, 'change %': d.changes.ctr.percentage },
          { metric: 'position', period1: d.period1.position, period2: d.period2.position, change: d.changes.position.absolute, 'change %': d.changes.position.percentage }
        ]) +
        (d.rows && d.rows.length > 0 ? `\n### Per-dimension rows\n\n${toMarkdown(d.rows, 4)}` : '')
      );
    } catch (error) {
      return handleToolError(error);
    }
  });

  handlers.set('gsc_top_queries', async (args) => {
    try {
      const format = parseFormat(args);
      const params = TopQueriesQuerySchema.parse(stripFormat(args));
      const data = await searchAnalyticsApi.topQueries(params);
      return okFormatted(data, format, analyticsMarkdown(`Top queries by ${params.metric}`, ['query']));
    } catch (error) {
      return handleToolError(error);
    }
  });

  handlers.set('gsc_top_pages', async (args) => {
    try {
      const format = parseFormat(args);
      const params = TopPagesQuerySchema.parse(stripFormat(args));
      const data = await searchAnalyticsApi.topPages(params);
      return okFormatted(data, format, analyticsMarkdown(`Top pages by ${params.metric}`, ['page']));
    } catch (error) {
      return handleToolError(error);
    }
  });

  handlers.set('gsc_verify_data_availability', async (args) => {
    try {
      const format = parseFormat(args);
      const params = VerifyDataAvailabilityQuerySchema.parse(stripFormat(args));
      const data = await searchAnalyticsApi.verifyDataAvailability(params);
      return okFormatted(data, format, (d) =>
        `## Data availability\n\n**Latest final date:** ${d.latest_final_date ?? 'none'} · ` +
        `**Provisional:** ${d.provisional_dates.length > 0 ? d.provisional_dates.join(', ') : 'none'}\n\n` +
        warningsBlock(d.warnings) +
        tableFromObjects(d.days.map((day) => ({ ...day })))
      );
    } catch (error) {
      return handleToolError(error);
    }
  });

  handlers.set('gsc_accurate_totals', async (args) => {
    try {
      const requestedDims = Array.isArray(args.dimensions) ? (args.dimensions as unknown[]) : [];
      if (requestedDims.includes('page') || requestedDims.includes('query')) {
        return err({
          code: 'INVALID_DIMENSIONS',
          message:
            "Accurate counts require omitting 'page' and 'query' — Google drops rows for those groupings. " +
            'Use gsc_search_analytics for detail, and gsc_coverage_report to measure what it drops. ' +
            'Permitted dimensions here: country, device.'
        });
      }
      const format = parseFormat(args);
      const params = AccurateTotalsQuerySchema.parse(stripFormat(args));
      const data = await searchAnalyticsApi.accurateTotals(params);
      return okFormatted(data, format, (d) =>
        `## Accurate totals\n\n**Aggregation:** ${d.aggregation_type} (impressions counted per ${d.aggregation_type === 'byPage' ? 'page' : 'property'})\n\n` +
        warningsBlock(d.warnings) +
        tableFromObjects([{ ...d.totals, ctr: `${(d.totals.ctr * 100).toFixed(2)}%`, position: Number(d.totals.position.toFixed(2)) }]) +
        (d.rows ? `\n### Breakdown\n\n${analyticsRowsTable(d.rows, params.dimensions ?? [])}` : '')
      );
    } catch (error) {
      return handleToolError(error);
    }
  });

  handlers.set('gsc_coverage_report', async (args) => {
    try {
      const format = parseFormat(args);
      const params = CoverageReportQuerySchema.parse(stripFormat(args));
      const data = await searchAnalyticsApi.coverageReport(params);
      return okFormatted(data, format, (d) =>
        `## Coverage report — ${d.entity_type}\n\n` +
        `**Coverage: ${d.coverage_pct}%** — the ${d.entity_type} grain accounts for ${d.entity_impressions.toLocaleString()} of ` +
        `${d.property_impressions.toLocaleString()} impressions (${d.dropped_impressions.toLocaleString()} dropped by Google at this grain). ` +
        `Aggregation: ${d.aggregation_type}; ${d.entity_row_count.toLocaleString()} detail rows.\n\n` +
        warningsBlock(d.warnings)
      );
    } catch (error) {
      return handleToolError(error);
    }
  });

  handlers.set('gsc_search_appearance', async (args) => {
    try {
      const format = parseFormat(args);
      const params = SearchAppearanceQuerySchema.parse(stripFormat(args));
      const data = await searchAnalyticsApi.searchAppearance(params);
      return okFormatted(data, format, (d) =>
        `## Search appearance\n\n` +
        warningsBlock(d.warnings) +
        (d.appearance_types.length === 0
          ? '_No search-appearance (rich result) types recorded for this property in this window._\n'
          : `### Appearance types\n\n${analyticsRowsTable(d.appearance_types, ['searchAppearance'])}` +
            d.breakdowns
              .map((b) => `\n### ${b.appearance_type}\n\n${analyticsRowsTable(b.rows, params.dimensions ?? [])}`)
              .join(''))
      );
    } catch (error) {
      return handleToolError(error);
    }
  });

  handlers.set('gsc_query_page_pairs', async (args) => {
    try {
      const format = parseFormat(args);
      const params = QueryPagePairsQuerySchema.parse(stripFormat(args));
      const data = await searchAnalyticsApi.queryPagePairs(params);
      return okFormatted(data, format, analyticsMarkdown('Query → page pairs', ['query', 'page']));
    } catch (error) {
      return handleToolError(error);
    }
  });

  return { tools, handlers };
}

/** Remove tool-layer-only params before passing args to the API-layer zod schemas. */
function stripFormat(args: Record<string, unknown>): Record<string, unknown> {
  const { response_format: _ignored, ...rest } = args;
  return rest;
}
