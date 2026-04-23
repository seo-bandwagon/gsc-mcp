import { GSCApiError } from '../types/index.js';
import type { ToolResult } from '../tools/types.js';

export function formatError(error: unknown): { error: { code: string; message: string; details?: Record<string, unknown> } } {
  if (error instanceof GSCApiError) {
    return {
      error: {
        code: error.code,
        message: error.message,
        ...(error.details && { details: error.details })
      }
    };
  }

  if (error instanceof Error) {
    return {
      error: {
        code: 'UNKNOWN_ERROR',
        message: error.message
      }
    };
  }

  return {
    error: {
      code: 'UNKNOWN_ERROR',
      message: String(error)
    }
  };
}

/** Build a ToolResult from an unknown error. Use in tool handler catch blocks. */
export function handleToolError(error: unknown): ToolResult {
  const formatted = formatError(error);
  const text = JSON.stringify(formatted, null, 2);
  return {
    text,
    structured: formatted,
    isError: true
  };
}
