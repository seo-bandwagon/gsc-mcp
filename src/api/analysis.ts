import { SearchAnalyticsApi } from './search-analytics.js';
import { UrlInspectionApi } from './url-inspection.js';
import { SitemapsApi } from './sitemaps.js';
import type { GSCClient } from './client.js';
import type {
  AnalyzeOpportunitiesQuery,
  AnalysisResponse,
  Opportunity,
  QuickWin,
  ContentGapsQuery,
  ContentGapsResponse,
  ContentGap,
  CannibalizationQuery,
  CannibalizationResponse,
  CannibalizationIssue,
  SearchAnalyticsRow
} from '../types/index.js';
import { getDateRange } from '../utils/date.js';

export class AnalysisApi {
  private client: GSCClient;
  private searchAnalytics: SearchAnalyticsApi;
  private urlInspection: UrlInspectionApi;
  private sitemaps: SitemapsApi;

  constructor(client: GSCClient) {
    this.client = client;
    this.searchAnalytics = new SearchAnalyticsApi(client);
    this.urlInspection = new UrlInspectionApi(client);
    this.sitemaps = new SitemapsApi(client);
  }

  async analyzeOpportunities(params: AnalyzeOpportunitiesQuery): Promise<AnalysisResponse> {
    const opportunities: Opportunity[] = [];
    const quickWins: QuickWin[] = [];

    // Determine date range based on analysis type
    const days = params.analysisType === 'quick' ? 7 : params.analysisType === 'deep' ? 90 : 28;
    const { startDate, endDate } = getDateRange(days);

    const focusAreas = params.focus || ['rankings', 'ctr', 'coverage', 'mobile'];

    // Analyze CTR opportunities
    if (focusAreas.includes('ctr')) {
      const ctrOpportunities = await this.analyzeCtrOpportunities(
        params.siteUrl,
        startDate,
        endDate
      );
      opportunities.push(...ctrOpportunities.opportunities);
      quickWins.push(...ctrOpportunities.quickWins);
    }

    // Analyze ranking opportunities
    if (focusAreas.includes('rankings')) {
      const rankingOpportunities = await this.analyzeRankingOpportunities(
        params.siteUrl,
        startDate,
        endDate
      );
      opportunities.push(...rankingOpportunities.opportunities);
      quickWins.push(...rankingOpportunities.quickWins);
    }

    // Analyze coverage/indexing issues
    if (focusAreas.includes('coverage')) {
      const coverageOpportunities = await this.analyzeCoverageOpportunities(
        params.siteUrl,
        startDate,
        endDate,
        days
      );
      opportunities.push(...coverageOpportunities);
    }

    // Sort by priority
    opportunities.sort((a, b) => {
      const priorityOrder = { high: 0, medium: 1, low: 2 };
      return priorityOrder[a.priority] - priorityOrder[b.priority];
    });

    // Calculate summary
    const highPriority = opportunities.filter((o) => o.priority === 'high').length;
    const estimatedTotalImpact = opportunities.reduce(
      (sum, o) => sum + (o.estimatedImpact?.additionalClicks || 0),
      0
    );

    return {
      opportunities,
      quickWins,
      summary: {
        totalOpportunities: opportunities.length,
        highPriority,
        estimatedTotalImpact
      }
    };
  }

  private async analyzeCtrOpportunities(
    siteUrl: string,
    startDate: string,
    endDate: string
  ): Promise<{ opportunities: Opportunity[]; quickWins: QuickWin[] }> {
    const opportunities: Opportunity[] = [];
    const quickWins: QuickWin[] = [];

    // Get queries with high impressions but low CTR
    const data = await this.searchAnalytics.query({
      siteUrl,
      startDate,
      endDate,
      dimensions: ['query'],
      rowLimit: 1000
    });

    // Find queries with low CTR (<2%) - no impression threshold, return all data
    const lowCtrQueries = data.rows.filter(
      (row) => row.ctr < 0.02
    );

    if (lowCtrQueries.length > 0) {
      // Group by CTR ranges
      const veryLowCtr = lowCtrQueries.filter((r) => r.ctr < 0.01);
      const lowCtr = lowCtrQueries.filter((r) => r.ctr >= 0.01 && r.ctr < 0.02);

      if (veryLowCtr.length > 0) {
        const estimatedImpact = this.estimateCtrImpact(veryLowCtr, 0.02);

        opportunities.push({
          type: 'ctr_improvement',
          priority: 'high',
          title: 'Critical CTR improvement needed',
          description: `${veryLowCtr.length} queries have <1% CTR`,
          queries: veryLowCtr.slice(0, 10).map((r) => r.keys[0]),
          estimatedImpact,
          recommendations: [
            'Update title tags to be more compelling and include target keywords',
            'Write unique, action-oriented meta descriptions for each page',
            'Consider adding structured data for rich snippets (FAQ, How-to, etc.)',
            'Review competitor titles for these queries and differentiate'
          ]
        });
      }

      if (lowCtr.length > 0) {
        const estimatedImpact = this.estimateCtrImpact(lowCtr, 0.03);

        opportunities.push({
          type: 'ctr_improvement',
          priority: 'medium',
          title: 'CTR optimization opportunity',
          description: `${lowCtr.length} queries have decent visibility but CTR between 1-2%`,
          queries: lowCtr.slice(0, 10).map((r) => r.keys[0]),
          estimatedImpact,
          recommendations: [
            'A/B test different title variations',
            'Add numbers or dates to titles where relevant',
            'Include emotional triggers or power words',
            'Ensure meta descriptions have clear calls-to-action'
          ]
        });
      }
    }

    // Quick wins: Position 1-3 with below-average CTR - no impression threshold
    const topPositionLowCtr = data.rows.filter(
      (row) => row.position <= 3 && row.ctr < 0.1
    );

    if (topPositionLowCtr.length > 0) {
      quickWins.push({
        type: 'ctr_improvement',
        description: `${topPositionLowCtr.length} queries ranking #1-3 with below-average CTR - easy wins with title/meta updates`,
        queries: topPositionLowCtr.slice(0, 5).map((r) => r.keys[0])
      });
    }

    return { opportunities, quickWins };
  }

