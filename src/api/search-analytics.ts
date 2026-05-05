import type { GSCClient } from './client.js';
import { SitesApi } from './sites.js';
import { resolveSiteUrl } from '../utils/site-url.js';
import { getGlobalLogger } from '../utils/logger.js';
import type {
  SearchAnalyticsQuery,
  SearchAnalyticsResponse,
  SearchAnalyticsRow,
  ComparePeriodsQuery,
  ComparePeriodsResponse,
  PeriodMetrics,
  MetricChange,
  TopQueriesQuery,
  TopPagesQuery
} from '../types/index.js';

export class SearchAnalyticsApi {
  private client: GSCClient;
  private sitesApi: SitesApi;

  constructor(client: GSCClient) {
    this.client = client;
    this.sitesApi = new SitesApi(client);
  }

  /**
   * Query search analytics data.
   *
   * NOTE: The GSC API will always show lower totals than the GSC web interface.
   * This is because the UI includes "anonymized queries" (filtered for privacy)
   * that the API cannot return. A 20-40% discrepancy is normal and expected.
   *
   * By default, queries web search type (matching GSC UI default).
   * Specify a different type to query image, video, news, discover, or googleNews.
   */
  async query(params: SearchAnalyticsQuery): Promise<SearchAnalyticsResponse> {
    const logger = getGlobalLogger();

    // Resolve user input to actual GSC property
    const resolvedSiteUrl = await resolveSiteUrl(this.sitesApi, params.siteUrl);

    // Default to 'web' to match GSC UI default behavior
    const searchType = params.type ?? 'web';

    logger.debug('Fetching search analytics', {
      siteUrl: resolvedSiteUrl,
      type: searchType,
      startDate: params.startDate,
      endDate: params.endDate
    });

    // Build request body
    const requestBody: Record<string, unknown> = {
      startDate: params.startDate,
      endDate: params.endDate,
      dimensions: params.dimensions || [],
      rowLimit: params.rowLimit || 25000,  // Max allowed by API
      startRow: params.startRow || 0,
      dataState: params.dataState ?? 'final'
    };

    // Always include type (defaults to 'web' to match GSC UI)
    requestBody.type = searchType;

    if (params.aggregationType) {
      requestBody.aggregationType = params.aggregationType;
    }

    if (params.filters && params.filters.length > 0) {
      requestBody.dimensionFilterGroups = [
        {
          groupType: 'and',
          filters: params.filters.map((f) => ({
            dimension: f.dimension,
            operator: f.operator,
            expression: f.expression
          }))
        }
      ];
    }

    // Fetch from API
    const result = await this.client.withRetry(async () => {
      const response = await this.client.getSearchConsole().searchanalytics.query({
        siteUrl: resolvedSiteUrl,
        requestBody
      });
      return response.data;
    }, `searchAnalytics.query`);

    const rows: SearchAnalyticsRow[] = (result.rows || []).map((row) => ({
      keys: row.keys || [],
      clicks: row.clicks ?? 0,
      impressions: row.impressions ?? 0,
      ctr: row.ctr ?? 0,
      position: row.position ?? 0
    }));

    // Log if no data returned
    if (rows.length === 0) {
      logger.debug('Search analytics returned no rows', {
        siteUrl: resolvedSiteUrl,
        type: searchType,
        startDate: params.startDate,
        endDate: params.endDate
      });
    }

    return {
      rows,
      responseAggregationType: (result.responseAggregationType as SearchAnalyticsResponse['responseAggregationType']) || 'auto'
    };
  }

