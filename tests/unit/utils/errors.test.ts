import { describe, it, expect } from 'vitest';
import { formatError, handleToolError } from '../../../src/utils/errors.js';
import { GSCApiError } from '../../../src/types/index.js';

describe('error utilities', () => {
  describe('formatError', () => {
    it('formats GSCApiError with code, message, and details', () => {
      const error = new GSCApiError({
        code: 'RATE_LIMITED',
        message: 'Too many requests',
        retryAfter: 60,
        details: { endpoint: '/api/test' }
      });

      const result = formatError(error);

      expect(result.error.code).toBe('RATE_LIMITED');
      expect(result.error.message).toBe('Too many requests');
      expect(result.error.details).toEqual({ endpoint: '/api/test' });
    });

    it('formats GSCApiError without details when not provided', () => {
      const error = new GSCApiError({
        code: 'NOT_FOUND',
        message: 'Resource not found'
      });

      const result = formatError(error);

      expect(result.error.code).toBe('NOT_FOUND');
      expect(result.error.message).toBe('Resource not found');
      expect(result.error.details).toBeUndefined();
    });

    it('formats standard Error with UNKNOWN_ERROR code', () => {
      const error = new Error('Something went wrong');

      const result = formatError(error);

      expect(result.error.code).toBe('UNKNOWN_ERROR');
      expect(result.error.message).toBe('Something went wrong');
    });

    it('formats string errors with UNKNOWN_ERROR code', () => {
      const result = formatError('A string error');

      expect(result.error.code).toBe('UNKNOWN_ERROR');
      expect(result.error.message).toBe('A string error');
    });

    it('formats null/undefined as string', () => {
      expect(formatError(null).error.message).toBe('null');
      expect(formatError(undefined).error.message).toBe('undefined');
    });

    it('formats objects as string', () => {
      const result = formatError({ custom: 'error' });

      expect(result.error.code).toBe('UNKNOWN_ERROR');
      expect(result.error.message).toBe('[object Object]');
    });

    it('formats numbers as string', () => {
      const result = formatError(42);

      expect(result.error.code).toBe('UNKNOWN_ERROR');
      expect(result.error.message).toBe('42');
    });
  });

  describe('handleToolError', () => {
    it('returns ToolResult with structured + text error for GSCApiError', () => {
      const error = new GSCApiError({
        code: 'AUTH_FAILED',
        message: 'Authentication failed'
      });

      const result = handleToolError(error);

      expect(result.isError).toBe(true);
      const structured = result.structured as { error: { code: string; message: string } };
      expect(structured.error.code).toBe('AUTH_FAILED');
      expect(structured.error.message).toBe('Authentication failed');
      const parsed = JSON.parse(result.text);
      expect(parsed.error.code).toBe('AUTH_FAILED');
    });

    it('returns ToolResult for standard Error with UNKNOWN_ERROR code', () => {
      const error = new Error('Test error');

      const result = handleToolError(error);

      expect(result.isError).toBe(true);
      const parsed = JSON.parse(result.text);
      expect(parsed.error.code).toBe('UNKNOWN_ERROR');
      expect(parsed.error.message).toBe('Test error');
    });

    it('formats the text payload with indentation', () => {
      const error = new Error('Test');
      const result = handleToolError(error);

      expect(result.text).toContain('\n');
      expect(result.text).toContain('  '); // 2-space indentation
    });

    it('preserves GSCApiError details through to structured payload', () => {
      const error = new GSCApiError({
        code: 'QUOTA_EXCEEDED',
        message: 'Daily quota exceeded',
        retryAfter: 3600,
        details: {
          quotaType: 'daily',
          limit: 10000,
          used: 10001
        }
      });

      const result = handleToolError(error);
      const parsed = JSON.parse(result.text);

      expect(parsed.error.code).toBe('QUOTA_EXCEEDED');
      expect(parsed.error.message).toBe('Daily quota exceeded');
      expect(parsed.error.details.quotaType).toBe('daily');
    });
  });

  describe('GSCApiError', () => {
    it('has correct name property', () => {
      const error = new GSCApiError({
        code: 'TEST',
        message: 'Test message'
      });

      expect(error.name).toBe('GSCApiError');
    });

    it('is instance of Error', () => {
      const error = new GSCApiError({
        code: 'TEST',
        message: 'Test message'
      });

      expect(error instanceof Error).toBe(true);
      expect(error instanceof GSCApiError).toBe(true);
    });

    it('stores retryAfter value', () => {
      const error = new GSCApiError({
        code: 'RATE_LIMITED',
        message: 'Rate limited',
        retryAfter: 120
      });

      expect(error.retryAfter).toBe(120);
    });
  });
});
