// Logger utility with development mode support
import { DEV_CONFIG } from '../config/defaults.js';

class Logger {
  constructor() {
    this.devMode = DEV_CONFIG.debug;
    this.logLevel = DEV_CONFIG.logLevel;
  }

  setDevMode(enabled) {
    this.devMode = enabled;
  }

  setLogLevel(level) {
    this.logLevel = level;
  }

  debug(...args) {
    if (this.devMode && this.shouldLog('debug')) {
      console.log('[DEBUG]', ...args);
    }
  }

  info(...args) {
    if (this.shouldLog('info')) {
      console.log('[INFO]', ...args);
    }
  }

  warn(...args) {
    if (this.shouldLog('warn')) {
      console.warn('[WARN]', ...args);
    }
  }

  error(...args) {
    if (this.shouldLog('error')) {
      console.error('[ERROR]', ...args);
    }
  }

  shouldLog(level) {
    const levels = ['debug', 'info', 'warn', 'error'];
    const currentLevelIndex = levels.indexOf(this.logLevel);
    const requestedLevelIndex = levels.indexOf(level);
    return requestedLevelIndex >= currentLevelIndex;
  }
}

// Export singleton instance
export const logger = new Logger();
