#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema
} from '@modelcontextprotocol/sdk/types.js';

import { GSCClient } from './api/client.js';
import { createTools } from './tools/index.js';
import { getConfig, validateConfig } from './utils/config.js';
import { getDateRange, formatDate } from './utils/date.js';
import { SitesApi } from './api/sites.js';
import { SearchAnalyticsApi } from './api/search-analytics.js';
import { GUIDANCE_RESOURCES } from './resources/guidance.js';

async function main() {
  const config = getConfig();

  // Validate configuration
  try {
    validateConfig(config);
  } catch (error) {
    console.error('Configuration error:', error instanceof Error ? error.message : error);
    console.error('\nPlease set the required environment variables:');
    console.error('  GSC_CLIENT_ID=your-client-id');
    console.error('  GSC_CLIENT_SECRET=your-client-secret');
    console.error('\nSee README.md for setup instructions.');
    process.exit(1);
  }

  // Initialize client
  const client = new GSCClient(config);

  try {
    await client.initialize();
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    console.error('═══════════════════════════════════════════════════════════════');
    console.error('GSC MCP Server - Initialization Failed');
    console.error('═══════════════════════════════════════════════════════════════');
    console.error('');
    console.error('Error:', errorMessage);
    console.error('');

    // Provide specific guidance based on error type
    if (errorMessage.includes('deleted_client') || errorMessage.includes('deleted')) {
      console.error('DIAGNOSIS: OAuth credentials have been deleted in Google Cloud Console.');
      console.error('');
      console.error('FIX:');
      console.error('  1. Go to https://console.cloud.google.com/apis/credentials');
      console.error('  2. Create new OAuth 2.0 credentials (Desktop app)');
      console.error('  3. Update GSC_CLIENT_ID and GSC_CLIENT_SECRET in Claude Desktop config');
      console.error('  4. Run: rm ~/.gsc-mcp/tokens.json');
      console.error('  5. Run: npm run auth');
    } else if (errorMessage.includes('unauthorized_client') || errorMessage.includes('invalid')) {
      console.error('DIAGNOSIS: OAuth tokens are invalid or corrupted.');
      console.error('');
      console.error('FIX:');
      console.error('  1. Run: rm ~/.gsc-mcp/tokens.json');
      console.error('  2. Run: npm run auth');
    } else if (errorMessage.includes('invalid_grant') || errorMessage.includes('revoked')) {
      console.error('DIAGNOSIS: Refresh token has been revoked.');
      console.error('');
      console.error('FIX:');
      console.error('  1. Run: rm ~/.gsc-mcp/tokens.json');
      console.error('  2. Run: npm run auth');
    } else if (errorMessage.includes('No token file') || errorMessage.includes('Not authenticated')) {
      console.error('DIAGNOSIS: No authentication tokens found.');
      console.error('');
      console.error('FIX:');
      console.error('  Run: npm run auth');
    } else {
      console.error('DIAGNOSIS: Unknown initialization error.');
      console.error('');
      console.error('TROUBLESHOOTING:');
      console.error('  1. Verify GSC_CLIENT_ID and GSC_CLIENT_SECRET are set correctly');
      console.error('  2. Check if token file exists: ls -la ~/.gsc-mcp/tokens.json');
      console.error('  3. Try re-authenticating: rm ~/.gsc-mcp/tokens.json && npm run auth');
      console.error('  4. See TROUBLESHOOTING.md for more help');
    }

    console.error('');
    console.error('═══════════════════════════════════════════════════════════════');
    process.exit(1);
  }

  // Create tools
  const { tools, handlers } = createTools(client);

  // Create MCP server
  const server = new Server(
    {
      name: 'gsc-mcp-server',
      version: '0.2.0'
    },
    {
      capabilities: {
        tools: {},
        resources: {},
        prompts: {}
      }
    }
  );

  // Handle tool listing
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return { tools };
  });

  // Handle tool calls
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    const handler = handlers.get(name);
    if (!handler) {
      const err = { error: { code: 'UNKNOWN_TOOL', message: `Unknown tool: ${name}` } };
      return {
        content: [{ type: 'text', text: JSON.stringify(err) }],
        structuredContent: err,
        isError: true
      };
    }

    const result = await handler(args || {});
    return {
      content: [{ type: 'text', text: result.text }],
      ...(result.structured !== undefined ? { structuredContent: result.structured as Record<string, unknown> } : {}),
      ...(result.isError ? { isError: true } : {})
    };
  });

  // Handle resource listing
  server.setRequestHandler(ListResourcesRequestSchema, async () => {
    const sitesApi = new SitesApi(client);
    const { sites } = await sitesApi.listSites();

    const resources = [
      ...GUIDANCE_RESOURCES.map(({ uri, name, description, mimeType }) => ({ uri, name, description, mimeType })),
      {
        uri: 'gsc://sites',
        name: 'All Sites',
        description: 'List of all verified sites in your Search Console account',
        mimeType: 'application/json'
      }
    ];

    // Add resources for each site
    for (const site of sites) {
      const encodedUrl = encodeURIComponent(site.siteUrl);
      resources.push(
        {
          uri: `gsc://site/${encodedUrl}/summary`,
          name: `${site.siteUrl} - Summary`,
          description: `Performance summary for ${site.siteUrl}`,
          mimeType: 'application/json'
        },
        {
          uri: `gsc://site/${encodedUrl}/alerts`,
          name: `${site.siteUrl} - Alerts`,
          description: `Active issues and alerts for ${site.siteUrl}`,
          mimeType: 'application/json'
        }
      );
    }

    return { resources };
  });

  // Handle resource reading
  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    const { uri } = request.params;

    const guidance = GUIDANCE_RESOURCES.find((r) => r.uri === uri);
    if (guidance) {
      return {
        contents: [{ uri, mimeType: guidance.mimeType, text: guidance.text }]
      };
    }

    if (uri === 'gsc://sites') {
      const sitesApi = new SitesApi(client);
      const result = await sitesApi.listSites();
      return {
        contents: [
          {
            uri,
            mimeType: 'application/json',
            text: JSON.stringify(result, null, 2)
          }
        ]
      };
    }

    const summaryMatch = uri.match(/^gsc:\/\/site\/(.+)\/summary$/);
    if (summaryMatch) {
      const siteUrl = decodeURIComponent(summaryMatch[1]);
      const searchAnalyticsApi = new SearchAnalyticsApi(client);
      const { startDate, endDate } = getDateRange(28);

      // Totals must come from a dimensionless pull — summing top-N query rows both
      // truncates and inherits query-grain data loss.
      const [totalsData, queryData, pageData] = await Promise.all([
        searchAnalyticsApi.accurateTotals({
          siteUrl,
          startDate,
          endDate,
          aggregationType: 'byProperty'
        }),
        searchAnalyticsApi.topQueries({
          siteUrl,
          startDate,
          endDate,
          limit: 5,
          metric: 'clicks',
          includeTrend: false
        }),
        searchAnalyticsApi.topPages({
          siteUrl,
          startDate,
          endDate,
          limit: 5,
          metric: 'clicks',
          includeQueryBreakdown: false
        })
      ]);

      const summary = {
        siteUrl,
        period: { startDate, endDate },
        aggregation_type: totalsData.aggregation_type,
        totals: totalsData.totals,
        topQueries: queryData.rows,
        topPages: pageData.rows
      };

      return {
        contents: [
          {
            uri,
            mimeType: 'application/json',
            text: JSON.stringify(summary, null, 2)
          }
        ]
      };
    }

    const alertsMatch = uri.match(/^gsc:\/\/site\/(.+)\/alerts$/);
    if (alertsMatch) {
      const siteUrl = decodeURIComponent(alertsMatch[1]);
      const searchAnalyticsApi = new SearchAnalyticsApi(client);

      // Compare last 7 days to previous 7 days
      const { startDate: currentStart, endDate: currentEnd } = getDateRange(7);
      const previousEnd = new Date(currentStart);
      previousEnd.setDate(previousEnd.getDate() - 1);
      const previousStart = new Date(previousEnd);
      previousStart.setDate(previousStart.getDate() - 6);

      const comparison = await searchAnalyticsApi.comparePeriods({
        siteUrl,
        period1Start: formatDate(previousStart),
        period1End: formatDate(previousEnd),
        period2Start: currentStart,
        period2End: currentEnd
      });

      const alerts = [];

      // Check for significant drops
      if (comparison.changes.clicks.percentage < -20) {
        alerts.push({
          type: 'warning',
          message: `Clicks dropped ${Math.abs(comparison.changes.clicks.percentage).toFixed(1)}% compared to previous week`
        });
      }

      if (comparison.changes.impressions.percentage < -20) {
        alerts.push({
          type: 'warning',
          message: `Impressions dropped ${Math.abs(comparison.changes.impressions.percentage).toFixed(1)}% compared to previous week`
        });
      }

      if (comparison.changes.position.absolute > 2) {
        alerts.push({
          type: 'warning',
          message: `Average position worsened by ${comparison.changes.position.absolute.toFixed(1)} positions`
        });
      }

      // Check for positive trends
      if (comparison.changes.clicks.percentage > 20) {
        alerts.push({
          type: 'success',
          message: `Clicks increased ${comparison.changes.clicks.percentage.toFixed(1)}% compared to previous week`
        });
      }

      return {
        contents: [
          {
            uri,
            mimeType: 'application/json',
            text: JSON.stringify({ siteUrl, alerts, comparison }, null, 2)
          }
        ]
      };
    }

    return {
      contents: [
        {
          uri,
          mimeType: 'text/plain',
          text: `Unknown resource: ${uri}`
        }
      ]
    };
  });

  // Handle prompt listing
  server.setRequestHandler(ListPromptsRequestSchema, async () => {
    return {
      prompts: [
        {
          name: 'gsc_daily_pull',
          description: "Google's recommended daily data pull: availability preflight, accurate totals under both aggregation types, detail pulls, and a coverage report. Encodes the trailing-10-day upsert window.",
          arguments: [
            { name: 'siteUrl', description: 'The property to pull', required: true }
          ]
        },
        {
          name: 'gsc_coverage_audit',
          description: 'Measure what a query/page-grained analysis is blind to — run BEFORE the analysis is written, and state coverage in it.',
          arguments: [
            { name: 'siteUrl', description: 'The property to audit', required: true },
            { name: 'startDate', description: 'Window start (YYYY-MM-DD)', required: true },
            { name: 'endDate', description: 'Window end (YYYY-MM-DD)', required: true }
          ]
        },
        {
          name: 'gsc_position_decomposition',
          description: 'Attribute the sitewide average position across pages by position mass (sum_position), so ranking changes are never misattributed.',
          arguments: [
            { name: 'siteUrl', description: 'The property to decompose', required: true },
            { name: 'startDate', description: 'Window start (YYYY-MM-DD)', required: true },
            { name: 'endDate', description: 'Window end (YYYY-MM-DD)', required: true }
          ]
        },
        {
          name: 'analyze-site',
          description: 'Comprehensive site analysis with performance metrics and recommendations',
          arguments: [
            {
              name: 'siteUrl',
              description: 'The site URL to analyze',
              required: true
            },
            {
              name: 'timeframe',
              description: 'Analysis period: 7d, 30d, or 90d',
              required: false
            }
          ]
        },
        {
          name: 'weekly-report',
          description: 'Generate a weekly SEO performance report',
          arguments: [
            {
              name: 'siteUrl',
              description: 'The site URL for the report',
              required: true
            }
          ]
        },
        {
          name: 'find-quick-wins',
          description: 'Find quick SEO wins that can be implemented immediately',
          arguments: [
            {
              name: 'siteUrl',
              description: 'The site URL to analyze',
              required: true
            }
          ]
        }
      ]
    };
  });

  // Handle prompt requests
  server.setRequestHandler(GetPromptRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    switch (name) {
      case 'gsc_daily_pull': {
        const siteUrl = args?.siteUrl || '{siteUrl}';

        return {
          messages: [
            {
              role: 'user',
              content: {
                type: 'text',
                text: `Run the daily Search Console data pull for ${siteUrl}, following Google's recommended pattern exactly:

1. PREFLIGHT — gsc_verify_data_availability(siteUrl: "${siteUrl}", lookbackDays: 10).
   Note latest_final_date. Data lands ~2–3 days late; do not assume the boundary.
   Because Google can revise recent days, treat the trailing 10 days as an UPSERT window:
   re-pull and overwrite any previously stored values for those dates.

2. GROUND TRUTH — gsc_accurate_totals for yesterday's finalized date range under BOTH aggregation types:
   - aggregationType "byProperty" (property-unit impressions)
   - aggregationType "byPage" (page-unit impressions)
   Record both, always labeled with their aggregation_type. Never mix or reconcile them.

3. DETAIL — gsc_search_analytics pulls for the same range:
   - dimensions ["date"] (lossless time series)
   - dimensions ["country","device"] (lossless breakdown)
   - dimensions ["query"] and dimensions ["page"] for entity detail

4. COVERAGE — gsc_coverage_report(entityType: "query") for the same range.
   State coverage_pct alongside every query-level number in the report.
   Do NOT sum stored daily query rows across dates — coverage varies by window; re-query
   multi-day windows whole (see gsc://guidance/data-loss).

Report format: state the date range, the aggregation_type next to every impression count,
and the query coverage next to every query-level total. Flag any provisional dates used.`
              }
            }
          ]
        };
      }

      case 'gsc_coverage_audit': {
        const siteUrl = args?.siteUrl || '{siteUrl}';
        const startDate = args?.startDate || '{startDate}';
        const endDate = args?.endDate || '{endDate}';

        return {
          messages: [
            {
              role: 'user',
              content: {
                type: 'text',
                text: `Before writing any analysis of ${siteUrl} for ${startDate} → ${endDate}, measure what that analysis will be blind to:

1. gsc_coverage_report(entityType: "query") — how much of the true impression total the query grain can see.
2. gsc_coverage_report(entityType: "page") — should be ~100%; if not, investigate.
3. gsc_coverage_report(entityType: "query_page") — the grain used for query→page attribution, usually the lossiest.
4. Read gsc://guidance/data-loss.

Then produce a short blindness statement to prepend to the analysis, e.g.:
"Query-level figures cover X% of the property's Y impressions (aggregation: byProperty);
the remaining Z impressions are invisible at this grain and conclusions do not cover them.
Coverage was measured for this exact window on this date and is not reusable."`
              }
            }
          ]
        };
      }

      case 'gsc_position_decomposition': {
        const siteUrl = args?.siteUrl || '{siteUrl}';
        const startDate = args?.startDate || '{startDate}';
        const endDate = args?.endDate || '{endDate}';

        return {
          messages: [
            {
              role: 'user',
              content: {
                type: 'text',
                text: `Decompose the sitewide average position of ${siteUrl} for ${startDate} → ${endDate} by page, using position mass — never by averaging positions:

1. gsc_accurate_totals(aggregationType: "byPage") — record totals.position and totals.sum_position.
2. gsc_search_analytics(dimensions: ["page"]) — complete page rows, each with sum_position.
3. For each page compute position_mass_pct = page.sum_position / totals.sum_position × 100.
   Rank pages by position mass. This is each page's contribution to the average.
4. Sanity check: Σ page.sum_position ≈ totals.sum_position and
   Σ sum_position / Σ impressions ≈ totals.position.

Interpretation rules (see gsc://guidance/position):
- Lower position = better. A page ranking BETTER than the site average pulls the average
  toward better (numerically lower) values; removing it makes the average WORSE.
- Before blaming a page for a worsening average, check whether its impressions grew at a
  deep position (mix shift) versus its own position actually declining.
- Report each cited page with: impressions, position, position mass %, and the counterfactual
  site average without it (Σ sum_position − page.sum_position) / (Σ impressions − page.impressions).`
              }
            }
          ]
        };
      }

      case 'analyze-site': {
        const siteUrl = args?.siteUrl || '{siteUrl}';
        const timeframe = args?.timeframe || '30d';

        return {
          messages: [
            {
              role: 'user',
              content: {
                type: 'text',
                text: `Perform a comprehensive SEO analysis of ${siteUrl} for the last ${timeframe}:

1. First, use gsc_list_sites to verify access to the site
2. Use gsc_verify_data_availability to find the latest finalized date, and end your window there
3. Use gsc_accurate_totals (aggregationType "byProperty") for ground-truth totals
4. Use gsc_coverage_report (entityType "query") and state coverage next to query-level numbers
5. Use gsc_top_queries to identify top performing keywords
6. Use gsc_top_pages to find best performing content
7. Use gsc_analyze_opportunities to find improvement areas
8. Use gsc_cannibalization_check to detect keyword conflicts
9. Use gsc_content_gaps to find content opportunities

Provide a detailed report with:
- Executive summary of current performance
- Top 5 performing queries and pages
- Key issues and opportunities identified
- Prioritized recommendations for improvement
- Specific action items with expected impact`
              }
            }
          ]
        };
      }

      case 'weekly-report': {
        const siteUrl = args?.siteUrl || '{siteUrl}';

        return {
          messages: [
            {
              role: 'user',
              content: {
                type: 'text',
                text: `Generate a weekly SEO performance report for ${siteUrl}:

1. Use gsc_compare_periods to compare this week vs last week
2. Use gsc_top_queries to see current top keywords
3. Use gsc_analyze_opportunities with analysisType "quick"

Create a report with:
- Week-over-week changes in clicks, impressions, CTR, and position
- Notable winners (queries/pages that improved significantly)
- Notable losers (queries/pages that declined)
- Quick wins to focus on this week
- Summary and key takeaways`
              }
            }
          ]
        };
      }

      case 'find-quick-wins': {
        const siteUrl = args?.siteUrl || '{siteUrl}';

        return {
          messages: [
            {
              role: 'user',
              content: {
                type: 'text',
                text: `Find quick SEO wins for ${siteUrl} that can be implemented immediately:

1. Use gsc_analyze_opportunities with focus on ["ctr", "rankings"]
2. Look for:
   - Pages ranking #4-10 that could reach top 3 with small improvements
   - High-impression queries with low CTR (title/meta opportunities)
   - Pages with good traffic that could be optimized further

Provide:
- List of 5-10 quick wins sorted by potential impact
- Specific actions for each (e.g., "Update title for page X to include keyword Y")
- Estimated traffic gain for each action
- Implementation priority order`
              }
            }
          ]
        };
      }

      default:
        return {
          messages: [
            {
              role: 'user',
              content: {
                type: 'text',
                text: `Unknown prompt: ${name}`
              }
            }
          ]
        };
    }
  });

  // Handle cleanup
  process.on('SIGINT', async () => {
    await client.close();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    await client.close();
    process.exit(0);
  });

  // Start server
  const transport = new StdioServerTransport();
  await server.connect(transport);

  console.error('GSC MCP Server running on stdio');
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
