/*
 * @Author: Lieyan
 * @Date: 2025-08-27
 * @Description: Structured logging system for FireProxy
 * @Contact: QQ: 2102177341  Website: lieyan.space  Github: @lieyan666
 * @Copyright: Copyright (c) 2024 by lieyanDevTeam, All Rights Reserved.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

class Logger {
  constructor(options = {}) {
    this.level = options.level || process.env.LOG_LEVEL || 'info';
    this.logDir = options.logDir || './logs';
    this.maxFileSize = options.maxFileSize || 10 * 1024 * 1024; // 10MB
    this.maxFiles = options.maxFiles || 5;
    this.enableConsole = options.enableConsole !== false;
    this.enableFile = options.enableFile !== false;
    
    this.levels = {
      error: 0,
      warn: 1,
      info: 2,
      debug: 3,
      trace: 4
    };
    
    this.colors = {
      error: '\x1b[31m',
      warn: '\x1b[33m',
      info: '\x1b[36m',
      debug: '\x1b[32m',
      trace: '\x1b[37m',
      reset: '\x1b[0m'
    };
    
    this.stats = {
      totalLogs: 0,
      errorCount: 0,
      warnCount: 0,
      infoCount: 0,
      debugCount: 0,
      traceCount: 0
    };
    
    this.ensureLogDirectory();
    this.currentLogFile = this.getLogFileName();
  }
  
  ensureLogDirectory() {
    if (this.enableFile && !fs.existsSync(this.logDir)) {
      fs.mkdirSync(this.logDir, { recursive: true });
    }
  }
  
  getLogFileName() {
    const date = new Date().toISOString().split('T')[0];
    return path.join(this.logDir, `fireproxy-${date}.log`);
  }
  
  shouldLog(level) {
    return this.levels[level] <= this.levels[this.level];
  }
  
  formatMessage(level, message, meta = {}) {
    const timestamp = new Date().toISOString();
    const hostname = os.hostname();
    const pid = process.pid;
    
    const logEntry = {
      timestamp,
      level: level.toUpperCase(),
      hostname,
      pid,
      message,
      ...meta
    };
    
    return logEntry;
  }
  
  formatConsoleOutput(logEntry) {
    const { timestamp, level, message, ...meta } = logEntry;
    const color = this.colors[level.toLowerCase()] || '';
    const reset = this.colors.reset;
    
    let output = `${color}[${timestamp}] [${level}] ${message}${reset}`;
    
    if (Object.keys(meta).length > 0) {
      output += `\n  Meta: ${JSON.stringify(meta, null, 2)}`;
    }
    
    return output;
  }
  
  formatFileOutput(logEntry) {
    return JSON.stringify(logEntry) + '\n';
  }
  
  async rotateLogFile() {
    if (!this.enableFile) return;
    
    try {
      const stats = fs.statSync(this.currentLogFile);
      if (stats.size >= this.maxFileSize) {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const rotatedFile = this.currentLogFile.replace('.log', `-${timestamp}.log`);
        
        fs.renameSync(this.currentLogFile, rotatedFile);
        
        // Clean up old log files
        this.cleanupOldLogs();
        
        this.currentLogFile = this.getLogFileName();
      }
    } catch (error) {
      // Log file doesn't exist yet, which is fine
    }
  }
  
  cleanupOldLogs() {
    try {
      const files = fs.readdirSync(this.logDir)
        .filter(file => file.startsWith('fireproxy-') && file.endsWith('.log'))
        .map(file => ({
          name: file,
          path: path.join(this.logDir, file),
          mtime: fs.statSync(path.join(this.logDir, file)).mtime
        }))
        .sort((a, b) => b.mtime - a.mtime);
      
      if (files.length > this.maxFiles) {
        const filesToDelete = files.slice(this.maxFiles);
        filesToDelete.forEach(file => {
          fs.unlinkSync(file.path);
        });
      }
    } catch (error) {
      // Ignore cleanup errors
    }
  }
  
  async writeToFile(logEntry) {
    if (!this.enableFile) return;
    
    try {
      await this.rotateLogFile();
      const logLine = this.formatFileOutput(logEntry);
      fs.appendFileSync(this.currentLogFile, logLine);
    } catch (error) {
      // Fallback to console if file write fails
      console.error('Failed to write to log file:', error.message);
    }
  }
  
  async log(level, message, meta = {}) {
    if (!this.shouldLog(level)) return;
    
    const logEntry = this.formatMessage(level, message, meta);
    this.stats.totalLogs++;
    this.stats[level + 'Count']++;
    
    if (this.enableConsole) {
      const consoleOutput = this.formatConsoleOutput(logEntry);
      console.log(consoleOutput);
    }
    
    if (this.enableFile) {
      await this.writeToFile(logEntry);
    }
  }
  
  // Convenience methods
  error(message, meta = {}) {
    return this.log('error', message, meta);
  }
  
  warn(message, meta = {}) {
    return this.log('warn', message, meta);
  }
  
  info(message, meta = {}) {
    return this.log('info', message, meta);
  }
  
  debug(message, meta = {}) {
    return this.log('debug', message, meta);
  }
  
  trace(message, meta = {}) {
    return this.log('trace', message, meta);
  }
  
  // Proxy-specific logging methods
  proxyConnection(type, ruleId, clientInfo, targetInfo, poolInfo = {}) {
    this.info(`${type.toUpperCase()} connection established`, {
      type: 'proxy_connection',
      protocol: type.toLowerCase(),
      ruleId,
      clientAddress: clientInfo.address,
      clientPort: clientInfo.port,
      targetAddress: targetInfo.address,
      targetPort: targetInfo.port,
      ...poolInfo
    });
  }
  
  proxyDisconnection(type, ruleId, clientInfo, reason = 'normal') {
    this.info(`${type.toUpperCase()} connection closed`, {
      type: 'proxy_disconnection',
      protocol: type.toLowerCase(),
      ruleId,
      clientAddress: clientInfo.address,
      clientPort: clientInfo.port,
      reason
    });
  }
  
  proxyError(type, ruleId, error, context = {}) {
    this.error(`${type.toUpperCase()} proxy error`, {
      type: 'proxy_error',
      protocol: type.toLowerCase(),
      ruleId,
      error: error.message,
      stack: error.stack,
      ...context
    });
  }
  
  systemMetrics(metrics) {
    this.debug('System metrics', {
      type: 'system_metrics',
      ...metrics
    });
  }
  
  performanceMetrics(metrics) {
    this.info('Performance metrics', {
      type: 'performance_metrics',
      ...metrics
    });
  }
  
  getStats() {
    return {
      ...this.stats,
      currentLogLevel: this.level,
      logDirectory: this.logDir,
      currentLogFile: this.currentLogFile,
      fileLoggingEnabled: this.enableFile,
      consoleLoggingEnabled: this.enableConsole
    };
  }
  
  setLevel(level) {
    if (this.levels.hasOwnProperty(level)) {
      this.level = level;
      this.info('Log level changed', { newLevel: level });
    } else {
      this.error('Invalid log level', { attemptedLevel: level, validLevels: Object.keys(this.levels) });
    }
  }
}

// Create default logger instance
const defaultLogger = new Logger({
  level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
  enableFile: process.env.NODE_ENV === 'production'
});

module.exports = {
  Logger,
  logger: defaultLogger
};