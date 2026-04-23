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
      version: '1.0.0'
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

      const [queryData, pageData] = await Promise.all([
        searchAnalyticsApi.query({
          siteUrl,
          startDate,
          endDate,
          dimensions: ['query'],
          rowLimit: 10
        }),
        searchAnalyticsApi.query({
          siteUrl,
          startDate,
          endDate,
          dimensions: ['page'],
          rowLimit: 10
        })
      ]);

      // Calculate totals
      const totals = queryData.rows.reduce(
        (acc, row) => ({
          clicks: acc.clicks + row.clicks,
          impressions: acc.impressions + row.impressions
        }),
        { clicks: 0, impressions: 0 }
      );

      const summary = {
        siteUrl,
        period: { startDate, endDate },
        totals: {
          ...totals,
          ctr: totals.impressions > 0 ? totals.clicks / totals.impressions : 0
        },
        topQueries: queryData.rows.slice(0, 5),
        topPages: pageData.rows.slice(0, 5)
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
2. Use gsc_search_analytics to get overall performance data
3. Use gsc_top_queries to identify top performing keywords
4. Use gsc_top_pages to find best performing content
5. Use gsc_analyze_opportunities to find improvement areas
6. Use gsc_cannibalization_check to detect keyword conflicts
7. Use gsc_content_gaps to find content opportunities

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
