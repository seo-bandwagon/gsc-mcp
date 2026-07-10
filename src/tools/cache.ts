import type { Tool, ToolHandler } from './types.js';
import { okFormatted, RESPONSE_FORMAT_PROP } from './types.js';
import type { GSCClient } from '../api/client.js';
import { handleToolError } from '../utils/errors.js';
import { ResponseFormatSchema } from '../types/index.js';

export function createCacheTools(client: GSCClient): { tools: Tool[]; handlers: Map<string, ToolHandler> } {
  const handlers = new Map<string, ToolHandler>();

  const tools: Tool[] = [
    {
      name: 'gsc_clear_cache',
      description: 'Clear the local response cache. Use when GSC data looks stale (cache TTL is 1 hour by default).',
      inputSchema: {
        type: 'object',
        properties: {
          cacheType: {
            type: 'string',
            enum: ['all', 'searchAnalytics', 'sites', 'sitemaps', 'urlInspection'],
            description: 'Which cache namespace to clear. Default all.'
          },
          response_format: RESPONSE_FORMAT_PROP
        },
        additionalProperties: false
      },
      outputSchema: {
        type: 'object',
        properties: {
          success: { type: 'boolean' },
          message: { type: 'string' },
          cacheType: { type: 'string' }
        },
        required: ['success', 'message', 'cacheType']
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false
      }
    }
  ];

  handlers.set('gsc_clear_cache', async (args) => {
    try {
      const cache = client.getCache();
      const cacheType = (args.cacheType as string) || 'all';

      let cleared = 0;
      if (cacheType === 'all') {
        cache.clear();
        cleared = -1;
      } else {
        cleared = cache.clearByPrefix(cacheType);
      }

      const format = ResponseFormatSchema.parse(args.response_format ?? undefined);
      return okFormatted(
        {
          success: true,
          message: cacheType === 'all'
            ? 'All cache cleared successfully'
            : `Cleared ${cleared} cached entries for ${cacheType}`,
          cacheType
        },
        format,
        (d) => d.message
      );
    } catch (error) {
      return handleToolError(error);
    }
  });

  return { tools, handlers };
}
