/*
 * @Author: Lieyan
 * @Date: 2025-08-27
 * @Description: Health check and statistics API server for FireProxy
 * @Contact: QQ: 2102177341  Website: lieyan.space  Github: @lieyan666
 * @Copyright: Copyright (c) 2024 by lieyanDevTeam, All Rights Reserved.
 */

const http = require('http');
const url = require('url');
const os = require('os');
const { logger } = require('./logger');

class APIServer {
  constructor(options = {}) {
    this.port = options.port || process.env.API_PORT || 8080;
    this.host = options.host || '127.0.0.1';
    this.enableCors = options.enableCors !== false;
    this.server = null;
    this.performanceMonitor = null;
    this.proxyInstances = new Map();
    this.startTime = Date.now();
    
    this.routes = {
      '/health': this.handleHealth.bind(this),
      '/stats': this.handleStats.bind(this),
      '/status': this.handleStatus.bind(this),
      '/log-level': this.handleLogLevel.bind(this),
      '/proxy-stats': this.handleProxyStats.bind(this),
      '/system-info': this.handleSystemInfo.bind(this)
    };
  }
  
  setPerformanceMonitor(monitor) {
    this.performanceMonitor = monitor;
  }
  
  registerProxy(proxyId, proxyInstance) {
    this.proxyInstances.set(proxyId, proxyInstance);
  }
  
  unregisterProxy(proxyId) {
    this.proxyInstances.delete(proxyId);
  }
  
  start() {
    return new Promise((resolve, reject) => {
      this.server = http.createServer(this.handleRequest.bind(this));
      
      this.server.listen(this.port, this.host, () => {
        logger.info(`API server started`, {
          type: 'api_server_start',
          host: this.host,
          port: this.port,
          endpoints: Object.keys(this.routes)
        });
        resolve();
      });
      
      this.server.on('error', (error) => {
        logger.error('API server error', { error: error.message });
        reject(error);
      });
    });
  }
  
