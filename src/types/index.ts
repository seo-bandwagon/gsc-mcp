import { z } from 'zod';

// Site types
export interface Site {
  siteUrl: string;
  permissionLevel: 'siteOwner' | 'siteFullUser' | 'siteRestrictedUser' | 'siteUnverifiedUser';
}

export interface SitesListResponse {
  sites: Site[];
}

// Search Analytics types
export const DimensionSchema = z.enum([
  'query',
  'page',
  'country',
  'device',
  'searchAppearance',
  'date'
]);

export type Dimension = z.infer<typeof DimensionSchema>;

export const FilterOperatorSchema = z.enum([
  'equals',
  'notEquals',
  'contains',
  'notContains',
  'includingRegex',
  'excludingRegex'
]);

export type FilterOperator = z.infer<typeof FilterOperatorSchema>;

export const SearchTypeSchema = z.enum([
  'web',
  'image',
  'video',
  'news',
  'discover',
  'googleNews'
]);

export type SearchType = z.infer<typeof SearchTypeSchema>;

export interface SearchAnalyticsFilter {
  dimension: Dimension;
  operator: FilterOperator;
  expression: string;
}

export const SearchAnalyticsFilterSchema = z.object({
  dimension: DimensionSchema,
  operator: FilterOperatorSchema,
  expression: z.string()
});

export interface SearchAnalyticsRow {
  keys: string[];
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
  /** Derived: impressions × position. Additive across any grouping, unlike `position`. */
  sum_position: number;
}

/** The aggregation unit Google actually used. Never 'auto' — always the resolved value. */
export type EffectiveAggregation = 'byPage' | 'byProperty';

export interface SearchAnalyticsResponse {
  rows: SearchAnalyticsRow[];
  /** Effective aggregation echoed from the API. byProperty and byPage count impressions differently — never compare across the two. */
  aggregation_type: EffectiveAggregation;
  /** Rows in this response. */
  count: number;
  /** Total rows the API exposes for this query. Present only when the server paginated to completeness. */
  total_count?: number;
  has_more: boolean;
  /** startRow to pass to fetch the next page. Present only when has_more. */
  next_offset?: number;
  /** True when the pull hit Google's 50,000-rows/day/search-type exposure ceiling. Rows beyond it are dropped by Google in click-descending order (the lowest-click rows are lost). */
  row_ceiling_reached: boolean;
  warnings: string[];
}

export const ResponseFormatSchema = z.enum(['json', 'markdown']).default('markdown');
export type ResponseFormat = z.infer<typeof ResponseFormatSchema>;

export const SearchAnalyticsQuerySchema = z.object({
  siteUrl: z.string(),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  dimensions: z.array(DimensionSchema).optional(),
  filters: z.array(SearchAnalyticsFilterSchema).optional(),
  rowLimit: z.number().min(1).max(25000).optional(),
  startRow: z.number().min(0).optional(),
  dataState: z.enum(['all', 'final']).optional(),
  aggregationType: z.enum(['auto', 'byPage', 'byProperty']).optional(),
  skipCache: z.boolean().optional(),
  type: SearchTypeSchema.optional()
});

export type SearchAnalyticsQuery = z.infer<typeof SearchAnalyticsQuerySchema>;

// Data availability preflight
export const VerifyDataAvailabilityQuerySchema = z.object({
  siteUrl: z.string(),
  lookbackDays: z.number().min(2).max(60).optional().default(10),
  type: SearchTypeSchema.optional()
});

export type VerifyDataAvailabilityQuery = z.infer<typeof VerifyDataAvailabilityQuerySchema>;

export interface DataAvailabilityDay {
  date: string;
  clicks: number;
  impressions: number;
  is_final: boolean;
}

export interface DataAvailabilityResponse {
  days: DataAvailabilityDay[];
  /** Most recent date with finalized data. Anything later is provisional or absent. */
  latest_final_date: string | null;
  /** Dates with fresh (still-changing) data only. */
  provisional_dates: string[];
  warnings: string[];
}

// Accurate totals (the ground-truth denominator)
export const AccurateTotalsQuerySchema = z.object({
  siteUrl: z.string(),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  aggregationType: z.enum(['byPage', 'byProperty']),
  dimensions: z.array(z.enum(['country', 'device'])).optional(),
  dataState: z.enum(['all', 'final']).optional(),
  type: SearchTypeSchema.optional()
});

