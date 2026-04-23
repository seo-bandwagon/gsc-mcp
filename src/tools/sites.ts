import type { Tool, ToolHandler } from './types.js';
import { ok } from './types.js';
import type { SitesApi } from '../api/sites.js';
import { handleToolError } from '../utils/errors.js';

export function createSitesTools(sitesApi: SitesApi): { tools: Tool[]; handlers: Map<string, ToolHandler> } {
  const handlers = new Map<string, ToolHandler>();

  const tools: Tool[] = [
    {
      name: 'gsc_list_sites',
      description: 'List all verified sites (properties) in your Google Search Console account.',
      inputSchema: {
        type: 'object',
        properties: {},
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

  handlers.set('gsc_list_sites', async () => {
    try {
      const result = await sitesApi.listSites();
      return ok(result);
    } catch (error) {
      return handleToolError(error);
    }
  });

  return { tools, handlers };
}
