import { vi } from 'vitest';
import { mockSites, mockSearchAnalyticsRows, mockSitemaps, mockInspectionResultPass } from '../fixtures/api-responses.js';

// Create mock SearchConsole API
export function createMockSearchConsole() {
  return {
    sites: {
      list: vi.fn().mockResolvedValue({
        data: {
          siteEntry: mockSites.map(site => ({
            siteUrl: site.siteUrl,
            permissionLevel: site.permissionLevel
          }))
        }
      })
    },
    searchanalytics: {
      query: vi.fn().mockResolvedValue({
        data: {
          rows: mockSearchAnalyticsRows,
          responseAggregationType: 'auto'
        }
      })
    },
    sitemaps: {
      list: vi.fn().mockResolvedValue({
        data: {
          sitemap: mockSitemaps
        }
      }),
      get: vi.fn().mockResolvedValue({
        data: mockSitemaps[0]
      }),
      submit: vi.fn().mockResolvedValue({}),
      delete: vi.fn().mockResolvedValue({})
    },
    urlInspection: {
      index: {
        inspect: vi.fn().mockResolvedValue({
          data: {
            inspectionResult: mockInspectionResultPass
          }
        })
      }
    }
  };
}

// Create mock OAuth2 client
export function createMockOAuth2Client() {
  return {
    setCredentials: vi.fn(),
    credentials: {
      access_token: 'mock-access-token',
      refresh_token: 'mock-refresh-token',
      expiry_date: Date.now() + 3600000
    },
    refreshAccessToken: vi.fn().mockResolvedValue({
      credentials: {
        access_token: 'new-access-token',
        refresh_token: 'mock-refresh-token',
        expiry_date: Date.now() + 3600000,
        scope: 'https://www.googleapis.com/auth/webmasters',
        token_type: 'Bearer'
      }
    }),
    generateAuthUrl: vi.fn().mockReturnValue('https://accounts.google.com/o/oauth2/auth?client_id=test'),
    getToken: vi.fn().mockResolvedValue({
      tokens: {
        access_token: 'new-access-token',
        refresh_token: 'new-refresh-token',
        expiry_date: Date.now() + 3600000,
        scope: 'https://www.googleapis.com/auth/webmasters',
        token_type: 'Bearer'
      }
    })
  };
}

// Factory to create google module mock
export function createGoogleApisMock() {
  const mockSearchConsole = createMockSearchConsole();
  const mockOAuth2 = createMockOAuth2Client();

  return {
    mockSearchConsole,
    mockOAuth2,
    google: {
      searchconsole: vi.fn(() => mockSearchConsole),
      auth: {
        OAuth2: vi.fn(() => mockOAuth2)
      }
    }
  };
}

// Error response factories
export function create401Error() {
  const error = new Error('Invalid Credentials') as Error & { response?: { status: number } };
  error.response = { status: 401 };
  return error;
}

export function create403Error() {
  const error = new Error('Permission denied') as Error & { response?: { status: number } };
  error.response = { status: 403 };
  return error;
}

export function create404Error() {
  const error = new Error('Not found') as Error & { response?: { status: number } };
  error.response = { status: 404 };
  return error;
}

export function create429Error(retryAfter = 60) {
  const error = new Error('Rate limit exceeded') as Error & { response?: { status: number; headers?: Record<string, string> } };
  error.response = {
    status: 429,
    headers: { 'retry-after': String(retryAfter) }
  };
  return error;
}

export function create500Error() {
  const error = new Error('Internal server error') as Error & { response?: { status: number } };
  error.response = { status: 500 };
  return error;
}
