/*
 * @Author: Lieyan
 * @Date: 2024-02-06 01:59:21
 * @LastEditors: Lieyan
 * @LastEditTime: 2025-04-13 13:48:58
 * @FilePath: /FireProxy/app.js
 * @Description:
 * @Contact: QQ: 2102177341  Website: lieyan.space  Github: @lieyan666
 * @Copyright: Copyright (c) 2024 by lieyanDevTeam, All Rights Reserved.
 */
const fs = require("fs");
const { startTCPServer } = require("./modules/tcpProxy.js");
const { startUDPServer } = require("./modules/udpProxy.js");
const { monitor } = require("./modules/performanceMonitor.js");
const { logger } = require("./modules/logger.js");
const { APIServer } = require("./modules/apiServer.js");

let config;
let apiServer;
const configPath = "config.json";

// Read and parse config with error handling
try {
  if (!fs.existsSync(configPath)) {
    logger.error('Configuration file not found', {
      configPath,
      suggestion: 'Create config.json based on config.example.json'
    });
    process.exit(1);
  }
  const configFileContent = fs.readFileSync(configPath);
  config = JSON.parse(configFileContent);
  if (!config || !Array.isArray(config.forward)) {
    throw new Error("Invalid config format. 'forward' array not found.");
  }
  logger.info('Configuration loaded successfully', {
    rulesCount: config.forward.length,
    configPath,
    apiEnabled: config.api?.enabled !== false,
    loggingLevel: config.logging?.level || 'info'
  });
} catch (error) {
  logger.error('Configuration error', {
    error: error.message,
    configPath
  });
  process.exit(1);
}

// Initialize logger with config
if (config.logging) {
  if (config.logging.level) {
    logger.setLevel(config.logging.level);
  }
  if (config.logging.enableFile !== undefined) {
    logger.enableFile = config.logging.enableFile;
  }
  if (config.logging.enableConsole !== undefined) {
    logger.enableConsole = config.logging.enableConsole;
  }
  if (config.logging.logDir) {
    logger.logDir = config.logging.logDir;
  }
  if (config.logging.maxFileSize) {
    logger.maxFileSize = config.logging.maxFileSize;
  }
  if (config.logging.maxFiles) {
    logger.maxFiles = config.logging.maxFiles;
  }
  logger.ensureLogDirectory();
}

// Start performance monitoring
monitor.start();
logger.info('Performance monitoring enabled', {
  reportInterval: '5 minutes'
});

// Start API server if enabled
if (config.api?.enabled !== false) {
  const apiConfig = config.api || {};
  apiServer = new APIServer({
    port: apiConfig.port || process.env.API_PORT || 8080,
    host: apiConfig.host || process.env.API_HOST || '127.0.0.1',
    enableCors: apiConfig.enableCors !== false
  });

  apiServer.setPerformanceMonitor(monitor);

  apiServer.start().then(() => {
    logger.info('API server started successfully', {
      port: apiServer.port,
      host: apiServer.host,
      enabled: true
    });
  }).catch((error) => {
    logger.error('Failed to start API server', { error: error.message });
  });
} else {
  logger.info('API server disabled in configuration');
  apiServer = null;
}

// Iterate through rules and start servers
logger.info('Starting proxy servers', {
  totalRules: config.forward.length
});

config.forward.forEach((rule, index) => {
    if (rule.status === "active") {
        const ruleIdentifier = rule.name ? `${rule.name} (ID: ${rule.id})` : `Rule ID: ${rule.id}`;
        logger.info('Initializing active rule', {
          ruleId: rule.id,
          ruleName: rule.name,
          type: rule.type,
          index
        });
        
        if (rule.type === "tcp") {
            const servers = startTCPServer(rule);
            servers.forEach((server, serverIndex) => {
                const proxyId = `tcp_${rule.id}_${serverIndex}`;
                monitor.registerProxy(proxyId, server);
                if (apiServer) {
                  apiServer.registerProxy(proxyId, server);
                }
            });
        } else if (rule.type === "udp") {
            const servers = startUDPServer(rule);
            servers.forEach((server, serverIndex) => {
                const proxyId = `udp_${rule.id}_${serverIndex}`;
                monitor.registerProxy(proxyId, server);
                if (apiServer) {
                  apiServer.registerProxy(proxyId, server);
                }
            });
        } else {
            logger.error('Invalid server type', {
              ruleId: rule.id,
              ruleName: rule.name,
              type: rule.type,
              validTypes: ['tcp', 'udp']
            });
        }
    } else if (rule.id) {
        logger.info('Skipping inactive rule', {
          ruleId: rule.id,
          ruleName: rule.name,
          status: rule.status
        });
    } else {
        logger.warn('Skipping invalid config entry', {
          entry: rule,
          reason: 'Missing ID or invalid format'
        });
    }
});

// Graceful shutdown handling
process.on('SIGINT', async () => {
    logger.info('Received SIGINT signal, initiating graceful shutdown');
    try {
      if (apiServer) {
        await apiServer.stop();
      }
      monitor.stop();
      logger.info('Graceful shutdown completed');
      process.exit(0);
    } catch (error) {
      logger.error('Error during shutdown', { error: error.message });
      process.exit(1);
    }
});

process.on('SIGTERM', async () => {
    logger.info('Received SIGTERM signal, initiating graceful shutdown');
    try {
      if (apiServer) {
        await apiServer.stop();
      }
      monitor.stop();
      logger.info('Graceful shutdown completed');
      process.exit(0);
    } catch (error) {
      logger.error('Error during shutdown', { error: error.message });
      process.exit(1);
    }
});
