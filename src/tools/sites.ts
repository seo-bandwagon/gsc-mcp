import type { Tool, ToolHandler } from './types.js';
import { okFormatted, RESPONSE_FORMAT_PROP } from './types.js';
import type { SitesApi } from '../api/sites.js';
import { handleToolError } from '../utils/errors.js';
import { tableFromObjects } from '../utils/markdown.js';
import { ResponseFormatSchema } from '../types/index.js';

export function createSitesTools(sitesApi: SitesApi): { tools: Tool[]; handlers: Map<string, ToolHandler> } {
  const handlers = new Map<string, ToolHandler>();

  const tools: Tool[] = [
    {
      name: 'gsc_list_sites',
      description: 'List all verified sites (properties) in your Google Search Console account.',
      inputSchema: {
        type: 'object',
        properties: {
          response_format: RESPONSE_FORMAT_PROP
        },
        additionalProperties: false
      },
      outputSchema: {
        type: 'object',
        properties: {
          sites: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                siteUrl: { type: 'string' },
                permissionLevel: {
                  type: 'string',
                  enum: ['siteOwner', 'siteFullUser', 'siteRestrictedUser', 'siteUnverifiedUser']
                }
              },
              required: ['siteUrl', 'permissionLevel']
            }
          }
        },
        required: ['sites']
      },
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
        openWorldHint: true
      }
    }
  ];

  handlers.set('gsc_list_sites', async (args) => {
    try {
      const format = ResponseFormatSchema.parse(args.response_format ?? undefined);
      const result = await sitesApi.listSites();
      return okFormatted(result, format, (d) => `## Verified sites\n\n${tableFromObjects(d.sites.map((s) => ({ ...s })))}`);
    } catch (error) {
      return handleToolError(error);
    }
  });

  return { tools, handlers };
}
