import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { vol } from 'memfs';
import { google } from 'googleapis';
import { OAuthManager } from '../../../src/auth/oauth.js';
import { createTestConfig } from '../../fixtures/config.js';
import { mockTokens, mockExpiredTokens } from '../../fixtures/api-responses.js';

// Mock fs modules with memfs
vi.mock('fs', async () => {
  const memfs = await import('memfs');
  return memfs.fs;
});

vi.mock('fs/promises', async () => {
  const memfs = await import('memfs');
  return memfs.fs.promises;
});

// Mock googleapis
const mockOAuth2Client = {
  setCredentials: vi.fn(),
  refreshAccessToken: vi.fn(),
  generateAuthUrl: vi.fn().mockReturnValue('https://accounts.google.com/auth'),
  getToken: vi.fn()
};

// vitest 4 requires a function declaration (not an arrow) when a mock is used
// with `new`. `google.auth.OAuth2` is instantiated with `new` in the source.
vi.mock('googleapis', () => ({
  google: {
    auth: {
      OAuth2: vi.fn(function OAuth2() { return mockOAuth2Client; })
    }
  }
}));

// Mock logger
vi.mock('../../../src/utils/logger.js', () => ({
  getGlobalLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  })
}));

describe('OAuthManager', () => {
  let oauth: OAuthManager;
  const testConfig = createTestConfig();

  beforeEach(() => {
    vol.reset();
    vol.mkdirSync('/tmp/gsc-test', { recursive: true });
    // resetAllMocks (vs clearAllMocks) also clears queued mockResolvedValueOnce /
    // mockRejectedValueOnce responses. Without this they leak into later tests.
    vi.resetAllMocks();
    // resetAllMocks also wipes implementations. Re-seed the ones tests rely on.
    (google.auth.OAuth2 as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      function OAuth2() { return mockOAuth2Client; }
    );
    mockOAuth2Client.generateAuthUrl.mockReturnValue('https://accounts.google.com/auth');
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-01-15T12:00:00Z'));
    oauth = new OAuthManager(testConfig);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('getClient', () => {
    it('returns OAuth2 client instance', () => {
      const client = oauth.getClient();
      expect(client).toBe(mockOAuth2Client);
    });
  });

  describe('loadTokens', () => {
    it('returns tokens from file', async () => {
      vol.writeFileSync(testConfig.tokenPath, JSON.stringify(mockTokens));

      const tokens = await oauth.loadTokens();

      expect(tokens).not.toBeNull();
      expect(tokens?.access_token).toBe(mockTokens.access_token);
      expect(tokens?.refresh_token).toBe(mockTokens.refresh_token);
    });

    it('returns null when file does not exist', async () => {
      const tokens = await oauth.loadTokens();
      expect(tokens).toBeNull();
    });

    it('returns null for invalid JSON', async () => {
      vol.writeFileSync(testConfig.tokenPath, 'not valid json');

      const tokens = await oauth.loadTokens();
      expect(tokens).toBeNull();
    });

    it('returns null when access_token is missing', async () => {
      const invalidTokens = { ...mockTokens, access_token: undefined };
      vol.writeFileSync(testConfig.tokenPath, JSON.stringify(invalidTokens));

      const tokens = await oauth.loadTokens();
      expect(tokens).toBeNull();
    });

    it('returns null when refresh_token is missing', async () => {
      const invalidTokens = { ...mockTokens, refresh_token: undefined };
      vol.writeFileSync(testConfig.tokenPath, JSON.stringify(invalidTokens));

      const tokens = await oauth.loadTokens();
      expect(tokens).toBeNull();
    });

    it('sets credentials on OAuth2 client when tokens loaded', async () => {
      vol.writeFileSync(testConfig.tokenPath, JSON.stringify(mockTokens));

      await oauth.loadTokens();

      expect(mockOAuth2Client.setCredentials).toHaveBeenCalledWith(mockTokens);
    });
  });

  describe('saveTokens', () => {
    it('saves tokens to file', async () => {
      await oauth.saveTokens(mockTokens);

      const saved = vol.readFileSync(testConfig.tokenPath, 'utf-8') as string;
      const parsed = JSON.parse(saved);

      expect(parsed.access_token).toBe(mockTokens.access_token);
      expect(parsed.refresh_token).toBe(mockTokens.refresh_token);
    });

    it('creates directory if it does not exist', async () => {
      vol.reset(); // Clear all directories

      await oauth.saveTokens(mockTokens);

      expect(vol.existsSync('/tmp/gsc-test')).toBe(true);
      expect(vol.existsSync(testConfig.tokenPath)).toBe(true);
    });

    it('formats JSON with indentation', async () => {
      await oauth.saveTokens(mockTokens);

      const saved = vol.readFileSync(testConfig.tokenPath, 'utf-8') as string;

      expect(saved).toContain('\n');
      expect(saved).toContain('  '); // 2-space indentation
    });
  });

  describe('isAuthenticated', () => {
    it('returns true with valid tokens', async () => {
      vol.writeFileSync(testConfig.tokenPath, JSON.stringify(mockTokens));

      const result = await oauth.isAuthenticated();

      expect(result).toBe(true);
    });

    it('returns false when no tokens exist', async () => {
      const result = await oauth.isAuthenticated();
      expect(result).toBe(false);
    });

    it('attempts refresh for expired tokens', async () => {
      vol.writeFileSync(testConfig.tokenPath, JSON.stringify(mockExpiredTokens));

      mockOAuth2Client.refreshAccessToken.mockResolvedValueOnce({
        credentials: {
          access_token: 'new-access-token',
          refresh_token: mockExpiredTokens.refresh_token,
          scope: mockExpiredTokens.scope,
          token_type: mockExpiredTokens.token_type,
          expiry_date: Date.now() + 3600000
        }
      });

      const result = await oauth.isAuthenticated();

      expect(result).toBe(true);
      expect(mockOAuth2Client.refreshAccessToken).toHaveBeenCalled();
    });

    it('returns false when refresh fails', async () => {
      vol.writeFileSync(testConfig.tokenPath, JSON.stringify(mockExpiredTokens));

      mockOAuth2Client.refreshAccessToken.mockRejectedValueOnce(new Error('Refresh failed'));

      const result = await oauth.isAuthenticated();

      expect(result).toBe(false);
    });
  });

  describe('refreshTokens', () => {
    it('refreshes and saves new tokens', async () => {
      vol.writeFileSync(testConfig.tokenPath, JSON.stringify(mockTokens));

      const newCredentials = {
        access_token: 'new-access-token',
        refresh_token: mockTokens.refresh_token,
        scope: mockTokens.scope,
        token_type: mockTokens.token_type,
        expiry_date: Date.now() + 7200000
      };

      mockOAuth2Client.refreshAccessToken.mockResolvedValueOnce({
        credentials: newCredentials
      });

      const result = await oauth.refreshTokens();

      expect(result.access_token).toBe('new-access-token');
      expect(mockOAuth2Client.setCredentials).toHaveBeenCalled();

      // Check file was updated
      const saved = vol.readFileSync(testConfig.tokenPath, 'utf-8') as string;
      const parsed = JSON.parse(saved);
      expect(parsed.access_token).toBe('new-access-token');
    });

    it('throws when no refresh token available', async () => {
      // No tokens file
      await expect(oauth.refreshTokens()).rejects.toThrow('No refresh token available');
    });

    it('throws specific error for deleted_client', async () => {
      vol.writeFileSync(testConfig.tokenPath, JSON.stringify(mockTokens));

      mockOAuth2Client.refreshAccessToken.mockRejectedValueOnce({
        response: {
          data: {
            error: 'deleted_client',
            error_description: 'The OAuth client was deleted'
          }
        }
      });

      await expect(oauth.refreshTokens()).rejects.toThrow('OAuth credentials deleted');
    });

    it('throws specific error for unauthorized_client', async () => {
      vol.writeFileSync(testConfig.tokenPath, JSON.stringify(mockTokens));

      mockOAuth2Client.refreshAccessToken.mockRejectedValueOnce({
        response: {
          data: {
            error: 'unauthorized_client',
            error_description: 'Unauthorized'
          }
        }
      });

      await expect(oauth.refreshTokens()).rejects.toThrow('OAuth tokens invalid');
    });

    it('throws specific error for invalid_grant', async () => {
      vol.writeFileSync(testConfig.tokenPath, JSON.stringify(mockTokens));

      mockOAuth2Client.refreshAccessToken.mockRejectedValueOnce({
        response: {
          data: {
            error: 'invalid_grant',
            error_description: 'Token has been revoked'
          }
        }
      });

      await expect(oauth.refreshTokens()).rejects.toThrow('Refresh token revoked');
    });

    it('preserves original refresh token if not returned', async () => {
      vol.writeFileSync(testConfig.tokenPath, JSON.stringify(mockTokens));

      mockOAuth2Client.refreshAccessToken.mockResolvedValueOnce({
        credentials: {
          access_token: 'new-access-token',
          // No refresh_token returned
          scope: mockTokens.scope,
          token_type: mockTokens.token_type,
          expiry_date: Date.now() + 3600000
        }
      });

      const result = await oauth.refreshTokens();

      expect(result.refresh_token).toBe(mockTokens.refresh_token);
    });
  });

  describe('ensureAuthenticated', () => {
    it('throws when no tokens exist', async () => {
      await expect(oauth.ensureAuthenticated()).rejects.toThrow('Not authenticated');
    });

    it('uses existing valid token', async () => {
      vol.writeFileSync(testConfig.tokenPath, JSON.stringify(mockTokens));

      await oauth.ensureAuthenticated();

      expect(mockOAuth2Client.setCredentials).toHaveBeenCalledWith(mockTokens);
      expect(mockOAuth2Client.refreshAccessToken).not.toHaveBeenCalled();
    });

    it('refreshes token expiring within 5 minutes', async () => {
      const soonExpiring = {
        ...mockTokens,
        expiry_date: Date.now() + 4 * 60 * 1000 // 4 minutes from now
      };
      vol.writeFileSync(testConfig.tokenPath, JSON.stringify(soonExpiring));

      mockOAuth2Client.refreshAccessToken.mockResolvedValueOnce({
        credentials: {
          access_token: 'new-access-token',
          refresh_token: mockTokens.refresh_token,
          scope: mockTokens.scope,
          token_type: mockTokens.token_type,
          expiry_date: Date.now() + 3600000
        }
      });

      await oauth.ensureAuthenticated();

      expect(mockOAuth2Client.refreshAccessToken).toHaveBeenCalled();
    });

    it('does not refresh token with more than 5 minutes validity', async () => {
      const validToken = {
        ...mockTokens,
        expiry_date: Date.now() + 10 * 60 * 1000 // 10 minutes from now
      };
      vol.writeFileSync(testConfig.tokenPath, JSON.stringify(validToken));

      await oauth.ensureAuthenticated();

      expect(mockOAuth2Client.refreshAccessToken).not.toHaveBeenCalled();
    });

    it('refreshes when no expiry_date is set', async () => {
      const noExpiry = { ...mockTokens };
      delete (noExpiry as Partial<typeof noExpiry>).expiry_date;
      vol.writeFileSync(testConfig.tokenPath, JSON.stringify(noExpiry));

      mockOAuth2Client.refreshAccessToken.mockResolvedValueOnce({
        credentials: {
          access_token: 'new-access-token',
          refresh_token: mockTokens.refresh_token,
          scope: mockTokens.scope,
          token_type: mockTokens.token_type,
          expiry_date: Date.now() + 3600000
        }
      });

      await oauth.ensureAuthenticated();

      expect(mockOAuth2Client.refreshAccessToken).toHaveBeenCalled();
    });
  });
});
