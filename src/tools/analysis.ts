import type { Tool, ToolHandler } from './types.js';
import { ok } from './types.js';
import type { AnalysisApi } from '../api/analysis.js';
import { handleToolError } from '../utils/errors.js';
import {
  AnalyzeOpportunitiesQuerySchema,
  ContentGapsQuerySchema,
  CannibalizationQuerySchema
} from '../types/index.js';

const OPPORTUNITY_SHAPE = {
  type: 'object',
  properties: {
    type: { type: 'string', enum: ['ctr_improvement', 'ranking_improvement', 'content_gap', 'cannibalization', 'indexing_issue'] },
    priority: { type: 'string', enum: ['high', 'medium', 'low'] },
    title: { type: 'string' },
    description: { type: 'string' },
    queries: { type: 'array', items: { type: 'string' } },
    pages: { type: 'array', items: { type: 'string' } },
    estimatedImpact: {
      type: 'object',
      properties: {
        additionalClicks: { type: 'number' },
        confidence: { type: 'string', enum: ['high', 'medium', 'low'] }
      },
      required: ['additionalClicks', 'confidence']
    },
    recommendations: { type: 'array', items: { type: 'string' } }
  },
  required: ['type', 'priority', 'title', 'description', 'recommendations']
} as const;

export function createAnalysisTools(analysisApi: AnalysisApi): { tools: Tool[]; handlers: Map<string, ToolHandler> } {
  const handlers = new Map<string, ToolHandler>();

  const tools: Tool[] = [
    {
      name: 'gsc_analyze_opportunities',
      description: 'Surface SEO improvement opportunities across CTR, rankings, coverage, and mobile usability. Returns prioritized opportunities with estimated click impact and specific recommendations.',
      inputSchema: {
        type: 'object',
        properties: {
          siteUrl: { type: 'string', description: 'The verified property URL.' },
          analysisType: { type: 'string', enum: ['quick', 'standard', 'deep'], description: 'Analysis depth. quick = last 7 days, standard = last 28 days, deep = last 90 days. Default standard.' },
          focus: {
            type: 'array',
            items: { type: 'string', enum: ['rankings', 'ctr', 'coverage', 'mobile'] },
            description: 'Narrow the analysis to specific areas. Omit to cover all.'
          }
        },
        required: ['siteUrl'],
        additionalProperties: false
      },
      outputSchema: {
        type: 'object',
        properties: {
          opportunities: { type: 'array', items: OPPORTUNITY_SHAPE },
          quickWins: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                type: { type: 'string' },
                description: { type: 'string' },
                queries: { type: 'array', items: { type: 'string' } },
                pages: { type: 'array', items: { type: 'string' } }
              },
              required: ['type', 'description']
            }
          },
          summary: {
            type: 'object',
            properties: {
              totalOpportunities: { type: 'number' },
              highPriority: { type: 'number' },
              estimatedTotalImpact: { type: 'number' }
            },
            required: ['totalOpportunities', 'highPriority', 'estimatedTotalImpact']
          }
        },
        required: ['opportunities', 'quickWins', 'summary']
      },
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true, longRunningHint: true }
    },
    {
      name: 'gsc_content_gaps',
      description: 'Identify topic clusters where the property has impression share but weak ranking or missing content. Returns clusters with representative queries and a recommendation.',
      inputSchema: {
        type: 'object',
        properties: {
          siteUrl: { type: 'string', description: 'The verified property URL.' },
          startDate: { type: 'string', description: 'Analysis window start (YYYY-MM-DD).' },
          endDate: { type: 'string', description: 'Analysis window end (YYYY-MM-DD).' },
          minImpressions: { type: 'number', description: 'Minimum impressions per query to include. Default 1.' }
        },
        required: ['siteUrl', 'startDate', 'endDate'],
        additionalProperties: false
      },
      outputSchema: {
        type: 'object',
        properties: {
          gaps: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                queryCluster: { type: 'string' },
                queries: { type: 'array', items: { type: 'string' } },
                totalImpressions: { type: 'number' },
                avgPosition: { type: 'number' },
                existingContent: { type: ['string', 'null'] },
                recommendation: { type: 'string' }
              },
              required: ['queryCluster', 'queries', 'totalImpressions', 'avgPosition', 'recommendation']
            }
          }
        },
        required: ['gaps']
      },
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true, longRunningHint: true }
    },
    {
      name: 'gsc_cannibalization_check',
      description: 'Detect keyword cannibalization: queries for which multiple pages on the property compete. Returns queries with the competing pages, clicks/impressions/position, and a recommendation.',
      inputSchema: {
        type: 'object',
        properties: {
          siteUrl: { type: 'string', description: 'The verified property URL.' },
          startDate: { type: 'string', description: 'Analysis window start (YYYY-MM-DD).' },
          endDate: { type: 'string', description: 'Analysis window end (YYYY-MM-DD).' },
          minPages: { type: 'number', description: 'Minimum pages ranking for the same query to flag it. Default 2.' }
        },
        required: ['siteUrl', 'startDate', 'endDate'],
        additionalProperties: false
      },
      outputSchema: {
        type: 'object',
        properties: {
          cannibalizationIssues: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                query: { type: 'string' },
                pages: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      url: { type: 'string' },
                      position: { type: 'number' },
                      clicks: { type: 'number' },
                      impressions: { type: 'number' }
                    },
                    required: ['url', 'position', 'clicks', 'impressions']
                  }
                },
                recommendation: { type: 'string' }
              },
              required: ['query', 'pages', 'recommendation']
            }
          }
        },
        required: ['cannibalizationIssues']
      },
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true, longRunningHint: true }
    }
  ];

  handlers.set('gsc_analyze_opportunities', async (args) => {
    try {
      const params = AnalyzeOpportunitiesQuerySchema.parse(args);
      return ok(await analysisApi.analyzeOpportunities(params));
    } catch (error) {
      return handleToolError(error);
    }
  });

  handlers.set('gsc_content_gaps', async (args) => {
    try {
      const params = ContentGapsQuerySchema.parse(args);
      return ok(await analysisApi.findContentGaps(params));
    } catch (error) {
      return handleToolError(error);
    }
  });

  handlers.set('gsc_cannibalization_check', async (args) => {
    try {
      const params = CannibalizationQuerySchema.parse(args);
      return ok(await analysisApi.checkCannibalization(params));
    } catch (error) {
      return handleToolError(error);
    }
  });

  return { tools, handlers };
}
