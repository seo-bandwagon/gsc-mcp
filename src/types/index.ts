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
}

export interface SearchAnalyticsResponse {
  rows: SearchAnalyticsRow[];
  responseAggregationType: 'auto' | 'byPage' | 'byProperty';
}

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
  type: SearchTypeSchema.optional()
});

export type ComparePeriodsQuery = z.infer<typeof ComparePeriodsQuerySchema>;

// URL Inspection types
export type InspectionVerdict = 'PASS' | 'NEUTRAL' | 'FAIL';
export type RobotsTxtState = 'ALLOWED' | 'DISALLOWED';
export type IndexingState = 'INDEXING_ALLOWED' | 'BLOCKED_BY_META_TAG' | 'BLOCKED_BY_HTTP_HEADER' | 'RESERVED';
export type PageFetchState =
  | 'SUCCESSFUL'
  | 'SOFT_404'
  | 'BLOCKED_ROBOTS_TXT'
  | 'NOT_FOUND'
  | 'ACCESS_DENIED'
  | 'SERVER_ERROR'
  | 'REDIRECT_ERROR'
  | 'ACCESS_FORBIDDEN'
  | 'BLOCKED_4XX'
  | 'INTERNAL_CRAWL_ERROR'
  | 'INVALID_URL';

export interface MobileIssue {
  issueType: string;
  severity: 'WARNING' | 'ERROR';
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
  crawledAs?: 'DESKTOP' | 'MOBILE';
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

// Index coverage types
export interface IndexCoverageSummary {
  totalUrls: number;
  indexed: number;
  excluded: number;
  error: number;
}

export interface IndexCoverageResponse {
  summary: IndexCoverageSummary;
  exclusionReasons: Record<string, number>;
}

export const IndexCoverageQuerySchema = z.object({
  siteUrl: z.string(),
  sitemapUrl: z.string().url().optional()
});

export type IndexCoverageQuery = z.infer<typeof IndexCoverageQuerySchema>;

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
