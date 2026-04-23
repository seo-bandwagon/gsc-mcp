import type { Tool, ToolHandler } from './types.js';
import { ok } from './types.js';
import type { UrlInspectionApi } from '../api/url-inspection.js';
import { handleToolError } from '../utils/errors.js';
import {
  InspectUrlQuerySchema,
  BulkInspectQuerySchema
} from '../types/index.js';

const VERDICT_ENUM = ['PASS', 'NEUTRAL', 'FAIL'];

const INDEX_STATUS = {
  type: 'object',
  properties: {
    verdict: { type: 'string', enum: VERDICT_ENUM },
    coverageState: { type: 'string' },
    robotsTxtState: { type: 'string', enum: ['ALLOWED', 'DISALLOWED'] },
    indexingState: { type: 'string', enum: ['INDEXING_ALLOWED', 'BLOCKED_BY_META_TAG', 'BLOCKED_BY_HTTP_HEADER', 'RESERVED'] },
    lastCrawlTime: { type: 'string' },
    pageFetchState: { type: 'string' },
    googleCanonical: { type: 'string' },
    userCanonical: { type: 'string' },
    referringUrls: { type: 'array', items: { type: 'string' } },
    crawledAs: { type: 'string', enum: ['DESKTOP', 'MOBILE'] }
  },
  required: ['verdict', 'coverageState', 'robotsTxtState', 'indexingState', 'pageFetchState']
} as const;

const INSPECTION_RESULT = {
  type: 'object',
  properties: {
    inspectionResultLink: { type: 'string' },
    indexStatusResult: INDEX_STATUS,
    mobileUsabilityResult: {
      type: 'object',
      properties: {
        verdict: { type: 'string', enum: VERDICT_ENUM },
        issues: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              issueType: { type: 'string' },
              severity: { type: 'string', enum: ['WARNING', 'ERROR'] },
              message: { type: 'string' }
            },
            required: ['issueType', 'severity', 'message']
          }
        }
      },
      required: ['verdict', 'issues']
    },
    richResultsResult: {
      type: 'object',
      properties: {
        verdict: { type: 'string', enum: VERDICT_ENUM },
        detectedItems: { type: 'array' }
      }
    }
  },
  required: ['inspectionResultLink', 'indexStatusResult']
} as const;

export function createInspectionTools(urlInspectionApi: UrlInspectionApi): { tools: Tool[]; handlers: Map<string, ToolHandler> } {
  const handlers = new Map<string, ToolHandler>();

  const tools: Tool[] = [
    {
      name: 'gsc_inspect_url',
      description: 'Inspect a single URL via the GSC URL Inspection API. Returns index status, robots.txt state, canonical info, mobile usability, and rich result detection.',
      inputSchema: {
        type: 'object',
        properties: {
          siteUrl: { type: 'string', description: 'The verified property that owns the URL.' },
          inspectionUrl: { type: 'string', description: 'The absolute URL to inspect. Must belong to the property.' }
        },
        required: ['siteUrl', 'inspectionUrl'],
        additionalProperties: false
      },
      outputSchema: {
        type: 'object',
        properties: { inspectionResult: INSPECTION_RESULT },
        required: ['inspectionResult']
      },
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true }
    },
    {
      name: 'gsc_bulk_inspect',
      description: 'Inspect up to 100 URLs in a single call. Requests are batched to respect GSC rate limits. Returns per-URL results plus a success/failed summary.',
      inputSchema: {
        type: 'object',
        properties: {
          siteUrl: { type: 'string', description: 'The verified property that owns the URLs.' },
          urls: {
            type: 'array',
            items: { type: 'string' },
            description: 'Absolute URLs to inspect. Max 100.',
            minItems: 1,
            maxItems: 100
          }
        },
        required: ['siteUrl', 'urls'],
        additionalProperties: false
      },
      outputSchema: {
        type: 'object',
        properties: {
          results: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                url: { type: 'string' },
                result: { type: 'object', properties: { inspectionResult: INSPECTION_RESULT } },
                error: { type: 'string' }
              },
              required: ['url']
            }
          },
          summary: {
            type: 'object',
            properties: {
              success: { type: 'number' },
              failed: { type: 'number' }
            },
            required: ['success', 'failed']
          }
        },
        required: ['results', 'summary']
      },
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true, longRunningHint: true }
    }
  ];

  handlers.set('gsc_inspect_url', async (args) => {
    try {
      const params = InspectUrlQuerySchema.parse(args);
      return ok(await urlInspectionApi.inspectUrl(params));
    } catch (error) {
      return handleToolError(error);
    }
  });

  handlers.set('gsc_bulk_inspect', async (args) => {
    try {
      const params = BulkInspectQuerySchema.parse(args);
      return ok(await urlInspectionApi.bulkInspect(params));
    } catch (error) {
      return handleToolError(error);
    }
  });

  return { tools, handlers };
}
