import { google } from 'googleapis';
import express from 'express';
import open from 'open';
import { readFile, writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { dirname } from 'path';
import type { OAuthTokens, GSCConfig } from '../types/index.js';
import { getGlobalLogger, type Logger } from '../utils/logger.js';

const SCOPES = [
  // Google Search Console
  'https://www.googleapis.com/auth/webmasters.readonly',
  'https://www.googleapis.com/auth/webmasters',
  // Google Analytics
  'https://www.googleapis.com/auth/analytics.readonly',
  // Google Ads
  'https://www.googleapis.com/auth/adwords'
];

export class OAuthManager {
  private config: GSCConfig;
  private oauth2Client: InstanceType<typeof google.auth.OAuth2>;
  private logger: Logger;

  constructor(config: GSCConfig, logger?: Logger) {
    this.config = config;
    this.logger = logger || getGlobalLogger();
    this.oauth2Client = new google.auth.OAuth2(
      config.clientId,
      config.clientSecret,
      config.redirectUri
    );
  }

  getClient(): InstanceType<typeof google.auth.OAuth2> {
    return this.oauth2Client;
  }

  async loadTokens(): Promise<OAuthTokens | null> {
    try {
      if (!existsSync(this.config.tokenPath)) {
        this.logger.debug('Token file not found', { path: this.config.tokenPath });
        return null;
      }
      const data = await readFile(this.config.tokenPath, 'utf-8');
      const tokens = JSON.parse(data) as OAuthTokens;

      // Validate token structure
      if (!tokens.access_token || !tokens.refresh_token) {
        this.logger.warn('Token file missing required fields', {
          hasAccessToken: !!tokens.access_token,
          hasRefreshToken: !!tokens.refresh_token
        });
        return null;
      }

      this.oauth2Client.setCredentials(tokens);
      this.logger.debug('Tokens loaded successfully', {
        expiresAt: tokens.expiry_date ? new Date(tokens.expiry_date).toISOString() : 'unknown'
      });
      return tokens;
    } catch (error) {
      this.logger.error('Failed to load tokens', {
        error: error instanceof Error ? error.message : String(error),
        path: this.config.tokenPath
      });
      return null;
    }
  }

  async saveTokens(tokens: OAuthTokens): Promise<void> {
    const dir = dirname(this.config.tokenPath);
    if (!existsSync(dir)) {
      await mkdir(dir, { recursive: true, mode: 0o700 });
    }
    // 0600 — readable/writable only by the owning user. Prevents other local
    // users from reading refresh tokens off disk.
    await writeFile(this.config.tokenPath, JSON.stringify(tokens, null, 2), { mode: 0o600 });
  }

  async isAuthenticated(): Promise<boolean> {
    const tokens = await this.loadTokens();
    if (!tokens) {
      this.logger.info('Not authenticated: no valid tokens found');
      return false;
    }

    // Check if token is expired
    if (tokens.expiry_date && tokens.expiry_date < Date.now()) {
      this.logger.info('Access token expired, attempting refresh');
      // Try to refresh
      try {
        await this.refreshTokens();
        return true;
      } catch (error) {
        this.logger.error('Token refresh failed during auth check', {
          error: error instanceof Error ? error.message : String(error)
        });
        return false;
      }
    }

    return true;
  }

  async refreshTokens(): Promise<OAuthTokens> {
    const tokens = await this.loadTokens();
    if (!tokens?.refresh_token) {
      throw new Error('No refresh token available. Delete ~/.gsc-mcp/tokens.json and run: npm run auth');
    }

    this.logger.debug('Attempting token refresh');
    this.oauth2Client.setCredentials({ refresh_token: tokens.refresh_token });

    try {
      const { credentials } = await this.oauth2Client.refreshAccessToken();

      const newTokens: OAuthTokens = {
        access_token: credentials.access_token!,
        refresh_token: credentials.refresh_token || tokens.refresh_token,
        scope: credentials.scope!,
        token_type: credentials.token_type!,
        expiry_date: credentials.expiry_date!
      };

      await this.saveTokens(newTokens);
      this.oauth2Client.setCredentials(newTokens);
      this.logger.info('Token refresh successful', {
        expiresAt: new Date(newTokens.expiry_date).toISOString()
      });
      return newTokens;
    } catch (error: unknown) {
      // Extract Google OAuth error code if available
      const errorData = (error as { response?: { data?: { error?: string; error_description?: string } } })
        ?.response?.data;
      const errorCode = errorData?.error;
      const errorDesc = errorData?.error_description;

      this.logger.error('Token refresh failed', {
        errorCode,
        errorDescription: errorDesc,
        error: error instanceof Error ? error.message : String(error)
      });

      // Provide specific, actionable error messages
      if (errorCode === 'deleted_client') {
        throw new Error(
          'OAuth credentials deleted. Create new credentials in Google Cloud Console and update your config.'
        );
      }
      if (errorCode === 'unauthorized_client') {
        throw new Error(
          'OAuth tokens invalid. Delete ~/.gsc-mcp/tokens.json and run: npm run auth'
        );
      }
      if (errorCode === 'invalid_grant') {
        throw new Error(
          'Refresh token revoked or expired. Delete ~/.gsc-mcp/tokens.json and run: npm run auth'
        );
      }

      throw error;
    }
  }

  async ensureAuthenticated(): Promise<void> {
    const tokens = await this.loadTokens();

    if (!tokens) {
      throw new Error(
        'Not authenticated. No token file found at ~/.gsc-mcp/tokens.json\n' +
        'Run this command to authenticate: npm run auth'
      );
    }

    // Refresh if expired or about to expire (within 5 minutes)
    const expiresIn = tokens.expiry_date ? tokens.expiry_date - Date.now() : 0;
    if (expiresIn < 5 * 60 * 1000) {
      this.logger.info('Token expiring soon, refreshing', {
        expiresInMs: expiresIn
      });
      await this.refreshTokens();
    } else {
      this.logger.debug('Using existing valid token', {
        expiresInMs: expiresIn
      });
      this.oauth2Client.setCredentials(tokens);
    }
  }

  async authenticate(): Promise<OAuthTokens> {
    return new Promise((resolve, reject) => {
      const app = express();
      let server: ReturnType<typeof app.listen>;

      const authUrl = this.oauth2Client.generateAuthUrl({
        access_type: 'offline',
        scope: SCOPES,
        prompt: 'consent'
      });

      app.get('/callback', async (req, res) => {
        const code = req.query.code as string;

        if (!code) {
          res.send('Error: No authorization code received');
          server.close();
          reject(new Error('No authorization code received'));
          return;
        }

        try {
          const { tokens } = await this.oauth2Client.getToken(code);

          const oauthTokens: OAuthTokens = {
            access_token: tokens.access_token!,
            refresh_token: tokens.refresh_token!,
            scope: tokens.scope!,
            token_type: tokens.token_type!,
            expiry_date: tokens.expiry_date!
          };

          await this.saveTokens(oauthTokens);
          this.oauth2Client.setCredentials(oauthTokens);

          res.send(`
            <html>
              <body style="font-family: system-ui; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; background: #f5f5f5;">
                <div style="text-align: center; padding: 40px; background: white; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.1);">
                  <h1 style="color: #22c55e;">✓ Authentication Successful</h1>
                  <p>You can close this window and return to the terminal.</p>
                </div>
              </body>
            </html>
          `);

          server.close();
          resolve(oauthTokens);
        } catch (error) {
          res.send('Error: Failed to exchange authorization code');
          server.close();
          reject(error);
        }
      });

      // Extract port from redirect URI
      const url = new URL(this.config.redirectUri);
      const port = parseInt(url.port) || 3000;

      server = app.listen(port, () => {
        console.log(`\nOpening browser for authentication...`);
        console.log(`If the browser doesn't open, visit: ${authUrl}\n`);
        open(authUrl);
      });

      // Timeout after 5 minutes
      setTimeout(() => {
        server.close();
        reject(new Error('Authentication timeout'));
      }, 5 * 60 * 1000);
    });
  }
}