export type AccurateTotalsQuery = z.infer<typeof AccurateTotalsQuerySchema>;

export interface AccurateTotalsResponse {
  totals: {
    clicks: number;
    impressions: number;
    /** Derived: clicks / impressions. */
    ctr: number;
    /** Derived: impression-weighted average position (= sum_position / impressions). */
    position: number;
    sum_position: number;
  };
  aggregation_type: EffectiveAggregation;
  rows?: SearchAnalyticsRow[];
  warnings: string[];
}

// Coverage report
export const CoverageReportQuerySchema = z.object({
  siteUrl: z.string(),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  entityType: z.enum(['query', 'page', 'query_page']),
  type: SearchTypeSchema.optional()
});

export type CoverageReportQuery = z.infer<typeof CoverageReportQuerySchema>;

export interface CoverageReportResponse {
  entity_type: 'query' | 'page' | 'query_page';
  /** Property-level impressions from the matching accurate-totals pull (no page/query dimensions). */
  property_impressions: number;
  /** Sum of impressions across the detail rows. */
  entity_impressions: number;
  /** Derived: entity_impressions / property_impressions × 100. */
  coverage_pct: number;
  /** Derived: property_impressions − entity_impressions. Impressions invisible at this grain. */
  dropped_impressions: number;
  entity_row_count: number;
  aggregation_type: EffectiveAggregation;
  warnings: string[];
}

// Search appearance
export const SearchAppearanceQuerySchema = z.object({
  siteUrl: z.string(),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  dimensions: z.array(z.enum(['query', 'page', 'country', 'device', 'date'])).optional(),
  type: SearchTypeSchema.optional()
});

export type SearchAppearanceQuery = z.infer<typeof SearchAppearanceQuerySchema>;

export interface SearchAppearanceResponse {
  appearance_types: SearchAnalyticsRow[];
  breakdowns: { appearance_type: string; rows: SearchAnalyticsRow[] }[];
  aggregation_type: EffectiveAggregation;
  warnings: string[];
}

// Query-page pairs
export const QueryPagePairsQuerySchema = z.object({
  siteUrl: z.string(),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  type: SearchTypeSchema.optional()
});

export type QueryPagePairsQuery = z.infer<typeof QueryPagePairsQuerySchema>;

