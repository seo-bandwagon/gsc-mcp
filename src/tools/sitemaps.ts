import type { Tool, ToolHandler } from './types.js';
import { ok } from './types.js';
import type { SitemapsApi } from '../api/sitemaps.js';
import { handleToolError } from '../utils/errors.js';
import {
  SitemapQuerySchema,
  IndexCoverageQuerySchema
} from '../types/index.js';

const SITEMAP_SHAPE = {
  type: 'object',
  properties: {
    path: { type: 'string' },
    lastSubmitted: { type: 'string' },
    isPending: { type: 'boolean' },
    isSitemapsIndex: { type: 'boolean' },
    lastDownloaded: { type: 'string' },
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

export function createSitemapsTools(sitemapsApi: SitemapsApi): { tools: Tool[]; handlers: Map<string, ToolHandler> } {
  const handlers = new Map<string, ToolHandler>();

  const tools: Tool[] = [
    {
      name: 'gsc_list_sitemaps',
      description: 'List all sitemaps submitted for a property with per-sitemap status and per-content-type index coverage.',
      inputSchema: {
        type: 'object',
        properties: {
          siteUrl: { type: 'string', description: 'The verified property URL.' }
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
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true }
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
      name: 'gsc_index_coverage',
      description: 'Aggregate index coverage across a property\'s sitemaps. Returns totals, indexed vs excluded counts, and exclusion reason breakdown.',
      inputSchema: {
        type: 'object',
        properties: {
          siteUrl: { type: 'string', description: 'The verified property URL.' },
          sitemapUrl: { type: 'string', description: 'Optional — filter to one specific sitemap.' }
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
              totalUrls: { type: 'number' },
              indexed: { type: 'number' },
              excluded: { type: 'number' },
              error: { type: 'number' }
            },
            required: ['totalUrls', 'indexed', 'excluded', 'error']
          },
          exclusionReasons: {
            type: 'object',
            additionalProperties: true
          }
        },
        required: ['summary', 'exclusionReasons']
      },
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true }
    }
  ];

  handlers.set('gsc_list_sitemaps', async (args) => {
    try {
      const siteUrl = args.siteUrl as string;
      return ok(await sitemapsApi.listSitemaps(siteUrl));
    } catch (error) {
      return handleToolError(error);
    }
  });

  handlers.set('gsc_submit_sitemap', async (args) => {
    try {
      const params = SitemapQuerySchema.parse(args);
      return ok(await sitemapsApi.submitSitemap(params));
    } catch (error) {
      return handleToolError(error);
    }
  });

  handlers.set('gsc_delete_sitemap', async (args) => {
    try {
      const params = SitemapQuerySchema.parse(args);
      return ok(await sitemapsApi.deleteSitemap(params));
    } catch (error) {
      return handleToolError(error);
    }
  });

  handlers.set('gsc_index_coverage', async (args) => {
    try {
      const params = IndexCoverageQuerySchema.parse(args);
      return ok(await sitemapsApi.getIndexCoverage(params));
    } catch (error) {
      return handleToolError(error);
    }
  });

  return { tools, handlers };
}
