import type { GSCClient } from './client.js';
import { SitesApi } from './sites.js';
import { resolveSiteUrl } from '../utils/site-url.js';
import { getGlobalLogger } from '../utils/logger.js';
import { GSCApiError } from '../types/index.js';
import type {
  SearchAnalyticsQuery,
  SearchAnalyticsResponse,
  SearchAnalyticsRow,
  EffectiveAggregation,
  ComparePeriodsQuery,
  ComparePeriodsResponse,
  PeriodMetrics,
  MetricChange,
  TopQueriesQuery,
  TopPagesQuery,
  VerifyDataAvailabilityQuery,
  DataAvailabilityResponse,
  DataAvailabilityDay,
  AccurateTotalsQuery,
  AccurateTotalsResponse,
  CoverageReportQuery,
  CoverageReportResponse,
  SearchAppearanceQuery,
  SearchAppearanceResponse,
  QueryPagePairsQuery,
  SearchType
} from '../types/index.js';

/** Google's per-response row maximum. Pagination re-issues the request with startRow += PAGE_SIZE. */
const PAGE_SIZE = 25000;
/** Google exposes at most this many rows per day per search type, sorted by clicks descending. */
const DAILY_ROW_CEILING = 50000;
/** Emit a warning when a pull retrieves this many rows — the ceiling may be near. */
const ROW_WARNING_THRESHOLD = 40000;
/** Hard safety cap on internally paginated pulls (20 API requests). */
const MAX_AUTO_ROWS = 500000;

const CEILING_WARNING =
  `Row ceiling reached: Google exposes at most ${DAILY_ROW_CEILING.toLocaleString()} rows per day per search type, ` +
  'sorted by clicks descending. Rows beyond the ceiling were dropped by Google — the omitted rows are the ' +
  'lowest-click (typically zero-click) ones. Narrow the date range or add filters to recover them.';

const LOSSY_DIMENSION_WARNING =
  'This result groups by page and/or query. Google drops some data for these groupings ("to be able to calculate ' +
  'results in a reasonable time"), so summing these rows under-counts true totals. Measure the loss with ' +
  'gsc_coverage_report; get exact totals with gsc_accurate_totals. See gsc://guidance/data-loss.';

const QUERY_ROWS_NOT_SUMMABLE_WARNING =
  'Query-level rows are NOT summable across dates: coverage of the dropped-data set changes with window length ' +
  'and over time. Re-query the full window instead of adding daily pulls. See gsc://guidance/data-loss.';

const BY_PAGE_DEFAULT_WARNING =
  "aggregation_type defaulted to 'byPage' because 'page' is present in dimensions or filters. Impressions are " +
  'counted per page, not per property — byPage totals are higher than byProperty totals for the same traffic ' +
  '(a query showing 2 pages of this site = 1 property impression but 2 page impressions). Never compare byPage ' +
  'numbers against byProperty numbers. See gsc://guidance/aggregation.';

const EXPENSIVE_REQUEST_WARNING =
  "This request groups by both 'query' and 'page' over more than 30 days — the most expensive request the API " +
  'offers. Load quota scales with date-range length; repeated pulls of this shape can exhaust the long-term load ' +
  'quota. Prefer shorter windows and avoid requerying the same data. See gsc://guidance/quota.';

interface RawApiRow {
  keys?: string[] | null;
  clicks?: number | null;
  impressions?: number | null;
  ctr?: number | null;
  position?: number | null;
}

function toRow(row: RawApiRow): SearchAnalyticsRow {
  const impressions = row.impressions ?? 0;
  const position = row.position ?? 0;
  return {
    keys: row.keys || [],
    clicks: row.clicks ?? 0,
    impressions,
    ctr: row.ctr ?? 0,
    position,
    sum_position: impressions * position
  };
}