  private async analyzeRankingOpportunities(
    siteUrl: string,
    startDate: string,
    endDate: string
  ): Promise<{ opportunities: Opportunity[]; quickWins: QuickWin[] }> {
    const opportunities: Opportunity[] = [];
    const quickWins: QuickWin[] = [];

    const data = await this.searchAnalytics.query({
      siteUrl,
      startDate,
      endDate,
      dimensions: ['query'],
      rowLimit: 1000
    });

    // Find queries ranking positions 4-10 (striking distance) - no impression threshold
    const strikingDistance = data.rows.filter(
      (row) => row.position >= 4 && row.position <= 10
    );

    if (strikingDistance.length > 0) {
      const estimatedImpact = this.estimateRankingImpact(strikingDistance);

      opportunities.push({
        type: 'ranking_improvement',
        priority: 'high',
        title: 'Striking distance keywords',
        description: `${strikingDistance.length} queries ranking positions 4-10 with good impression volume`,
        queries: strikingDistance.slice(0, 15).map((r) => r.keys[0]),
        estimatedImpact,
        recommendations: [
          'Add more comprehensive content to target pages',
          'Build internal links from high-authority pages',
          'Update content to be more current and relevant',
          'Improve page speed and Core Web Vitals',
          'Add relevant images, videos, or interactive elements'
        ]
      });

      quickWins.push({
        type: 'ranking_improvement',
        description: `${strikingDistance.slice(0, 10).length} queries in striking distance (positions 4-10)`,
        queries: strikingDistance.slice(0, 5).map((r) => r.keys[0])
      });
    }

    // Find queries ranking 11-20 (page 2) - no impression threshold
    const page2 = data.rows.filter(
      (row) => row.position > 10 && row.position <= 20
    );

    if (page2.length > 0) {
      opportunities.push({
        type: 'ranking_improvement',
        priority: 'medium',
        title: 'Page 2 keywords with potential',
        description: `${page2.length} queries ranking on page 2`,
        queries: page2.slice(0, 10).map((r) => r.keys[0]),
        estimatedImpact: {
          additionalClicks: Math.round(page2.reduce((sum, r) => sum + r.impressions * 0.02, 0)),
          confidence: 'low'
        },
        recommendations: [
          'Create more in-depth content targeting these queries',
          'Analyze competitor content for gaps',
          'Consider creating dedicated landing pages',
          'Build quality backlinks to these pages'
        ]
      });
    }

    return { opportunities, quickWins };
  }

