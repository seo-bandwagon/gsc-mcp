import type { Tool, ToolHandler } from './types.js';
import { okFormatted, RESPONSE_FORMAT_PROP } from './types.js';
import type { SitemapsApi } from '../api/sitemaps.js';
import { handleToolError } from '../utils/errors.js';
import { tableFromObjects, toMarkdown, warningsBlock } from '../utils/markdown.js';
import {
  ResponseFormatSchema,
  SitemapQuerySchema,
  SitemapIndexationQuerySchema
} from '../types/index.js';
import type { ResponseFormat } from '../types/index.js';

const SITEMAP_SHAPE = {
  type: 'object',
  properties: {
    path: { type: 'string' },
    lastSubmitted: { type: 'string' },
    isPending: { type: 'boolean' },
    isSitemapsIndex: { type: 'boolean' },
    lastDownloaded: { type: 'string', description: 'When Google last fetched the sitemap file. Counts are only as fresh as this date.' },
    warnings: { type: 'number' },
    errors: { type: 'number' },
    contents: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          type: { type: 'string' },
          submitted: { type: 'number' },
          indexed: { type: 'number' }
        },
        required: ['type', 'submitted', 'indexed']
      }
    }
  },
  required: ['path', 'lastSubmitted', 'isPending', 'isSitemapsIndex', 'warnings', 'errors', 'contents']
} as const;

const MUTATION_RESULT = {
  type: 'object',
  properties: {
    success: { type: 'boolean' },
    message: { type: 'string' }
  },
  required: ['success', 'message']
} as const;

const INDEXATION_ENTRY = {
  type: 'object',
  properties: {
    path: { type: 'string' },
    last_submitted: { type: 'string' },
    last_downloaded: { type: ['string', 'null'], description: 'When Google last fetched this sitemap file. Old dates mean the counts are stale.' },
    is_pending: { type: 'boolean' },
    is_sitemaps_index: { type: 'boolean' },
    sitemap_file_errors: { type: 'number', description: 'Errors reading the sitemap FILE itself — not URL indexing errors.' },
    sitemap_file_warnings: { type: 'number' },
    submitted_urls: { type: 'number' },
    indexed_urls: { type: 'number' },
    by_content_type: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          type: { type: 'string' },
          submitted: { type: 'number' },
          indexed: { type: 'number' }
        },
        required: ['type', 'submitted', 'indexed']
      }
    }
  },
  required: ['path', 'last_submitted', 'last_downloaded', 'is_pending', 'is_sitemaps_index', 'sitemap_file_errors', 'sitemap_file_warnings', 'submitted_urls', 'indexed_urls', 'by_content_type']
} as const;

function parseFormat(args: Record<string, unknown>): ResponseFormat {
  return ResponseFormatSchema.parse(args.response_format ?? undefined);
}

function stripFormat(args: Record<string, unknown>): Record<string, unknown> {
  const { response_format: _ignored, ...rest } = args;
  return rest;
}

