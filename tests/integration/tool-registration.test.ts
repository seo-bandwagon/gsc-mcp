import { describe, it, expect, beforeEach, vi } from 'vitest';
import { vol } from 'memfs';

// Mock fs modules with memfs so the cache + token paths don't touch real disk.
vi.mock('fs', async () => {
  const memfs = await import('memfs');
  return memfs.fs;
});
vi.mock('fs/promises', async () => {
  const memfs = await import('memfs');
  return memfs.fs.promises;
});

// Mock googleapis with a search console that returns well-shaped data.
import {
  mockSites,
  mockSearchAnalyticsRows,
  mockSitemaps,
  mockInspectionResultPass,
  mockTokens
} from '../fixtures/api-responses.js';

const mockSearchConsole = {
  sites: {
    list: vi.fn().mockResolvedValue({
      data: {
        siteEntry: mockSites.map((s) => ({ siteUrl: s.siteUrl, permissionLevel: s.permissionLevel }))
      }
    })
  },
  searchanalytics: {
    query: vi.fn().mockResolvedValue({
      data: { rows: mockSearchAnalyticsRows, responseAggregationType: 'auto' }
    })
  },
  sitemaps: {
    list: vi.fn().mockResolvedValue({ data: { sitemap: mockSitemaps } }),
    get: vi.fn().mockResolvedValue({ data: mockSitemaps[0] }),
    submit: vi.fn().mockResolvedValue({}),
    delete: vi.fn().mockResolvedValue({})
  },
  urlInspection: {
    index: {
      inspect: vi.fn().mockResolvedValue({ data: { inspectionResult: mockInspectionResultPass } })
    }
  }
};

const mockOAuth2Client = {
  setCredentials: vi.fn(),
  refreshAccessToken: vi.fn(),
  generateAuthUrl: vi.fn().mockReturnValue('https://accounts.google.com/auth'),
  getToken: vi.fn()
};

vi.mock('googleapis', () => ({
  google: {
    auth: {
      OAuth2: vi.fn(function OAuth2() {
        return mockOAuth2Client;
      })
    },
    searchconsole: vi.fn(function searchconsole() {
      return mockSearchConsole;
    })
  }
}));

vi.mock('../../src/utils/logger.js', () => ({
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
  setGlobalLogger: vi.fn(),
  getGlobalLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() })
}));

// Import after mocks are registered.
import { GSCClient } from '../../src/api/client.js';
import { createTools } from '../../src/tools/index.js';
import { createTestConfig } from '../fixtures/config.js';
import type { Tool, ToolResult } from '../../src/tools/types.js';

describe('tool registration end-to-end', () => {
  const testConfig = createTestConfig();
  let client: GSCClient;
  let tools: Tool[];
  let handlers: Map<string, (args: Record<string, unknown>) => Promise<ToolResult>>;

  beforeEach(async () => {
    vol.reset();
    vol.mkdirSync('/tmp/gsc-test', { recursive: true });
    vol.writeFileSync(testConfig.tokenPath, JSON.stringify(mockTokens));
    vol.writeFileSync(testConfig.cachePath, '{}');
    vi.clearAllMocks();

    client = new GSCClient(testConfig);
    await client.initialize();
    ({ tools, handlers } = createTools(client));
  });

  it('registers exactly 15 tools', () => {
    expect(tools).toHaveLength(15);
    expect(handlers.size).toBe(15);
  });

  it('every tool has a handler', () => {
    for (const tool of tools) {
      expect(handlers.has(tool.name)).toBe(true);
    }
  });

  it('every tool has a non-empty description', () => {
    for (const tool of tools) {
      expect(tool.description.length).toBeGreaterThan(20);
    }
  });

  it('every tool has an inputSchema with type=object', () => {
    for (const tool of tools) {
      expect(tool.inputSchema.type).toBe('object');
      expect(tool.inputSchema.properties).toBeDefined();
    }
  });

  it('every tool defines an outputSchema', () => {
    for (const tool of tools) {
      expect(tool.outputSchema).toBeDefined();
      expect(tool.outputSchema!.type).toBe('object');
    }
  });

  it('every tool declares annotations', () => {
    for (const tool of tools) {
      expect(tool.annotations).toBeDefined();
    }
  });

  it('destructive tools are flagged destructiveHint', () => {
    const del = tools.find((t) => t.name === 'gsc_delete_sitemap');
    expect(del?.annotations?.destructiveHint).toBe(true);
    expect(del?.annotations?.requiresConfirmation).toBe(true);
  });

  it('read-only tools are flagged readOnlyHint', () => {
    const readOnlyNames = [
      'gsc_list_sites',
      'gsc_search_analytics',
      'gsc_top_queries',
      'gsc_top_pages',
      'gsc_compare_periods',
      'gsc_inspect_url',
      'gsc_bulk_inspect',
      'gsc_list_sitemaps',
      'gsc_index_coverage',
      'gsc_analyze_opportunities',
      'gsc_content_gaps',
      'gsc_cannibalization_check'
    ];
    for (const name of readOnlyNames) {
      const tool = tools.find((t) => t.name === name);
      expect(tool?.annotations?.readOnlyHint, `${name} should be readOnly`).toBe(true);
    }
  });

  describe('handler outputs conform to ToolResult shape', () => {
    it('gsc_list_sites returns structured sites array', async () => {
      const handler = handlers.get('gsc_list_sites')!;
      const result = await handler({});

      expect(result.isError).toBeFalsy();
      expect(typeof result.text).toBe('string');
      const parsed = JSON.parse(result.text);
      expect(Array.isArray(parsed.sites)).toBe(true);
      expect(parsed.sites.length).toBeGreaterThan(0);

      const structured = result.structured as { sites: unknown[] };
      expect(structured.sites).toEqual(parsed.sites);
    });

    it('gsc_top_queries returns structured rows', async () => {
      const handler = handlers.get('gsc_top_queries')!;
      const result = await handler({
        siteUrl: mockSites[0].siteUrl,
        startDate: '2025-01-01',
        endDate: '2025-01-28'
      });

      expect(result.isError).toBeFalsy();
      const structured = result.structured as { rows: unknown[] };
      expect(Array.isArray(structured.rows)).toBe(true);
    });

    it('error paths return isError=true with structured error envelope', async () => {
      const handler = handlers.get('gsc_search_analytics')!;
      // Missing required siteUrl / startDate / endDate triggers Zod validation.
      const result = await handler({});

      expect(result.isError).toBe(true);
      const structured = result.structured as { error: { code: string; message: string } };
      expect(structured.error).toBeDefined();
      expect(typeof structured.error.code).toBe('string');
    });
  });
});