  private async analyzeCoverageOpportunities(
    siteUrl: string,
    startDate: string,
    endDate: string,
    analysisDays: number
  ): Promise<Opportunity[]> {
    const opportunities: Opportunity[] = [];

    try {
      const health = await this.sitemaps.getSitemapHealth(siteUrl);

      // Don't trust contents[].indexed from the Sitemaps API — it's deprecated
      // and frequently returns 0 even for fully-indexed sitemaps. Instead,
      // count submitted URLs that received impressions in the analysis window:
      // a URL with impressions is by definition indexed. Skip the heuristic
      // for tiny sitemaps where Search Analytics noise dominates.
      if (health.totalUrls >= 20) {
        const sa = await this.searchAnalytics.query({
          siteUrl,
          startDate,
          endDate,
          dimensions: ['page'],
          rowLimit: 25000
        });
        const pagesWithImpressions = sa.rows.length;
        const coverage = pagesWithImpressions / health.totalUrls;

        if (coverage < 0.30) {
          opportunities.push({
            type: 'indexing_issue',
            priority: coverage < 0.10 ? 'high' : 'medium',
            title: 'Low search visibility for submitted URLs',
            description: `Only ${pagesWithImpressions} of ${health.totalUrls} submitted URLs received impressions in the last ${analysisDays} days (${(coverage * 100).toFixed(1)}%), which can indicate indexation gaps.`,
            recommendations: [
              'Spot-check a few sitemap URLs with the URL Inspection tool to confirm indexation status',
              'Review the Pages report in Search Console for excluded reasons',
              'Ensure all submitted URLs return 200 and are not blocked by robots.txt or noindex',
              'Improve internal linking to orphan pages',
              'Note: low-traffic pages can be indexed without impressions — verify before acting'
            ]
          });
        }
      }

      // Sitemap-level errors. The warnings counter from this API often diverges
      // from the GSC UI, so we intentionally only flag errors here.
      const errorCount = health.issues.filter((i) => i.type === 'error').length;
      if (errorCount > 0) {
        opportunities.push({
          type: 'indexing_issue',
          priority: 'high',
          title: 'Sitemap errors detected',
          description: `${errorCount} sitemaps have errors that need attention`,
          recommendations: [
            'Check sitemap format and validate against schema',
            'Ensure all URLs in sitemap are accessible',
            'Remove URLs that return 4xx or 5xx errors',
            'Update lastmod dates to reflect actual changes'
          ]
        });
      }
    } catch {
      // Sitemap analysis failed, skip
    }

    return opportunities;
  }

  async findContentGaps(params: ContentGapsQuery): Promise<ContentGapsResponse> {
    const gaps: ContentGap[] = [];

    // Get queries where we're ranking but not in top positions
    const data = await this.searchAnalytics.query({
      siteUrl: params.siteUrl,
      startDate: params.startDate,
      endDate: params.endDate,
      dimensions: ['query', 'page'],
      rowLimit: 5000
    });

    // Filter by minimum impressions
    const relevantQueries = data.rows.filter((row) => row.impressions >= params.minImpressions);

    // Group by query patterns to find clusters
    const queryClusters = this.clusterQueries(relevantQueries);

    for (const [pattern, queries] of Object.entries(queryClusters)) {
      const totalImpressions = queries.reduce((sum, q) => sum + q.impressions, 0);

      // Skip clusters with zero impressions: weighted-avg position would be
      // 0/0 = NaN, and a content gap with no impressions isn't a gap.
      if (totalImpressions === 0) continue;

      const avgPosition =
        queries.reduce((sum, q) => sum + q.position * q.impressions, 0) / totalImpressions;

      // Include all content gaps regardless of position - let users filter
      if (avgPosition > 1) {
        gaps.push({
          queryCluster: pattern,
          queries: queries.slice(0, 10).map((q) => q.keys[0]),
          totalImpressions,
          avgPosition,
          existingContent: queries[0]?.keys[1] || null, // Page if available
          recommendation: this.generateContentRecommendation(pattern, avgPosition)
        });
      }
    }

    // Sort by total impressions
    gaps.sort((a, b) => b.totalImpressions - a.totalImpressions);

    return { gaps: gaps.slice(0, 20) };
  }

  async checkCannibalization(params: CannibalizationQuery): Promise<CannibalizationResponse> {
    const issues: CannibalizationIssue[] = [];

    // Get queries with page dimension
    const data = await this.searchAnalytics.query({
      siteUrl: params.siteUrl,
      startDate: params.startDate,
      endDate: params.endDate,
      dimensions: ['query', 'page'],
      rowLimit: 10000
    });

    // Group by query
    const queryPages = new Map<string, SearchAnalyticsRow[]>();

    for (const row of data.rows) {
      const query = row.keys[0];
      if (!queryPages.has(query)) {
        queryPages.set(query, []);
      }
      queryPages.get(query)!.push(row);
    }

    // Find queries with multiple ranking pages
    for (const [query, pages] of queryPages.entries()) {
      if (pages.length >= params.minPages) {
        // Sort by clicks
        pages.sort((a, b) => b.clicks - a.clicks);

        // Check if there's significant traffic split
        const totalClicks = pages.reduce((sum, p) => sum + p.clicks, 0);
        const topPageClicks = pages[0].clicks;

        // Skip queries with no clicks across any page: 0/0 = NaN compares
        // false here, but the silent skip is fragile. Make it explicit.
        if (totalClicks === 0) continue;

        // If top page doesn't get majority of clicks, it's a cannibalization issue - no click threshold
        if (topPageClicks / totalClicks < 0.7) {
          issues.push({
            query,
            pages: pages.map((p) => ({
              url: p.keys[1],
              position: p.position,
              clicks: p.clicks,
              impressions: p.impressions
            })),
            recommendation: this.generateCannibalizationRecommendation(pages)
          });
        }
      }
    }

    // Sort by total traffic impact
    issues.sort((a, b) => {
      const totalA = a.pages.reduce((sum, p) => sum + p.clicks, 0);
      const totalB = b.pages.reduce((sum, p) => sum + p.clicks, 0);
      return totalB - totalA;
    });

    return { cannibalizationIssues: issues.slice(0, 50) };
  }