function daysInRange(startDate: string, endDate: string): number {
  const start = Date.parse(`${startDate}T00:00:00Z`);
  const end = Date.parse(`${endDate}T00:00:00Z`);
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) return 1;
  return Math.round((end - start) / 86400000) + 1;
}

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
   * Semantics the caller can rely on:
   * - When neither `rowLimit` nor `startRow` is given, the server paginates internally
   *   (startRow += 25,000 until an empty page) and returns the complete row set with
   *   `total_count` set and `has_more: false`.
   * - When `rowLimit`/`startRow` are given, exactly one API request is made and
   *   `has_more`/`next_offset` describe manual pagination state.
   * - `aggregation_type` is always the effective value: explicit input, else byPage when
   *   'page' is present in dimensions or filters, else byProperty. 'auto' is never echoed.
   * - Grouping by page/query adds data-loss warnings; the 50k rows/day/type ceiling sets
   *   `row_ceiling_reached`.
   *
   * NOTE: The API also always shows lower totals than the GSC web UI, because the UI
   * includes privacy-filtered "anonymized queries" the API cannot return.
   */
  async query(params: SearchAnalyticsQuery): Promise<SearchAnalyticsResponse> {
    const logger = getGlobalLogger();
    const resolvedSiteUrl = await resolveSiteUrl(this.sitesApi, params.siteUrl);
    const searchType = params.type ?? 'web';
    const dimensions = params.dimensions || [];
    const warnings: string[] = [];

    if (dimensions.includes('searchAppearance') && dimensions.length > 1) {
      throw new GSCApiError({
        code: 'INVALID_DIMENSIONS',
        message:
          "'searchAppearance' cannot be combined with other dimensions in a single query. " +
          'Use gsc_search_appearance, which runs the documented two-step (enumerate appearance types, ' +
          'then one filtered query per type) and merges the results.'
      });
    }

    const aggregation = this.resolveAggregation(params, warnings);

    if (dimensions.includes('query') || dimensions.includes('page')) {
      warnings.push(LOSSY_DIMENSION_WARNING);
    }
    if (dimensions.includes('query')) {
      warnings.push(QUERY_ROWS_NOT_SUMMABLE_WARNING);
    }
    if (
      dimensions.includes('query') &&
      dimensions.includes('page') &&
      daysInRange(params.startDate, params.endDate) > 30
    ) {
      warnings.push(EXPENSIVE_REQUEST_WARNING);
    }

    logger.debug('Fetching search analytics', {
      siteUrl: resolvedSiteUrl,
      type: searchType,
      startDate: params.startDate,
      endDate: params.endDate,
      aggregation
    });

    const baseBody: Record<string, unknown> = {
      startDate: params.startDate,
      endDate: params.endDate,
      dimensions,
      dataState: params.dataState ?? 'final',
      type: searchType,
      aggregationType: aggregation
    };

    if (params.filters && params.filters.length > 0) {
      baseBody.dimensionFilterGroups = [
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

    const manualPagination = params.rowLimit !== undefined || params.startRow !== undefined;
    let rows: SearchAnalyticsRow[];
    let responseAggregation: EffectiveAggregation = aggregation;
    let hasMore = false;
    let nextOffset: number | undefined;
    let totalCount: number | undefined;

    if (manualPagination) {
      const rowLimit = params.rowLimit ?? PAGE_SIZE;
      const startRow = params.startRow ?? 0;
      const page = await this.fetchPage(resolvedSiteUrl, baseBody, startRow, rowLimit);
      rows = page.rows;
      responseAggregation = page.aggregation ?? aggregation;
      hasMore = rows.length === rowLimit;
      if (hasMore) nextOffset = startRow + rows.length;
    } else {
      rows = [];
      let startRow = 0;
      // Google's documented pattern: re-issue the identical request, incrementing
      // startRow by the page size, until a response returns zero rows.
      for (;;) {
        const page = await this.fetchPage(resolvedSiteUrl, baseBody, startRow, PAGE_SIZE);
        if (page.aggregation) responseAggregation = page.aggregation;
        rows.push(...page.rows);
        if (page.rows.length < PAGE_SIZE) break;
        startRow += PAGE_SIZE;
        if (rows.length >= MAX_AUTO_ROWS) {
          warnings.push(
            `Internal pagination stopped at the ${MAX_AUTO_ROWS.toLocaleString()}-row safety cap; ` +
            'the row set is incomplete. Narrow the date range or add filters, or paginate manually with startRow.'
          );
          hasMore = true;
          nextOffset = startRow;
          break;
        }
      }
      if (!hasMore) totalCount = rows.length;
    }

    const ceiling = this.assessRowCeiling(rows, dimensions, params.startDate, params.endDate, manualPagination);
    if (ceiling.warning) warnings.push(ceiling.warning);

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
      aggregation_type: responseAggregation,
      count: rows.length,
      ...(totalCount !== undefined ? { total_count: totalCount } : {}),
      has_more: hasMore,
      ...(nextOffset !== undefined ? { next_offset: nextOffset } : {}),
      row_ceiling_reached: ceiling.reached,
      warnings
    };
  }

  /**
   * Resolve the aggregation type the API will actually use. Never leaves 'auto' implicit:
   * explicit values are validated, absent/'auto' resolves to byPage when 'page' or
   * 'searchAppearance' is involved (grouped or filtered — the API rejects byProperty in
   * both contexts and resolves auto to byPage, verified live), else byProperty.
   */
  private resolveAggregation(params: SearchAnalyticsQuery, warnings: string[]): EffectiveAggregation {
    const dimensions = params.dimensions || [];
    const involved = (dim: 'page' | 'searchAppearance') =>
      dimensions.includes(dim) || (params.filters || []).some((f) => f.dimension === dim);
    const byPageForced = involved('page') || involved('searchAppearance');

    if (params.aggregationType === 'byProperty' && byPageForced) {
      throw new GSCApiError({
        code: 'INVALID_AGGREGATION',
        message:
          "aggregationType 'byProperty' cannot be combined with 'page' or 'searchAppearance' in dimensions " +
          "or filters — the API rejects it. Use 'byPage' (and expect page-unit impression counts), or drop " +
          'those dimensions/filters to get property-level counts. See gsc://guidance/aggregation.'
      });
    }
    if (params.aggregationType === 'byPage' || params.aggregationType === 'byProperty') {
      return params.aggregationType;
    }
    if (byPageForced) {
      if (involved('page')) warnings.push(BY_PAGE_DEFAULT_WARNING);
      return 'byPage';
    }
    return 'byProperty';
  }

  private async fetchPage(
    siteUrl: string,
    baseBody: Record<string, unknown>,
    startRow: number,
    rowLimit: number
  ): Promise<{ rows: SearchAnalyticsRow[]; aggregation?: EffectiveAggregation }> {
    const result = await this.client.withRetry(async () => {
      const response = await this.client.getSearchConsole().searchanalytics.query({
        siteUrl,
        requestBody: { ...baseBody, rowLimit, startRow }
      });
      return response.data;
    }, 'searchAnalytics.query');

    const aggregation =
      result.responseAggregationType === 'byPage' || result.responseAggregationType === 'byProperty'
        ? result.responseAggregationType
        : undefined;

    return { rows: (result.rows || []).map(toRow), aggregation };
  }

  /**
   * Detect Google's 50k-rows/day/search-type exposure ceiling. With a 'date' dimension the
   * check is exact per day; without it, a multi-day pull can only be bounded by
   * days × ceiling. Manual pagination can't see the full set, so only warn on volume.
   */
  private assessRowCeiling(
    rows: SearchAnalyticsRow[],
    dimensions: string[],
    startDate: string,
    endDate: string,
    manualPagination: boolean
  ): { reached: boolean; warning?: string } {
    if (rows.length >= ROW_WARNING_THRESHOLD && rows.length < DAILY_ROW_CEILING) {
      return {
        reached: false,
        warning:
          `Large pull: ${rows.length.toLocaleString()} rows retrieved. Google exposes at most ` +
          `${DAILY_ROW_CEILING.toLocaleString()} rows per day per search type (sorted by clicks); ` +
          'this pull may be approaching that ceiling.'
      };
    }

    if (rows.length < DAILY_ROW_CEILING) return { reached: false };

    const dateIndex = dimensions.indexOf('date');
    if (dateIndex >= 0 && !manualPagination) {
      const perDate = new Map<string, number>();
      for (const row of rows) {
        const d = row.keys[dateIndex] ?? '';
        perDate.set(d, (perDate.get(d) ?? 0) + 1);
      }
      const anyDayAtCeiling = [...perDate.values()].some((n) => n >= DAILY_ROW_CEILING);
      return anyDayAtCeiling ? { reached: true, warning: CEILING_WARNING } : { reached: false };
    }

    const dayCount = daysInRange(startDate, endDate);
    if (rows.length >= DAILY_ROW_CEILING * dayCount) {
      return { reached: true, warning: CEILING_WARNING };
    }
    return {
      reached: false,
      warning:
        `Very large pull: ${rows.length.toLocaleString()} rows. Without a 'date' dimension the ` +
        `${DAILY_ROW_CEILING.toLocaleString()}-rows/day ceiling cannot be checked exactly; per-day tails may ` +
        'already be dropped (lowest-click rows first). Add the date dimension to check per day.'
    };
  }

  async comparePeriods(params: ComparePeriodsQuery): Promise<ComparePeriodsResponse> {
    const [period1Data, period2Data] = await Promise.all([
      this.query({
        siteUrl: params.siteUrl,
        startDate: params.period1Start,
        endDate: params.period1End,
        dimensions: params.dimensions,
        filters: params.filters,
        aggregationType: params.aggregationType,
        type: params.type
      }),
      this.query({
        siteUrl: params.siteUrl,
        startDate: params.period2Start,
        endDate: params.period2End,
        dimensions: params.dimensions,
        filters: params.filters,
        aggregationType: params.aggregationType,
        type: params.type
      })
    ]);

    const period1Metrics = this.calculateAggregateMetrics(period1Data.rows);
    const period2Metrics = this.calculateAggregateMetrics(period2Data.rows);

    const changes = {
      clicks: this.calculateChange(period1Metrics.clicks, period2Metrics.clicks),
      impressions: this.calculateChange(period1Metrics.impressions, period2Metrics.impressions),
      ctr: this.calculateChange(period1Metrics.ctr, period2Metrics.ctr),
      position: this.calculateChange(period1Metrics.position, period2Metrics.position)
    };

    const warnings = [...new Set([...period1Data.warnings, ...period2Data.warnings])];
    if (params.dimensions?.includes('query') || params.dimensions?.includes('page')) {
      warnings.push(
        'Period totals here are sums over lossy detail rows, so both periods under-count and the loss rate ' +
        'can differ between periods. For trustworthy period deltas, compare without page/query dimensions.'
      );
    }

    const response: ComparePeriodsResponse = {
      aggregation_type: period2Data.aggregation_type,
      warnings,
      period1: period1Metrics,
      period2: period2Metrics,
      changes
    };

    if (params.dimensions && params.dimensions.length > 0) {
      response.rows = this.compareRows(period1Data.rows, period2Data.rows);
    }

    return response;
  }

  async topQueries(params: TopQueriesQuery): Promise<SearchAnalyticsResponse & { trend?: Record<string, number[]> }> {
    // Fetch the COMPLETE query row set (internal pagination), sort by the requested
    // metric over the full set, then apply the limit. Selecting rows with a small
    // rowLimit would let the API pre-truncate by clicks-then-alphabetical order and
    // silently omit the largest rows for other metrics.
    const data = await this.query({
      siteUrl: params.siteUrl,
      startDate: params.startDate,
      endDate: params.endDate,
      dimensions: ['query'],
      type: params.type
    });

    const sortedRows = this.sortByMetric(data.rows, params.metric);
    const limited = sortedRows.slice(0, params.limit);

    const result: SearchAnalyticsResponse & { trend?: Record<string, number[]> } = {
      rows: limited,
      aggregation_type: data.aggregation_type,
      count: limited.length,
      total_count: data.total_count ?? data.rows.length,
      has_more: sortedRows.length > limited.length,
      row_ceiling_reached: data.row_ceiling_reached,
      warnings: data.warnings
    };

    if (params.includeTrend) {
      result.trend = await this.getTrendData(
        params.siteUrl,
        params.startDate,
        params.endDate,
        limited.slice(0, Math.min(params.limit, 20)).map((r) => r.keys[0]),
        params.type
      );
    }

    return result;
  }

  async topPages(params: TopPagesQuery): Promise<SearchAnalyticsResponse & { queryBreakdown?: Record<string, SearchAnalyticsRow[]> }> {
    // Same full-set-then-sort contract as topQueries.
    const data = await this.query({
      siteUrl: params.siteUrl,
      startDate: params.startDate,
      endDate: params.endDate,
      dimensions: ['page'],
      type: params.type
    });

    const sortedRows = this.sortByMetric(data.rows, params.metric);
    const limited = sortedRows.slice(0, params.limit);

    const result: SearchAnalyticsResponse & { queryBreakdown?: Record<string, SearchAnalyticsRow[]> } = {
      rows: limited,
      aggregation_type: data.aggregation_type,
      count: limited.length,
      total_count: data.total_count ?? data.rows.length,
      has_more: sortedRows.length > limited.length,
      row_ceiling_reached: data.row_ceiling_reached,
      warnings: data.warnings
    };

    if (params.includeQueryBreakdown) {
      const breakdown: Record<string, SearchAnalyticsRow[]> = {};
      for (const row of limited.slice(0, 10)) {
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

  /**
   * Google's recommended preflight: a bare date-dimension query over the lookback window
   * to learn which dates have data at all, and which are still provisional. Data lands
   * roughly 2–3 days late; never assume the boundary.
   */
  async verifyDataAvailability(params: VerifyDataAvailabilityQuery): Promise<DataAvailabilityResponse> {
    const lookbackDays = params.lookbackDays ?? 10;
    const end = new Date();
    const start = new Date(end.getTime() - (lookbackDays - 1) * 86400000);
    const fmt = (d: Date) => d.toISOString().slice(0, 10);

    const base = {
      siteUrl: params.siteUrl,
      startDate: fmt(start),
      endDate: fmt(end),
      dimensions: ['date' as const],
      type: params.type
    };

    const [allData, finalData] = await Promise.all([
      this.query({ ...base, dataState: 'all' }),
      this.query({ ...base, dataState: 'final' })
    ]);

    const finalDates = new Set(finalData.rows.map((r) => r.keys[0]));
    const days: DataAvailabilityDay[] = allData.rows
      .map((r) => ({
        date: r.keys[0],
        clicks: r.clicks,
        impressions: r.impressions,
        is_final: finalDates.has(r.keys[0])
      }))
      .sort((a, b) => a.date.localeCompare(b.date));

    const latestFinal = [...finalDates].sort().pop() ?? null;
    const provisional = days.filter((d) => !d.is_final).map((d) => d.date);

    const warnings: string[] = [];
    if (provisional.length > 0) {
      warnings.push(
        `Dates ${provisional.join(', ')} are provisional (fresh data, still changing). ` +
        'Reports built on them will not reproduce later.'
      );
    }
    if (days.length === 0) {
      warnings.push('No data in the lookback window — the property may have no traffic or data has not landed yet.');
    }

    return { days, latest_final_date: latestFinal, provisional_dates: provisional, warnings };
  }

  /**
   * The ground-truth denominator: totals with no lossy dimensions. Rejects page/query.
   */
  async accurateTotals(params: AccurateTotalsQuery): Promise<AccurateTotalsResponse> {
    const dimensions = params.dimensions ?? [];

    const data = await this.query({
      siteUrl: params.siteUrl,
      startDate: params.startDate,
      endDate: params.endDate,
      dimensions,
      aggregationType: params.aggregationType,
      dataState: params.dataState,
      type: params.type
    });

    const metrics = this.calculateAggregateMetrics(data.rows);
    const sumPosition = data.rows.reduce((s, r) => s + r.sum_position, 0);

    return {
      totals: { ...metrics, sum_position: sumPosition },
      aggregation_type: data.aggregation_type,
      ...(dimensions.length > 0 ? { rows: data.rows } : {}),
      warnings: data.warnings
    };
  }

  /**
   * Measure what a page/query-grained pull is blind to: runs the detail pull and the
   * matching accurate-totals pull, and reports coverage as a number.
   */
  async coverageReport(params: CoverageReportQuery): Promise<CoverageReportResponse> {
    const dimensionMap = {
      query: ['query' as const],
      page: ['page' as const],
      query_page: ['query' as const, 'page' as const]
    };
    const dimensions = dimensionMap[params.entityType];
    // The denominator must count impressions in the same unit as the detail rows:
    // byProperty for query-only, byPage as soon as 'page' is involved.
    const aggregationType: EffectiveAggregation = params.entityType === 'query' ? 'byProperty' : 'byPage';

    const [detail, totals] = await Promise.all([
      this.query({
        siteUrl: params.siteUrl,
        startDate: params.startDate,
        endDate: params.endDate,
        dimensions,
        aggregationType,
        type: params.type
      }),
      this.accurateTotals({
        siteUrl: params.siteUrl,
        startDate: params.startDate,
        endDate: params.endDate,
        aggregationType,
        type: params.type
      })
    ]);

    const entityImpressions = detail.rows.reduce((s, r) => s + r.impressions, 0);
    const propertyImpressions = totals.totals.impressions;
    const coveragePct = propertyImpressions > 0 ? (entityImpressions / propertyImpressions) * 100 : 100;

    const warnings: string[] = [];
    if (coveragePct < 95) {
      warnings.push(
        `The '${params.entityType}' grain accounts for only ${coveragePct.toFixed(1)}% of impressions in this ` +
        'window. Any per-entity analysis is blind to the remainder. State this coverage alongside conclusions.'
      );
    }
    warnings.push(
      'Coverage varies with window length and over time (Google recomputes the dropped set), so measure it for ' +
      'the exact window you analyze — do not reuse a coverage number across windows.'
    );
    if (detail.row_ceiling_reached) {
      warnings.push('Detail pull hit the row-exposure ceiling; coverage is overstated by the inaccessible tail.');
    }

    return {
      entity_type: params.entityType,
      property_impressions: propertyImpressions,
      entity_impressions: entityImpressions,
      coverage_pct: Math.round(coveragePct * 10) / 10,
      dropped_impressions: propertyImpressions - entityImpressions,
      entity_row_count: detail.rows.length,
      aggregation_type: aggregationType,
      warnings
    };
  }

  /**
   * searchAppearance cannot be combined with other dimensions in one request. This runs
   * Google's documented two-step: enumerate appearance types, then one filtered query per
   * type with the caller's dimensions, and merges the results.
   */
  async searchAppearance(params: SearchAppearanceQuery): Promise<SearchAppearanceResponse> {
    const typesData = await this.query({
      siteUrl: params.siteUrl,
      startDate: params.startDate,
      endDate: params.endDate,
      dimensions: ['searchAppearance'],
      type: params.type
    });

    const breakdowns: SearchAppearanceResponse['breakdowns'] = [];
    let aggregation: EffectiveAggregation = typesData.aggregation_type;
    const warnings = [...typesData.warnings];

    if (params.dimensions && params.dimensions.length > 0) {
      for (const typeRow of typesData.rows) {
        const appearanceType = typeRow.keys[0];
        const breakdown = await this.query({
          siteUrl: params.siteUrl,
          startDate: params.startDate,
          endDate: params.endDate,
          dimensions: params.dimensions,
          filters: [{ dimension: 'searchAppearance', operator: 'equals', expression: appearanceType }],
          type: params.type
        });
        aggregation = breakdown.aggregation_type;
        for (const w of breakdown.warnings) if (!warnings.includes(w)) warnings.push(w);
        breakdowns.push({ appearance_type: appearanceType, rows: breakdown.rows });
      }
    }

    if (typesData.rows.length === 0) {
      warnings.push('No search-appearance (rich result) types recorded for this property in this window.');
    }

    return {
      appearance_types: typesData.rows,
      breakdowns,
      aggregation_type: aggregation,
      warnings
    };
  }

  /**
   * The only way to get query→page attribution — and the single most expensive request
   * the API offers. Always a complete pull with byPage aggregation.
   */
  async queryPagePairs(params: QueryPagePairsQuery): Promise<SearchAnalyticsResponse> {
    return this.query({
      siteUrl: params.siteUrl,
      startDate: params.startDate,
      endDate: params.endDate,
      dimensions: ['query', 'page'],
      aggregationType: 'byPage',
      type: params.type
    });
  }

  private calculateAggregateMetrics(rows: SearchAnalyticsRow[]): PeriodMetrics {
    if (rows.length === 0) {
      return { clicks: 0, impressions: 0, ctr: 0, position: 0 };
    }

    const totalClicks = rows.reduce((sum, row) => sum + row.clicks, 0);
    const totalImpressions = rows.reduce((sum, row) => sum + row.impressions, 0);

    // Position must be recombined by impression weight (sum_position / impressions) —
    // a plain average of row positions is wrong.
    const weightedPosition = rows.reduce((sum, row) => sum + row.sum_position, 0);
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
    // Deterministic tie-breaks: impressions desc, then key asc.
    const tiebreak = (a: SearchAnalyticsRow, b: SearchAnalyticsRow) =>
      b.impressions - a.impressions || a.keys.join('|').localeCompare(b.keys.join('|'));

    switch (metric) {
      case 'impressions':
        sorted.sort((a, b) => b.impressions - a.impressions || tiebreak(a, b));
        break;
      case 'ctr':
        sorted.sort((a, b) => b.ctr - a.ctr || tiebreak(a, b));
        break;
      case 'position':
        sorted.sort((a, b) => a.position - b.position || tiebreak(a, b)); // Lower is better
        break;
      case 'clicks':
      default:
        sorted.sort((a, b) => b.clicks - a.clicks || tiebreak(a, b));
    }

    return sorted;
  }

  private async getTrendData(
    siteUrl: string,
    startDate: string,
    endDate: string,
    queries: string[],
    type?: SearchType
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
