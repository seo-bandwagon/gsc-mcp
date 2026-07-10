import type { Tool, ToolHandler } from './types.js';
import { okFormatted, RESPONSE_FORMAT_PROP } from './types.js';
import type { UrlInspectionApi } from '../api/url-inspection.js';
import { handleToolError } from '../utils/errors.js';
import { toMarkdown } from '../utils/markdown.js';
import {
  ResponseFormatSchema,
  InspectUrlQuerySchema,
  BulkInspectQuerySchema
} from '../types/index.js';

function parseFormat(args: Record<string, unknown>) {
  return ResponseFormatSchema.parse(args.response_format ?? undefined);
}

function stripFormat(args: Record<string, unknown>): Record<string, unknown> {
  const { response_format: _ignored, ...rest } = args;
  return rest;
}

// Google's enums grow over time — VERDICT_UNSPECIFIED, PARTIAL, and other values show
// up in live responses. Output schemas therefore document known values in descriptions
// instead of hard enums; unknown values pass through verbatim, with 'UNKNOWN' as the
// fallback for genuinely missing fields. A strict enum here fails closed on read-only
// data, which turns a new Google value into a tool crash.
const VERDICT = {
  type: 'string',
  description: 'Known values: PASS, PARTIAL, FAIL, NEUTRAL, VERDICT_UNSPECIFIED. Other values pass through as-is; UNKNOWN means the API omitted the field.'
} as const;

const INDEX_STATUS = {
  type: 'object',
  properties: {
    verdict: VERDICT,
    coverageState: { type: 'string' },
    robotsTxtState: { type: 'string', description: 'Known values: ALLOWED, DISALLOWED, ROBOTS_TXT_STATE_UNSPECIFIED. Others pass through.' },
    indexingState: { type: 'string', description: 'Known values: INDEXING_ALLOWED, BLOCKED_BY_META_TAG, BLOCKED_BY_HTTP_HEADER, BLOCKED_BY_ROBOTS_TXT, INDEXING_STATE_UNSPECIFIED. Others pass through.' },
    lastCrawlTime: { type: 'string' },
    pageFetchState: { type: 'string', description: 'Known values: SUCCESSFUL, SOFT_404, BLOCKED_ROBOTS_TXT, NOT_FOUND, ACCESS_DENIED, SERVER_ERROR, REDIRECT_ERROR, ACCESS_FORBIDDEN, BLOCKED_4XX, INTERNAL_CRAWL_ERROR, INVALID_URL. Others pass through.' },
    googleCanonical: { type: 'string' },
    userCanonical: { type: 'string' },
    referringUrls: { type: 'array', items: { type: 'string' } },
    crawledAs: { type: 'string', description: 'Known values: DESKTOP, MOBILE. Others pass through.' }
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
        verdict: VERDICT,
        issues: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              issueType: { type: 'string' },
              severity: { type: 'string', description: 'Known values: WARNING, ERROR. Others pass through.' },
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
        verdict: VERDICT,
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
          inspectionUrl: { type: 'string', description: 'The absolute URL to inspect. Must belong to the property.' },
          response_format: RESPONSE_FORMAT_PROP
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
          },
          response_format: RESPONSE_FORMAT_PROP
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
      const format = parseFormat(args);
      const params = InspectUrlQuerySchema.parse(stripFormat(args));
      return okFormatted(await urlInspectionApi.inspectUrl(params), format, (d) => `## URL inspection\n\n${toMarkdown(d.inspectionResult, 3)}`);
    } catch (error) {
      return handleToolError(error);
    }
  });

  handlers.set('gsc_bulk_inspect', async (args) => {
    try {
      const format = parseFormat(args);
      const params = BulkInspectQuerySchema.parse(stripFormat(args));
      return okFormatted(await urlInspectionApi.bulkInspect(params), format, (d) => `## Bulk inspection (${d.summary.success} ok, ${d.summary.failed} failed)\n\n${toMarkdown(d.results, 3)}`);
    } catch (error) {
      return handleToolError(error);
    }
  });

  return { tools, handlers };
}