  stop() {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => {
          logger.info('API server stopped');
          resolve();
        });
      } else {
        resolve();
      }
    });
  }
  
  handleRequest(req, res) {
    const parsedUrl = url.parse(req.url, true);
    const pathname = parsedUrl.pathname;
    const method = req.method;
    
    // Enable CORS if configured
    if (this.enableCors) {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
      
      if (method === 'OPTIONS') {
        res.writeHead(200);
        res.end();
        return;
      }
    }
    
    // Log API request
    logger.debug('API request', {
      type: 'api_request',
      method,
      path: pathname,
      query: parsedUrl.query,
      userAgent: req.headers['user-agent'],
      ip: req.connection.remoteAddress
    });
    
    // Route handling
    const handler = this.routes[pathname];
    if (handler) {
      try {
        handler(req, res, parsedUrl);
      } catch (error) {
        logger.error('API handler error', {
          type: 'api_handler_error',
          path: pathname,
          error: error.message,
          stack: error.stack
        });
        this.sendErrorResponse(res, 500, 'Internal Server Error', error.message);
      }
    } else {
      this.sendErrorResponse(res, 404, 'Not Found', `Endpoint ${pathname} not found`);
    }
  }
  
  async handleHealth(req, res) {
    const uptime = Date.now() - this.startTime;
    const uptimeSeconds = Math.floor(uptime / 1000);
    
    // Check system health indicators
    const memoryUsage = process.memoryUsage();
    const memoryUsageMB = {
      rss: Math.round(memoryUsage.rss / 1024 / 1024),
      heapTotal: Math.round(memoryUsage.heapTotal / 1024 / 1024),
      heapUsed: Math.round(memoryUsage.heapUsed / 1024 / 1024),
      external: Math.round(memoryUsage.external / 1024 / 1024)
    };
    
    const loadAverage = os.loadavg();
    const cpuCount = os.cpus().length;
    
    // Determine health status
    const healthChecks = {
      memory: memoryUsageMB.rss < 1000, // Less than 1GB
      cpu: loadAverage[0] < cpuCount * 2, // Load average less than 2x CPU count
      uptime: uptimeSeconds > 10, // Running for more than 10 seconds
      proxies: this.proxyInstances.size > 0 // At least one proxy active
    };
    
    const isHealthy = Object.values(healthChecks).every(check => check);
    const status = isHealthy ? 'healthy' : 'unhealthy';
    
    const healthData = {
      status,
      timestamp: new Date().toISOString(),
      uptime: {
        seconds: uptimeSeconds,
        human: this.formatUptime(uptimeSeconds)
      },
      memory: memoryUsageMB,
      system: {
        loadAverage: loadAverage.map(avg => Math.round(avg * 100) / 100),
        cpuCount,
        platform: os.platform(),
        nodeVersion: process.version
      },
      checks: healthChecks,
      activeProxies: this.proxyInstances.size
    };
    
    const statusCode = isHealthy ? 200 : 503;
    this.sendJSONResponse(res, statusCode, healthData);
  }
  
  async handleStats(req, res) {
    const stats = {
      timestamp: new Date().toISOString(),
      uptime: Date.now() - this.startTime,
      system: this.getSystemStats(),
      proxy: this.getProxyStats(),
      logger: logger.getStats(),
      api: {
        endpoints: Object.keys(this.routes).length,
        activeConnections: this.server ? this.server._connections : 0
      }
    };
    
    if (this.performanceMonitor) {
      stats.performance = this.performanceMonitor.getStats();
    }
    
    this.sendJSONResponse(res, 200, stats);
  }
  
  async handleStatus(req, res) {
    const proxyStatus = [];
    
    for (const [proxyId, proxy] of this.proxyInstances) {
      let proxyStats = {};
      try {
        if (proxy && typeof proxy.getStats === 'function') {
          proxyStats = proxy.getStats();
        }
      } catch (error) {
        proxyStats = { error: error.message };
      }
      
      proxyStatus.push({
        id: proxyId,
        type: proxyId.split('_')[0],
        stats: proxyStats
      });
    }
    
    const statusData = {
      timestamp: new Date().toISOString(),
      totalProxies: this.proxyInstances.size,
      proxies: proxyStatus,
      systemStatus: {
        memory: process.memoryUsage(),
        uptime: process.uptime(),
        loadAverage: os.loadavg()
      }
    };
    
    this.sendJSONResponse(res, 200, statusData);
  }
  
  async handleLogLevel(req, res, parsedUrl) {
    if (req.method === 'GET') {
      this.sendJSONResponse(res, 200, {
        currentLevel: logger.level,
        availableLevels: Object.keys(logger.levels),
        stats: logger.getStats()
      });
    } else if (req.method === 'POST') {
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', () => {
        try {
          const data = JSON.parse(body);
          if (data.level && logger.levels.hasOwnProperty(data.level)) {
            const oldLevel = logger.level;
            logger.setLevel(data.level);
            
            logger.info('Log level changed via API', {
              type: 'log_level_change',
              oldLevel,
              newLevel: data.level,
              changedBy: req.connection.remoteAddress
            });
            
            this.sendJSONResponse(res, 200, {
              message: 'Log level updated successfully',
              oldLevel,
              newLevel: data.level
            });
          } else {
            this.sendErrorResponse(res, 400, 'Bad Request', 'Invalid log level');
          }
        } catch (error) {
          this.sendErrorResponse(res, 400, 'Bad Request', 'Invalid JSON');
        }
      });
    } else {
      this.sendErrorResponse(res, 405, 'Method Not Allowed', 'Only GET and POST methods are allowed');
    }
  }
  
  async handleProxyStats(req, res) {
    const detailedStats = {};
    
    for (const [proxyId, proxy] of this.proxyInstances) {
      try {
        if (proxy && typeof proxy.getStats === 'function') {
          detailedStats[proxyId] = proxy.getStats();
        }
      } catch (error) {
        detailedStats[proxyId] = { error: error.message };
      }
    }
    
    this.sendJSONResponse(res, 200, {
      timestamp: new Date().toISOString(),
      totalProxies: this.proxyInstances.size,
      proxyStats: detailedStats
    });
  }
  
  async handleSystemInfo(req, res) {
    const systemInfo = {
      timestamp: new Date().toISOString(),
      system: {
        platform: os.platform(),
        arch: os.arch(),
        hostname: os.hostname(),
        uptime: os.uptime(),
        loadavg: os.loadavg(),
        totalmem: os.totalmem(),
        freemem: os.freemem(),
        cpus: os.cpus().map(cpu => ({
          model: cpu.model,
          speed: cpu.speed,
          times: cpu.times
        }))
      },
      process: {
        version: process.version,
        arch: process.arch,
        platform: process.platform,
        uptime: process.uptime(),
        memoryUsage: process.memoryUsage(),
        pid: process.pid,
        ppid: process.ppid
      },
      environment: {
        nodeEnv: process.env.NODE_ENV || 'development',
        logLevel: process.env.LOG_LEVEL || 'info'
      }
    };
    
    this.sendJSONResponse(res, 200, systemInfo);
  }
  
  getSystemStats() {
    const memoryUsage = process.memoryUsage();
    return {
      memory: {
        rss: Math.round(memoryUsage.rss / 1024 / 1024),
        heapTotal: Math.round(memoryUsage.heapTotal / 1024 / 1024),
        heapUsed: Math.round(memoryUsage.heapUsed / 1024 / 1024),
        external: Math.round(memoryUsage.external / 1024 / 1024),
        usage: Math.round((os.totalmem() - os.freemem()) / os.totalmem() * 100)
      },
      cpu: {
        loadAverage: os.loadavg(),
        cpuCount: os.cpus().length
      },
      uptime: {
        system: os.uptime(),
        process: process.uptime()
      }
    };
  }
  
  getProxyStats() {
    let totalConnections = 0;
    let activeConnections = 0;
    let totalErrors = 0;
    let totalMessages = 0;
    
    for (const [proxyId, proxy] of this.proxyInstances) {
      try {
        if (proxy && typeof proxy.getStats === 'function') {
          const stats = proxy.getStats();
          totalConnections += stats.totalConnections || stats.clientConnections || 0;
          activeConnections += stats.activeConnections || stats.activeClients || 0;
          totalErrors += stats.errors || 0;
          totalMessages += stats.messagesForwarded || 0;
        }
      } catch (error) {
        totalErrors++;
      }
    }
    
    return {
      totalProxies: this.proxyInstances.size,
      totalConnections,
      activeConnections,
      totalErrors,
      totalMessages
    };
  }
  
  formatUptime(seconds) {
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    
    if (days > 0) {
      return `${days}d ${hours}h ${minutes}m ${secs}s`;
    } else if (hours > 0) {
      return `${hours}h ${minutes}m ${secs}s`;
    } else if (minutes > 0) {
      return `${minutes}m ${secs}s`;
    } else {
      return `${secs}s`;
    }
  }
  
  sendJSONResponse(res, statusCode, data) {
    res.writeHead(statusCode, {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-cache'
    });
    res.end(JSON.stringify(data, null, 2));
  }
  
  sendErrorResponse(res, statusCode, error, message) {
    const errorData = {
      error,
      message,
      timestamp: new Date().toISOString(),
      statusCode
    };
    
    logger.warn('API error response', {
      type: 'api_error_response',
      statusCode,
      error,
      message
    });
    
    this.sendJSONResponse(res, statusCode, errorData);
  }
}

module.exports = { APIServer };