  async comparePeriods(params: ComparePeriodsQuery): Promise<ComparePeriodsResponse> {
    // Fetch data for both periods
    const [period1Data, period2Data] = await Promise.all([
      this.query({
        siteUrl: params.siteUrl,
        startDate: params.period1Start,
        endDate: params.period1End,
        dimensions: params.dimensions,
        filters: params.filters,
        type: params.type
      }),
      this.query({
        siteUrl: params.siteUrl,
        startDate: params.period2Start,
        endDate: params.period2End,
        dimensions: params.dimensions,
        filters: params.filters,
        type: params.type
      })
    ]);

    // Calculate aggregate metrics for each period
    const period1Metrics = this.calculateAggregateMetrics(period1Data.rows);
    const period2Metrics = this.calculateAggregateMetrics(period2Data.rows);

    // Calculate changes
    const changes = {
      clicks: this.calculateChange(period1Metrics.clicks, period2Metrics.clicks),
      impressions: this.calculateChange(period1Metrics.impressions, period2Metrics.impressions),
      ctr: this.calculateChange(period1Metrics.ctr, period2Metrics.ctr),
      position: this.calculateChange(period1Metrics.position, period2Metrics.position)
    };

    const response: ComparePeriodsResponse = {
      period1: period1Metrics,
      period2: period2Metrics,
      changes
    };

    // If dimensions were specified, also include row-level comparison
    if (params.dimensions && params.dimensions.length > 0) {
      response.rows = this.compareRows(period1Data.rows, period2Data.rows);
    }

    return response;
  }

  async topQueries(params: TopQueriesQuery): Promise<SearchAnalyticsResponse & { trend?: Record<string, number[]> }> {
    const data = await this.query({
      siteUrl: params.siteUrl,
      startDate: params.startDate,
      endDate: params.endDate,
      dimensions: ['query'],
      rowLimit: params.limit,
      type: params.type
    });

    // Sort by specified metric
    const sortedRows = this.sortByMetric(data.rows, params.metric);

    const result: SearchAnalyticsResponse & { trend?: Record<string, number[]> } = {
      rows: sortedRows.slice(0, params.limit),
      responseAggregationType: data.responseAggregationType
    };

    // Include trend data if requested
    if (params.includeTrend) {
      const trendData = await this.getTrendData(
        params.siteUrl,
        params.startDate,
        params.endDate,
        sortedRows.slice(0, Math.min(params.limit, 20)).map((r) => r.keys[0]),
        params.type
      );
      result.trend = trendData;
    }

    return result;
  }

  async topPages(params: TopPagesQuery): Promise<SearchAnalyticsResponse & { queryBreakdown?: Record<string, SearchAnalyticsRow[]> }> {
    const data = await this.query({
      siteUrl: params.siteUrl,
      startDate: params.startDate,
      endDate: params.endDate,
      dimensions: ['page'],
      rowLimit: params.limit,
      type: params.type
    });

    // Sort by specified metric
    const sortedRows = this.sortByMetric(data.rows, params.metric);

    const result: SearchAnalyticsResponse & { queryBreakdown?: Record<string, SearchAnalyticsRow[]> } = {
      rows: sortedRows.slice(0, params.limit),
      responseAggregationType: data.responseAggregationType
    };

    // Include query breakdown if requested
    if (params.includeQueryBreakdown) {
      const breakdown: Record<string, SearchAnalyticsRow[]> = {};

      // Get top queries for each of the top 10 pages
      for (const row of sortedRows.slice(0, 10)) {
        const pageUrl = row.keys[0];
        const pageQueries = await this.query({
          siteUrl: params.siteUrl,
          startDate: params.startDate,
          endDate: params.endDate,
          dimensions: ['query'],
          filters: [{ dimension: 'page', operator: 'equals', expression: pageUrl }],
          rowLimit: 10,
          type: params.type
        });
        breakdown[pageUrl] = pageQueries.rows;
      }

      result.queryBreakdown = breakdown;
    }

    return result;
  }

  private calculateAggregateMetrics(rows: SearchAnalyticsRow[]): PeriodMetrics {
    if (rows.length === 0) {
      return { clicks: 0, impressions: 0, ctr: 0, position: 0 };
    }

    const totalClicks = rows.reduce((sum, row) => sum + row.clicks, 0);
    const totalImpressions = rows.reduce((sum, row) => sum + row.impressions, 0);

    // Weighted average position (weighted by impressions)
    const weightedPosition = rows.reduce(
      (sum, row) => sum + row.position * row.impressions,
      0
    );
    const avgPosition = totalImpressions > 0 ? weightedPosition / totalImpressions : 0;

    return {
      clicks: totalClicks,
      impressions: totalImpressions,
      ctr: totalImpressions > 0 ? totalClicks / totalImpressions : 0,
      position: avgPosition
    };
  }