// Compare periods types
export interface PeriodMetrics {
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

export interface MetricChange {
  absolute: number;
  percentage: number;
}

export interface ComparePeriodsResponse {
  /** Effective aggregation used for both periods. */
  aggregation_type: EffectiveAggregation;
  warnings: string[];
  period1: PeriodMetrics;
  period2: PeriodMetrics;
  changes: {
    clicks: MetricChange;
    impressions: MetricChange;
    ctr: MetricChange;
    position: MetricChange;
  };
  rows?: {
    key: string;
    period1: PeriodMetrics;
    period2: PeriodMetrics;
    changes: {
      clicks: MetricChange;
      impressions: MetricChange;
      ctr: MetricChange;
      position: MetricChange;
    };
  }[];
}

export const ComparePeriodsQuerySchema = z.object({
  siteUrl: z.string(),
  period1Start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  period1End: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  period2Start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  period2End: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  dimensions: z.array(DimensionSchema).optional(),
  filters: z.array(SearchAnalyticsFilterSchema).optional(),
  aggregationType: z.enum(['auto', 'byPage', 'byProperty']).optional(),
  type: SearchTypeSchema.optional()
});

export type ComparePeriodsQuery = z.infer<typeof ComparePeriodsQuerySchema>;

// URL Inspection types.
//
// Google's enums grow over time and undocumented values (e.g. VERDICT_UNSPECIFIED,
// PARTIAL) appear in live responses. These are open string types with the known
// values documented — unknown values pass through verbatim rather than failing
// closed on read-only data.
/** Known values: PASS, PARTIAL, FAIL, NEUTRAL, VERDICT_UNSPECIFIED. Other values pass through as-is. */
export type InspectionVerdict = string;
/** Known values: ALLOWED, DISALLOWED, ROBOTS_TXT_STATE_UNSPECIFIED. */
export type RobotsTxtState = string;
/** Known values: INDEXING_ALLOWED, BLOCKED_BY_META_TAG, BLOCKED_BY_HTTP_HEADER, BLOCKED_BY_ROBOTS_TXT, INDEXING_STATE_UNSPECIFIED. */
export type IndexingState = string;
/** Known values: SUCCESSFUL, SOFT_404, BLOCKED_ROBOTS_TXT, NOT_FOUND, ACCESS_DENIED, SERVER_ERROR, REDIRECT_ERROR, ACCESS_FORBIDDEN, BLOCKED_4XX, INTERNAL_CRAWL_ERROR, INVALID_URL, PAGE_FETCH_STATE_UNSPECIFIED. */
export type PageFetchState = string;

export interface MobileIssue {
  issueType: string;
  /** Known values: WARNING, ERROR. Other values pass through as-is. */
  severity: string;
  message: string;
}

export interface RichResultItem {
  richResultType: string;
  items: { name: string }[];
}

export interface IndexStatusResult {
  verdict: InspectionVerdict;
  coverageState: string;
  robotsTxtState: RobotsTxtState;
  indexingState: IndexingState;
  lastCrawlTime?: string;
  pageFetchState: PageFetchState;
  googleCanonical?: string;
  userCanonical?: string;
  referringUrls?: string[];
  /** Known values: DESKTOP, MOBILE. Other values pass through as-is. */
  crawledAs?: string;
}

export interface MobileUsabilityResult {
  verdict: InspectionVerdict;
  issues: MobileIssue[];
}

export interface RichResultsResult {
  verdict: InspectionVerdict;
  detectedItems: RichResultItem[];
}

export interface InspectionResult {
  inspectionResultLink: string;
  indexStatusResult: IndexStatusResult;
  mobileUsabilityResult?: MobileUsabilityResult;
  richResultsResult?: RichResultsResult;
}

export interface UrlInspectionResponse {
  inspectionResult: InspectionResult;
}

export const InspectUrlQuerySchema = z.object({
  siteUrl: z.string(),
  inspectionUrl: z.string().url()
});

export type InspectUrlQuery = z.infer<typeof InspectUrlQuerySchema>;

export const BulkInspectQuerySchema = z.object({
  siteUrl: z.string(),
  urls: z.array(z.string().url()).min(1).max(100)
});

export type BulkInspectQuery = z.infer<typeof BulkInspectQuerySchema>;

// Sitemap types
export interface SitemapContent {
  type: 'web' | 'image' | 'video' | 'news' | 'mobile' | 'androidApp' | 'iosApp';
  submitted: number;
  indexed: number;
}

export interface Sitemap {
  path: string;
  lastSubmitted: string;
  isPending: boolean;
  isSitemapsIndex: boolean;
  lastDownloaded?: string;
  warnings: number;
  errors: number;
  contents: SitemapContent[];
}

export interface SitemapsListResponse {
  sitemap: Sitemap[];
}

export const SitemapQuerySchema = z.object({
  siteUrl: z.string(),
  sitemapUrl: z.string().url()
});

export type SitemapQuery = z.infer<typeof SitemapQuerySchema>;

// Analysis types
export interface Opportunity {
  type: 'ctr_improvement' | 'ranking_improvement' | 'content_gap' | 'cannibalization' | 'indexing_issue';
  priority: 'high' | 'medium' | 'low';
  title: string;
  description: string;
  queries?: string[];
  pages?: string[];
  estimatedImpact?: {
    additionalClicks: number;
    confidence: 'high' | 'medium' | 'low';
  };
  recommendations: string[];
}

export interface QuickWin {
  type: string;
  description: string;
  queries?: string[];
  pages?: string[];
}

export interface AnalysisResponse {
  opportunities: Opportunity[];
  quickWins: QuickWin[];
  summary: {
    totalOpportunities: number;
    highPriority: number;
    estimatedTotalImpact: number;
  };
}

export const AnalyzeOpportunitiesQuerySchema = z.object({
  siteUrl: z.string(),
  analysisType: z.enum(['quick', 'standard', 'deep']).optional().default('standard'),
  focus: z.array(z.enum(['rankings', 'ctr', 'coverage', 'mobile'])).optional()
});

export type AnalyzeOpportunitiesQuery = z.infer<typeof AnalyzeOpportunitiesQuerySchema>;

export interface ContentGap {
  queryCluster: string;
  queries: string[];
  totalImpressions: number;
  avgPosition: number;
  existingContent: string | null;
  recommendation: string;
}

export interface ContentGapsResponse {
  gaps: ContentGap[];
}

export const ContentGapsQuerySchema = z.object({
  siteUrl: z.string(),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  minImpressions: z.number().optional().default(1)  // Return all data by default
});

export type ContentGapsQuery = z.infer<typeof ContentGapsQuerySchema>;

export interface CannibalizationIssue {
  query: string;
  pages: {
    url: string;
    position: number;
    clicks: number;
    impressions: number;
  }[];
  recommendation: string;
}

export interface CannibalizationResponse {
  cannibalizationIssues: CannibalizationIssue[];
}

export const CannibalizationQuerySchema = z.object({
  siteUrl: z.string(),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  minPages: z.number().optional().default(2)  // 2 is logical minimum for cannibalization
});

export type CannibalizationQuery = z.infer<typeof CannibalizationQuerySchema>;

// Top queries/pages types
export const TopQueriesQuerySchema = z.object({
  siteUrl: z.string(),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  limit: z.number().min(1).max(25000).optional().default(1000),  // Increased max and default
  metric: z.enum(['clicks', 'impressions', 'ctr', 'position']).optional().default('clicks'),
  includeTrend: z.boolean().optional().default(false),
  type: SearchTypeSchema.optional()
});

export type TopQueriesQuery = z.infer<typeof TopQueriesQuerySchema>;

export const TopPagesQuerySchema = z.object({
  siteUrl: z.string(),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  limit: z.number().min(1).max(25000).optional().default(1000),  // Increased max and default
  metric: z.enum(['clicks', 'impressions', 'ctr', 'position']).optional().default('clicks'),
  includeQueryBreakdown: z.boolean().optional().default(false),
  type: SearchTypeSchema.optional()
});

export type TopPagesQuery = z.infer<typeof TopPagesQuerySchema>;

// Sitemap indexation summary types.
//
// Every field traces to the Sitemaps API (sitemaps.list). This is NOT the Search
// Console Index Coverage report — no such report is exposed by the public API.
export interface SitemapIndexationEntry {
  path: string;
  last_submitted: string;
  /** When Google last fetched this sitemap file. Old dates mean the counts below are stale. */
  last_downloaded: string | null;
  is_pending: boolean;
  is_sitemaps_index: boolean;
  sitemap_file_errors: number;
  sitemap_file_warnings: number;
  submitted_urls: number;
  indexed_urls: number;
  by_content_type: SitemapContent[];
}

export interface SitemapIndexationSummaryResponse {
  summary: {
    /** Σ `submitted` across sitemap contents, as reported by the Sitemaps API. */
    submitted_urls: number;
    /** Σ `indexed` across sitemap contents, as reported by the Sitemaps API. */
    indexed_urls: number;
    /** Count of sitemap FILE errors (problems reading the sitemap itself), not URL indexing errors. */
    sitemap_file_errors: number;
    sitemap_file_warnings: number;
    /** Oldest last_downloaded across the included sitemaps — the staleness bound for all counts here. */
    oldest_last_downloaded: string | null;
  };
  sitemaps: SitemapIndexationEntry[];
  warnings: string[];
}

export const SitemapIndexationQuerySchema = z.object({
  siteUrl: z.string(),
  sitemapUrl: z.string().url().optional()
});

export type SitemapIndexationQuery = z.infer<typeof SitemapIndexationQuerySchema>;

// Error types
export interface GSCError {
  code: string;
  message: string;
  retryAfter?: number;
  details?: Record<string, unknown>;
}

export class GSCApiError extends Error {
  code: string;
  retryAfter?: number;
  details?: Record<string, unknown>;

  constructor(error: GSCError) {
    super(error.message);
    this.name = 'GSCApiError';
    this.code = error.code;
    this.retryAfter = error.retryAfter;
    this.details = error.details;
  }
}

// Cache types
export interface CacheEntry {
  key: string;
  data: string;
  timestamp: number;
  ttl: number;
}

// OAuth types
export interface OAuthTokens {
  access_token: string;
  refresh_token: string;
  scope: string;
  token_type: string;
  expiry_date: number;
}

// Config types
export interface GSCConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  tokenPath: string;
  cachePath: string;
  cacheTtl: number;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
}
