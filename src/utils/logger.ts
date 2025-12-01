/**
 * Centralized logging utility
 * 
 * Provides structured logging capabilities with different log levels.
 * Supports context-aware logging and formatted output.
 */

export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3
}

interface LogContext {
  [key: string]: unknown;
}

class Logger {
  private level: LogLevel;
  private context: LogContext;

  constructor(level: LogLevel = LogLevel.INFO) {
    this.level = level;
    this.context = {};
  }

  setLevel(level: LogLevel): void {
    this.level = level;
  }

  setContext(context: LogContext): void {
    this.context = { ...this.context, ...context };
  }

  private shouldLog(level: LogLevel): boolean {
    return level >= this.level;
  }

  private formatMessage(level: string, message: string, context?: LogContext): string {
    const timestamp = new Date().toISOString();
    const mergedContext = { ...this.context, ...context };
    return JSON.stringify({
      timestamp,
      level,
      message,
      ...mergedContext
    });
  }

  debug(message: string, context?: LogContext): void {
    if (this.shouldLog(LogLevel.DEBUG)) {
      console.debug(this.formatMessage('DEBUG', message, context));
    }
  }

  info(message: string, context?: LogContext): void {
    if (this.shouldLog(LogLevel.INFO)) {
      console.info(this.formatMessage('INFO', message, context));
    }
  }

  warn(message: string, context?: LogContext): void {
    if (this.shouldLog(LogLevel.WARN)) {
      console.warn(this.formatMessage('WARN', message, context));
    }
  }

  error(message: string, error?: Error, context?: LogContext): void {
    if (this.shouldLog(LogLevel.ERROR)) {
      const errorContext = {
        ...context,
        error: error ? {
          name: error.name,
          message: error.message,
          stack: error.stack
        } : undefined
      };
      console.error(this.formatMessage('ERROR', message, errorContext));
    }
  }
}

export const logger = new Logger(LogLevel.INFO);

