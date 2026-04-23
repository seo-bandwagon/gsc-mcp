export interface ToolAnnotations {
  /** If true, the tool does not modify any data. */
  readOnlyHint?: boolean;
  /** If true, the tool may perform destructive operations (e.g. delete). */
  destructiveHint?: boolean;
  /** If true, the tool's effect is unchanged when called twice with the same args. */
  idempotentHint?: boolean;
  /** If true, the tool interacts with external systems whose state the server doesn't control. */
  openWorldHint?: boolean;
  /** If true, the tool may take noticeable time to complete. */
  longRunningHint?: boolean;
  /** If true, the client should prompt the user before invoking. */
  requiresConfirmation?: boolean;
}

export interface JsonSchemaObject {
  type: 'object';
  properties: Record<string, unknown>;
  required?: readonly string[];
  additionalProperties?: boolean;
}

export interface Tool {
  name: string;
  description: string;
  inputSchema: JsonSchemaObject;
  /** Optional output schema — when set, the server will emit structuredContent matching this shape. */
  outputSchema?: JsonSchemaObject;
  annotations?: ToolAnnotations;
}

/**
 * Result returned by a tool handler. `text` is always required (clients that don't
 * support structuredContent will render this). `structured` is optional and, when
 * present, will be surfaced as `structuredContent` in the MCP response — it must
 * conform to the tool's `outputSchema`.
 */
export interface ToolResult {
  text: string;
  structured?: unknown;
  isError?: boolean;
}

export interface ToolHandler {
  (args: Record<string, unknown>): Promise<ToolResult>;
}

/** Helper: build a success result from a structured payload. */
export function ok<T>(data: T): ToolResult {
  return {
    text: JSON.stringify(data, null, 2),
    structured: data as unknown
  };
}

/** Helper: build an error result. Text is JSON-stringified for consistency with success path. */
export function err(error: { code: string; message: string; details?: unknown }): ToolResult {
  return {
    text: JSON.stringify({ error }, null, 2),
    structured: { error },
    isError: true
  };
}