export function createSitemapsTools(sitemapsApi: SitemapsApi): { tools: Tool[]; handlers: Map<string, ToolHandler> } {
  const handlers = new Map<string, ToolHandler>();

  const tools: Tool[] = [
    {
      name: 'gsc_list_sitemaps',
      description: 'List all sitemaps submitted for a property with per-sitemap status and per-content-type submitted/indexed counts as reported by the Sitemaps API.',
      inputSchema: {
        type: 'object',
        properties: {
          siteUrl: { type: 'string', description: 'The verified property URL.' },
          response_format: RESPONSE_FORMAT_PROP
        },
        required: ['siteUrl'],
        additionalProperties: false
      },
      outputSchema: {
        type: 'object',
        properties: {
          sitemap: { type: 'array', items: SITEMAP_SHAPE }
        },
        required: ['sitemap']
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
    },
    {
      name: 'gsc_submit_sitemap',
      description: 'Submit (or resubmit) a sitemap to Google Search Console. Non-destructive but not idempotent in effect — calling twice issues two submissions.',
      inputSchema: {
        type: 'object',
        properties: {
          siteUrl: { type: 'string', description: 'The verified property URL.' },
          sitemapUrl: { type: 'string', description: 'Absolute URL of the sitemap file (e.g. https://example.com/sitemap.xml).' }
        },
        required: ['siteUrl', 'sitemapUrl'],
        additionalProperties: false
      },
      outputSchema: MUTATION_RESULT,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
        requiresConfirmation: true
      }
    },
    {
      name: 'gsc_delete_sitemap',
      description: 'Remove a sitemap from Google Search Console. Destructive — the sitemap reference will no longer be tracked.',
      inputSchema: {
        type: 'object',
        properties: {
          siteUrl: { type: 'string', description: 'The verified property URL.' },
          sitemapUrl: { type: 'string', description: 'Absolute URL of the sitemap to remove.' }
        },
        required: ['siteUrl', 'sitemapUrl'],
        additionalProperties: false
      },
      outputSchema: MUTATION_RESULT,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: true,
        requiresConfirmation: true
      }
    },
    {
      name: 'gsc_sitemap_indexation_summary',
      description:
        'Summarize submitted vs indexed URL counts across the property\'s sitemaps, as reported by the Sitemaps API. ' +
        'This is NOT the Search Console Index Coverage report — the public API does not expose that report, and per-URL index status requires the URL Inspection API (gsc_inspect_url / gsc_bulk_inspect). ' +
        'Counts are only as fresh as each sitemap\'s last_downloaded date (surfaced per sitemap and as oldest_last_downloaded). ' +
        'sitemap_file_errors counts problems reading the sitemap files themselves, not URL indexing errors.',
      inputSchema: {
        type: 'object',
        properties: {
          siteUrl: { type: 'string', description: 'The verified property URL.' },
          sitemapUrl: { type: 'string', description: 'Optional — restrict to one specific sitemap.' },
          response_format: RESPONSE_FORMAT_PROP
        },
        required: ['siteUrl'],
        additionalProperties: false
      },
      outputSchema: {
        type: 'object',
        properties: {
          summary: {
            type: 'object',
            properties: {
              submitted_urls: { type: 'number', description: 'Σ submitted across sitemap contents (Sitemaps API field).' },
              indexed_urls: { type: 'number', description: 'Σ indexed across sitemap contents (Sitemaps API field).' },
              sitemap_file_errors: { type: 'number', description: 'Σ sitemap FILE errors — not URL indexing errors.' },
              sitemap_file_warnings: { type: 'number' },
              oldest_last_downloaded: { type: ['string', 'null'], description: 'Staleness bound: the oldest last_downloaded among included sitemaps.' }
            },
            required: ['submitted_urls', 'indexed_urls', 'sitemap_file_errors', 'sitemap_file_warnings', 'oldest_last_downloaded']
          },
          sitemaps: { type: 'array', items: INDEXATION_ENTRY },
          warnings: { type: 'array', items: { type: 'string' } }
        },
        required: ['summary', 'sitemaps', 'warnings']
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
    }
  ];

  handlers.set('gsc_list_sitemaps', async (args) => {
    try {
      const format = parseFormat(args);
      const siteUrl = args.siteUrl as string;
      const data = await sitemapsApi.listSitemaps(siteUrl);
      return okFormatted(data, format, (d) => `## Sitemaps\n\n${toMarkdown(d.sitemap, 3)}`);
    } catch (error) {
      return handleToolError(error);
    }
  });

  handlers.set('gsc_submit_sitemap', async (args) => {
    try {
      const params = SitemapQuerySchema.parse(stripFormat(args));
      const data = await sitemapsApi.submitSitemap(params);
      return okFormatted(data, 'json', (d) => d.message);
    } catch (error) {
      return handleToolError(error);
    }
  });

  handlers.set('gsc_delete_sitemap', async (args) => {
    try {
      const params = SitemapQuerySchema.parse(stripFormat(args));
      const data = await sitemapsApi.deleteSitemap(params);
      return okFormatted(data, 'json', (d) => d.message);
    } catch (error) {
      return handleToolError(error);
    }
  });

  handlers.set('gsc_sitemap_indexation_summary', async (args) => {
    try {
      const format = parseFormat(args);
      const params = SitemapIndexationQuerySchema.parse(stripFormat(args));
      const data = await sitemapsApi.getSitemapIndexationSummary(params);
      return okFormatted(data, format, (d) =>
        `## Sitemap indexation summary\n\n` +
        `_Sitemap-reported counts only — not the Index Coverage report. Freshness bound: ${d.summary.oldest_last_downloaded ?? 'unknown'}._\n\n` +
        warningsBlock(d.warnings) +
        tableFromObjects([{ ...d.summary }]) +
        `\n### Per sitemap\n\n` +
        tableFromObjects(
          d.sitemaps.map((s) => ({
            path: s.path,
            last_downloaded: s.last_downloaded ?? 'never',
            submitted_urls: s.submitted_urls,
            indexed_urls: s.indexed_urls,
            file_errors: s.sitemap_file_errors,
            file_warnings: s.sitemap_file_warnings
          }))
        )
      );
    } catch (error) {
      return handleToolError(error);
    }
  });

  return { tools, handlers };
}
