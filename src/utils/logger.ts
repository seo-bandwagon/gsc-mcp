import type { GSCConfig } from '../types/index.js';

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const levels: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3
};

export interface Logger {
  debug: (msg: string, data?: Record<string, unknown>) => void;
  info: (msg: string, data?: Record<string, unknown>) => void;
  warn: (msg: string, data?: Record<string, unknown>) => void;
  error: (msg: string, data?: Record<string, unknown>) => void;
}

function formatLogEntry(level: LogLevel, msg: string, data?: Record<string, unknown>): string {
  const timestamp = new Date().toISOString();
  const prefix = `${timestamp} [${level.toUpperCase()}]`;

  if (data && Object.keys(data).length > 0) {
    return `${prefix} ${msg} ${JSON.stringify(data)}`;
  }
  return `${prefix} ${msg}`;
}

function log(
  level: LogLevel,
  msg: string,
  data: Record<string, unknown> | undefined,
  configLevel: LogLevel
): void {
  if (levels[level] >= levels[configLevel]) {
    // MCP servers use stdout for protocol, so logs go to stderr
    console.error(formatLogEntry(level, msg, data));
  }
}

export function createLogger(config: GSCConfig): Logger {
  const configLevel = config.logLevel || 'info';

  return {
    debug: (msg: string, data?: Record<string, unknown>) => log('debug', msg, data, configLevel),
    info: (msg: string, data?: Record<string, unknown>) => log('info', msg, data, configLevel),
    warn: (msg: string, data?: Record<string, unknown>) => log('warn', msg, data, configLevel),
    error: (msg: string, data?: Record<string, unknown>) => log('error', msg, data, configLevel)
  };
}

// Singleton logger for use before config is available
let globalLogger: Logger | null = null;

export function getGlobalLogger(): Logger {
  if (!globalLogger) {
    // Default to 'info' level before config is loaded
    globalLogger = {
      debug: (msg: string, data?: Record<string, unknown>) => log('debug', msg, data, 'info'),
      info: (msg: string, data?: Record<string, unknown>) => log('info', msg, data, 'info'),
      warn: (msg: string, data?: Record<string, unknown>) => log('warn', msg, data, 'info'),
      error: (msg: string, data?: Record<string, unknown>) => log('error', msg, data, 'info')
    };
  }
  return globalLogger;
}

export function setGlobalLogger(logger: Logger): void {
  globalLogger = logger;
}
