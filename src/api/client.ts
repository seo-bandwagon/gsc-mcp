import { google, searchconsole_v1 } from 'googleapis';
import { OAuthManager } from '../auth/oauth.js';
import { RateLimiter } from '../utils/rate-limiter.js';
import { Cache } from '../cache/cache.js';
import { GSCApiError } from '../types/index.js';
import type { GSCConfig } from '../types/index.js';
import { createLogger, setGlobalLogger, type Logger } from '../utils/logger.js';

export class GSCClient {
  private searchconsole: searchconsole_v1.Searchconsole;
  private oauth: OAuthManager;
  private rateLimiter: RateLimiter;
  private cache: Cache;
  private config: GSCConfig;
  private logger: Logger;

  constructor(config: GSCConfig) {
    this.config = config;
    this.logger = createLogger(config);
    setGlobalLogger(this.logger);
    this.oauth = new OAuthManager(config, this.logger);
    this.rateLimiter = new RateLimiter();
    this.cache = new Cache(config.cachePath);

    this.searchconsole = google.searchconsole({
      version: 'v1',
      auth: this.oauth.getClient()
    });
  }

  async initialize(): Promise<void> {
    await this.oauth.ensureAuthenticated();
    this.cache.initialize();
  }

  async close(): Promise<void> {
    this.cache.close();
  }

  getSearchConsole(): searchconsole_v1.Searchconsole {
    return this.searchconsole;
  }

  getCache(): Cache {
    return this.cache;
  }

  getRateLimiter(): RateLimiter {
    return this.rateLimiter;
  }

  getOAuthClient(): InstanceType<typeof google.auth.OAuth2> {
    return this.oauth.getClient();
  }

  getConfig(): GSCConfig {
    return this.config;
  }

  async withRetry<T>(
    operation: () => Promise<T>,
    endpoint: string,
    maxRetries = 3
  ): Promise<T> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        await this.rateLimiter.acquire(endpoint);
        this.logger.debug(`API call attempt ${attempt + 1}/${maxRetries}`, { endpoint });
        const result = await operation();

        if (attempt > 0) {
          this.logger.info(`API call succeeded after ${attempt + 1} attempts`, { endpoint });
        }
        return result;
      } catch (error: unknown) {
        lastError = error as Error;

        // Handle Google API errors
        if (this.isGoogleApiError(error)) {
          const status = error.response?.status;
          const message = error.response?.data?.error?.message || error.message;

          this.logger.warn(`API error on attempt ${attempt + 1}/${maxRetries}`, {
            endpoint,
            status,
            message
          });

          // Rate limit - wait and retry, then fail with the remedy rather than the status
          if (status === 429) {
            if (attempt >= maxRetries - 1) {
              throw this.quotaError(endpoint, message);
            }
            const retryAfter = parseInt(error.response?.headers?.['retry-after'] || '60', 10);
            this.logger.warn(`Rate limited on ${endpoint}. Waiting ${retryAfter}s before retry`);
            await this.sleep(retryAfter * 1000);
            continue;
          }

          // Auth error - try to refresh token
          if (status === 401) {
            this.logger.info('Auth error (401), attempting token refresh');
            try {
              await this.oauth.refreshTokens();
              continue;
            } catch (refreshError) {
              this.logger.error('Token refresh failed after 401', {
                error: refreshError instanceof Error ? refreshError.message : String(refreshError)
              });
              throw new GSCApiError({
                code: 'AUTH_EXPIRED',
                message: 'Authentication expired. Delete ~/.gsc-mcp/tokens.json and run: npm run auth',
                details: { originalError: message }
              });
            }
          }

          // 403 covers both quota exhaustion and permission problems — split on the reason
          if (status === 403) {
            const reason = error.response?.data?.error?.errors?.[0]?.reason || '';
            if (/quota|rateLimit|userRateLimit/i.test(reason) || /quota/i.test(message)) {
              this.logger.error('Quota exceeded (403)', { endpoint, reason, message });
              throw this.quotaError(endpoint, message);
            }
            this.logger.error('Permission denied (403)', { endpoint, message });
            throw new GSCApiError({
              code: 'PERMISSION_DENIED',
              message: `Permission denied for ${endpoint}. Check your site permissions in Google Search Console.`,
              details: { originalError: message }
            });
          }

          // Not found
          if (status === 404) {
            this.logger.error('Resource not found (404)', { endpoint, message });
            throw new GSCApiError({
              code: 'SITE_NOT_FOUND',
              message: 'Site not found in your Search Console account. Verify the site URL is correct.',
              details: { originalError: message }
            });
          }

          // Server error - retry
          if (status && status >= 500) {
            if (attempt < maxRetries - 1) {
              const backoffMs = Math.pow(2, attempt) * 1000;
              this.logger.warn(`Server error (${status}), retrying in ${backoffMs}ms`, { endpoint });
              await this.sleep(backoffMs);
              continue;
            }
          }

          // Other errors - no more retries
          this.logger.error(`API call failed after ${attempt + 1} attempts`, {
            endpoint,
            status,
            message
          });
          throw new GSCApiError({
            code: 'API_ERROR',
            message: message,
            details: { status, endpoint, originalError: message }
          });
        }

        // Unknown error - retry with backoff
        if (attempt < maxRetries - 1) {
          const backoffMs = Math.pow(2, attempt) * 1000;
          this.logger.warn(`Unknown error, retrying in ${backoffMs}ms`, {
            endpoint,
            error: lastError?.message
          });
          await this.sleep(backoffMs);
          continue;
        }
      }
    }

    this.logger.error(`API call failed after ${maxRetries} attempts`, {
      endpoint,
      error: lastError?.message
    });
    throw lastError || new Error('Unknown error occurred');
  }

  /** Actionable quota error: the remedy, not just the status. */
  private quotaError(endpoint: string, originalMessage: string): GSCApiError {
    return new GSCApiError({
      code: 'QUOTA_EXCEEDED',
      retryAfter: 900,
      message:
        'Load quota exceeded. Short-term quota resets in ~15 minutes — wait and retry, or spread queries out. ' +
        "If a single query triggers this, it's long-term load: remove the 'page' and/or 'query' dimension, or " +
        'shorten the date range — load scales with range length, and page/query grouping is the most expensive. ' +
        'Avoid requerying the same data. See gsc://guidance/quota.',
      details: { endpoint, originalError: originalMessage }
    });
  }

  private isGoogleApiError(error: unknown): error is {
    response?: {
      status?: number;
      data?: { error?: { message?: string; errors?: Array<{ reason?: string }> } };
      headers?: Record<string, string>;
    };
    message: string;
  } {
    return (
      typeof error === 'object' &&
      error !== null &&
      'message' in error &&
      typeof (error as { message: unknown }).message === 'string'
    );
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