  private calculateChange(oldValue: number, newValue: number): MetricChange {
    const absolute = newValue - oldValue;
    const percentage = oldValue !== 0 ? ((newValue - oldValue) / oldValue) * 100 : 0;

    return {
      absolute: Math.round(absolute * 100) / 100,
      percentage: Math.round(percentage * 100) / 100
    };
  }

  private compareRows(
    period1Rows: SearchAnalyticsRow[],
    period2Rows: SearchAnalyticsRow[]
  ): ComparePeriodsResponse['rows'] {
    // Index both periods by joined-key. The previous implementation iterated
    // only period1, silently dropping any keys that appeared in period2 only
    // (e.g., new queries that started ranking in the comparison window).
    const period1Map = new Map<string, SearchAnalyticsRow>();
    for (const row of period1Rows) {
      period1Map.set(row.keys.join('|'), row);
    }
    const period2Map = new Map<string, SearchAnalyticsRow>();
    for (const row of period2Rows) {
      period2Map.set(row.keys.join('|'), row);
    }

    const allKeys = new Set<string>([...period1Map.keys(), ...period2Map.keys()]);
    const ZERO: PeriodMetrics = { clicks: 0, impressions: 0, ctr: 0, position: 0 };

    const result: ComparePeriodsResponse['rows'] = [];
    for (const key of allKeys) {
      const row1 = period1Map.get(key);
      const row2 = period2Map.get(key);
      // The `keys` array is the source of truth for the display key; prefer
      // whichever row exists.
      const displayKeys = (row1?.keys ?? row2?.keys ?? []).join(' | ');

      const metrics1: PeriodMetrics = row1
        ? { clicks: row1.clicks, impressions: row1.impressions, ctr: row1.ctr, position: row1.position }
        : ZERO;
      const metrics2: PeriodMetrics = row2
        ? { clicks: row2.clicks, impressions: row2.impressions, ctr: row2.ctr, position: row2.position }
        : ZERO;

      result.push({
        key: displayKeys,
        period1: metrics1,
        period2: metrics2,
        changes: {
          clicks: this.calculateChange(metrics1.clicks, metrics2.clicks),
          impressions: this.calculateChange(metrics1.impressions, metrics2.impressions),
          ctr: this.calculateChange(metrics1.ctr, metrics2.ctr),
          position: this.calculateChange(metrics1.position, metrics2.position)
        }
      });
    }

    return result;
  }

  private sortByMetric(rows: SearchAnalyticsRow[], metric: string): SearchAnalyticsRow[] {
    const sorted = [...rows];

    switch (metric) {
      case 'clicks':
        sorted.sort((a, b) => b.clicks - a.clicks);
        break;
      case 'impressions':
        sorted.sort((a, b) => b.impressions - a.impressions);
        break;
      case 'ctr':
        sorted.sort((a, b) => b.ctr - a.ctr);
        break;
      case 'position':
        sorted.sort((a, b) => a.position - b.position); // Lower is better
        break;
      default:
        sorted.sort((a, b) => b.clicks - a.clicks);
    }

    return sorted;
  }

  private async getTrendData(
    siteUrl: string,
    startDate: string,
    endDate: string,
    queries: string[],
    type?: 'web' | 'image' | 'video' | 'news' | 'discover' | 'googleNews'
  ): Promise<Record<string, number[]>> {
    // Fetch daily data per query in parallel. We can't OR-combine multiple
    // `query equals` filters in a single GSC call — `dimensionFilterGroups`
    // are AND'd, so a multi-query filter list matches zero rows. One call
    // per query also gives us a tight rowLimit (one row per day per query).
    if (queries.length === 0) return {};

    const trend: Record<string, number[]> = {};

    const perQuery = await Promise.all(
      queries.map((q) =>
        this.query({
          siteUrl,
          startDate,
          endDate,
          dimensions: ['query', 'date'],
          filters: [{ dimension: 'query', operator: 'equals', expression: q }],
          rowLimit: 366, // up to one row per day per query
          type
        }).then((data) => ({ query: q, rows: data.rows }))
      )
    );

    for (const { query, rows } of perQuery) {
      // Sort by date so the trend array is chronological
      rows.sort((a, b) => (a.keys[1] || '').localeCompare(b.keys[1] || ''));
      trend[query] = rows.map((r) => r.clicks);
    }

    return trend;
  }
}
