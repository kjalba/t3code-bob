/**
 * Stderr-only logger for ACP adapter
 * CRITICAL: Never write to stdout - it's reserved for JSON-RPC protocol
 */

import { writeFileSync, appendFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';

export enum LogLevel {
  ERROR = 0,
  WARN = 1,
  INFO = 2,
  DEBUG = 3,
}

export interface LogEntry {
  timestamp: string;
  level: string;
  component: string;
  message: string;
  sessionId?: string;
  data?: unknown;
}

const REDACTION_KEYS = /(token|authorization|api[-_]?key|secret|password)/i;

export function redactSensitiveData(data: unknown, seen: WeakSet<object> = new WeakSet()): unknown {
  if (Array.isArray(data)) {
    return data.map((item) => redactSensitiveData(item, seen));
  }

  if (data && typeof data === 'object') {
    if (seen.has(data as object)) {
      return '[Circular]';
    }
    seen.add(data as object);

    const redacted: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
      if (REDACTION_KEYS.test(key)) {
        redacted[key] = '[REDACTED]';
      } else {
        redacted[key] = redactSensitiveData(value, seen);
      }
    }
    return redacted;
  }

  return data;
}

class Logger {
  private level: LogLevel;
  private logFilePath: string | null = null;

  constructor() {
    const envLevel = process.env.BOB_LOG_LEVEL?.toUpperCase();
    this.level = this.parseLogLevel(envLevel || 'INFO');
    
    // Initialize log file if BOB_LOG_FILE is set
    const logFile = process.env.BOB_LOG_FILE;
    if (logFile) {
      this.initLogFile(logFile);
    }
  }

  private initLogFile(logPath: string): void {
    try {
      // Expand ~ to home directory
      const expandedPath = logPath.startsWith('~')
        ? join(homedir(), logPath.slice(1))
        : logPath;
      
      // Create directory if it doesn't exist
      const dir = dirname(expandedPath);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
      
      this.logFilePath = expandedPath;
      
      // Write header to log file
      const header = `\n${'-'.repeat(80)}\nBob Shell ACP Adapter Log - ${new Date().toISOString()}\n${'-'.repeat(80)}\n`;
      writeFileSync(this.logFilePath, header, { flag: 'a' });
      
      this.info('logger', 'Log file initialized', { path: this.logFilePath });
    } catch (error) {
      process.stderr.write(`Failed to initialize log file: ${error}\n`);
    }
  }

  private parseLogLevel(level: string): LogLevel {
    switch (level) {
      case 'ERROR':
        return LogLevel.ERROR;
      case 'WARN':
        return LogLevel.WARN;
      case 'INFO':
        return LogLevel.INFO;
      case 'DEBUG':
        return LogLevel.DEBUG;
      default:
        return LogLevel.INFO;
    }
  }

  private log(level: LogLevel, component: string, message: string, data?: unknown, sessionId?: string): void {
    if (level > this.level) {
      return;
    }

    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level: LogLevel[level],
      component,
      message,
    };
    
    if (sessionId !== undefined) {
      entry.sessionId = sessionId;
    }
    if (data !== undefined) {
      entry.data = redactSensitiveData(data);
    }

    const logLine = JSON.stringify(entry) + '\n';

    // Write to stderr only - NEVER stdout
    process.stderr.write(logLine);
    
    // Also write to log file if configured
    if (this.logFilePath) {
      try {
        appendFileSync(this.logFilePath, logLine);
      } catch (error) {
        // Don't fail if file logging fails
        process.stderr.write(`Failed to write to log file: ${error}\n`);
      }
    }
  }

  error(component: string, message: string, data?: unknown, sessionId?: string): void {
    this.log(LogLevel.ERROR, component, message, data, sessionId);
  }

  warn(component: string, message: string, data?: unknown, sessionId?: string): void {
    this.log(LogLevel.WARN, component, message, data, sessionId);
  }

  info(component: string, message: string, data?: unknown, sessionId?: string): void {
    this.log(LogLevel.INFO, component, message, data, sessionId);
  }

  debug(component: string, message: string, data?: unknown, sessionId?: string): void {
    this.log(LogLevel.DEBUG, component, message, data, sessionId);
  }
}

// Singleton instance
export const logger = new Logger();

// Made with Bob