  private estimateCtrImpact(
    rows: SearchAnalyticsRow[],
    targetCtr: number
  ): { additionalClicks: number; confidence: 'high' | 'medium' | 'low' } {
    let additionalClicks = 0;

    for (const row of rows) {
      const currentClicks = row.clicks;
      const potentialClicks = row.impressions * targetCtr;
      additionalClicks += Math.max(0, potentialClicks - currentClicks);
    }

    return {
      additionalClicks: Math.round(additionalClicks),
      confidence: rows.length > 20 ? 'medium' : 'low'
    };
  }

  private estimateRankingImpact(
    rows: SearchAnalyticsRow[]
  ): { additionalClicks: number; confidence: 'high' | 'medium' | 'low' } {
    // CTR estimates by position (rough industry averages)
    const ctrByPosition: Record<number, number> = {
      1: 0.30,
      2: 0.15,
      3: 0.10,
      4: 0.07,
      5: 0.05,
      6: 0.04,
      7: 0.03,
      8: 0.03,
      9: 0.02,
      10: 0.02
    };

    let additionalClicks = 0;

    for (const row of rows) {
      const currentPosition = Math.round(row.position);
      const targetPosition = Math.max(1, currentPosition - 3); // Assume we can improve by 3 positions

      const currentCtr = ctrByPosition[currentPosition] || 0.02;
      const targetCtr = ctrByPosition[targetPosition] || 0.05;

      const potentialClicks = row.impressions * targetCtr;
      const currentClicks = row.impressions * currentCtr;

      additionalClicks += Math.max(0, potentialClicks - currentClicks);
    }

    return {
      additionalClicks: Math.round(additionalClicks),
      confidence: 'medium'
    };
  }

  private clusterQueries(
    rows: SearchAnalyticsRow[]
  ): Record<string, SearchAnalyticsRow[]> {
    const clusters: Record<string, SearchAnalyticsRow[]> = {};

    // Stable pattern KEYS, not the captured match. Previously this used
    // `query.match(/^how to .+/)?.[0]` which captured the full query, so
    // every "how to ..." query landed in its own cluster and the length>=2
    // filter eliminated all clusters.
    const patternRules: Array<{ key: string; test: (q: string) => boolean }> = [
      { key: 'how to', test: (q) => /^how to .+/.test(q) },
      { key: 'what is', test: (q) => /^what is .+/.test(q) },
      { key: 'best', test: (q) => /^best .+/.test(q) },
      { key: 'vs', test: (q) => / vs /.test(q) },
      { key: 'tutorial', test: (q) => / tutorial\b/.test(q) || /\btutorial$/.test(q) },
      { key: 'guide', test: (q) => / guide\b/.test(q) || /\bguide$/.test(q) }
    ];

    for (const row of rows) {
      const query = row.keys[0].toLowerCase();

      const matched = patternRules.find((r) => r.test(query));
      const pattern = matched?.key || query.split(' ').slice(0, 3).join(' ');

      if (!clusters[pattern]) {
        clusters[pattern] = [];
      }
      clusters[pattern].push(row);
    }

    // Only return clusters with multiple queries
    return Object.fromEntries(
      Object.entries(clusters).filter(([, queries]) => queries.length >= 2)
    );
  }

  private generateContentRecommendation(pattern: string, avgPosition: number): string {
    if (pattern.startsWith('how to')) {
      return 'Create a comprehensive step-by-step guide with visuals';
    }
    if (pattern.startsWith('what is')) {
      return 'Create an in-depth explainer article with examples';
    }
    if (pattern.startsWith('best')) {
      return 'Create a comparison/review article with pros and cons';
    }
    if (pattern.includes(' vs ')) {
      return 'Create a detailed comparison article';
    }
    if (avgPosition > 10) {
      return 'Create dedicated, comprehensive content targeting this query cluster';
    }
    return 'Improve existing content with more depth and better optimization';
  }

  private generateCannibalizationRecommendation(pages: SearchAnalyticsRow[]): string {
    if (pages.length === 2) {
      return 'Consider consolidating these two pages into one comprehensive piece, or differentiate their intent more clearly';
    }
    if (pages.length > 3) {
      return 'Multiple pages competing. Identify the best performer and redirect others, or create a hub page linking to specialized content';
    }
    return 'Consolidate content or differentiate page intent with different keywords and content focus';
  }
}
