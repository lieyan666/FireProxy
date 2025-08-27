/*
 * @Author: Lieyan
 * @Date: 2024-02-06 02:00:46
 * @LastEditors: Lieyan
 * @LastEditTime: 2025-04-06 14:12:34
 * @FilePath: /FireProxy/modules/tcpProxy.js
 * @Description:
 * @Contact: QQ: 2102177341  Website: lieyan.space  Github: @lieyan666
 * @Copyright: Copyright (c) 2024 by lieyanDevTeam, All Rights Reserved.
 */
const net = require("net");
const { EventEmitter } = require('events');
const { logger } = require('./logger');

class DynamicConnectionPool extends EventEmitter {
  constructor(targetHost, targetPort, options = {}) {
    super();
    this.targetHost = targetHost;
    this.targetPort = targetPort;
    
    // Dynamic pool configuration
    this.minPoolSize = options.minPoolSize || 5;
    this.maxPoolSize = options.maxPoolSize || 50;
    this.initialPoolSize = options.initialPoolSize || 10;
    this.scaleUpThreshold = options.scaleUpThreshold || 0.8; // Scale up when 80% busy
    this.scaleDownThreshold = options.scaleDownThreshold || 0.3; // Scale down when 30% busy
    this.scaleUpStep = options.scaleUpStep || 3;
    this.scaleDownStep = options.scaleDownStep || 1;
    
    this.pool = [];
    this.waitingQueue = [];
    this.stats = { 
      totalConnections: 0, 
      activeConnections: 0, 
      errors: 0, 
      reconnects: 0,
      poolScales: 0,
      waitingRequests: 0
    };
    
    // Performance optimizations
    this.highWaterMark = 128 * 1024; // 128KB buffer for high throughput
    this.connectTimeout = 3000; // Reduced to 3s for faster failover
    this.keepAliveInterval = 15000; // More aggressive keep-alive
    this.idleTimeout = 180000; // 3min idle timeout
    this.lastActivity = new Map();
    
    // Prewarming and scaling
    this.prewarmingInProgress = false;
    this.scalingLock = false;
    this.lastScaleTime = 0;
    this.scaleInterval = 5000; // Minimum 5s between scaling operations
    
    // Start monitoring and maintenance
    this.cleanupInterval = setInterval(() => this.cleanup(), 30000);
    this.monitoringInterval = setInterval(() => this.monitor(), 10000);
    
    // Preload initial connections
    this.prewarm();
  }

  // Prewarming: Create initial connections to avoid cold start
  async prewarm() {
    if (this.prewarmingInProgress) return;
    this.prewarmingInProgress = true;
    
    logger.info('TCP pool prewarming started', {
      targetHost: this.targetHost,
      targetPort: this.targetPort,
      initialPoolSize: this.initialPoolSize
    });
    
    const promises = [];
    for (let i = 0; i < this.initialPoolSize; i++) {
      promises.push(this.createConnection().catch(() => {})); // Ignore individual failures
    }
    
    await Promise.allSettled(promises);
    this.prewarmingInProgress = false;
    logger.info('TCP pool prewarming completed', {
      connectionCount: this.pool.length,
      targetHost: this.targetHost,
      targetPort: this.targetPort
    });
  }
  
  // Dynamic scaling based on load
  monitor() {
    const totalPoolSize = this.pool.length;
    const activeRatio = totalPoolSize > 0 ? this.stats.activeConnections / totalPoolSize : 0;
    const now = Date.now();
    
    if (this.scalingLock || (now - this.lastScaleTime) < this.scaleInterval) return;
    
    // Scale up: High load and not at max capacity
    if (activeRatio > this.scaleUpThreshold && totalPoolSize < this.maxPoolSize) {
      this.scaleUp();
    }
    // Scale down: Low load and above minimum
    else if (activeRatio < this.scaleDownThreshold && totalPoolSize > this.minPoolSize) {
      this.scaleDown();
    }
  }
  
  async scaleUp() {
    this.scalingLock = true;
    this.lastScaleTime = Date.now();
    
    const currentSize = this.pool.length;
    const targetIncrease = Math.min(this.scaleUpStep, this.maxPoolSize - currentSize);
    
    logger.debug('TCP pool scaling up', {
      currentSize,
      targetIncrease,
      maxPoolSize: this.maxPoolSize
    });
    
    const promises = [];
    for (let i = 0; i < targetIncrease; i++) {
      promises.push(this.createConnection().catch(() => {}));
    }
    
    await Promise.allSettled(promises);
    this.stats.poolScales++;
    this.scalingLock = false;
  }
  
  async scaleDown() {
    this.scalingLock = true;
    this.lastScaleTime = Date.now();
    
    const currentSize = this.pool.length;
    const targetDecrease = Math.min(this.scaleDownStep, currentSize - this.minPoolSize);
    
    logger.debug('TCP pool scaling down', {
      currentSize,
      targetDecrease,
      minPoolSize: this.minPoolSize
    });
    
    // Remove idle connections first
    let removed = 0;
    for (let i = this.pool.length - 1; i >= 0 && removed < targetDecrease; i--) {
      const conn = this.pool[i];
      if (conn.idle) {
        conn.socket.destroy();
        this.pool.splice(i, 1);
        this.lastActivity.delete(conn.socket);
        removed++;
      }
    }
    
    this.scalingLock = false;
  }
  
  // Optimized connection creation with advanced TCP options
  createConnection() {
    return new Promise((resolve, reject) => {
      const socket = net.createConnection({
        port: this.targetPort,
        host: this.targetHost,
        timeout: this.connectTimeout,
        highWaterMark: this.highWaterMark,
        allowHalfOpen: false,
        readable: true,
        writable: true
      });

      // Advanced TCP optimizations
      socket.on('connect', () => {
        // TCP_NODELAY for low latency
        socket.setNoDelay(true);
        
        // Aggressive keep-alive for connection persistence
        socket.setKeepAlive(true, this.keepAliveInterval);
        
        // Disable socket timeout once connected
        socket.setTimeout(0);
        
        // TCP socket buffer optimizations
        try {
          socket.setReceiveBufferSize && socket.setReceiveBufferSize(this.highWaterMark);
          socket.setSendBufferSize && socket.setSendBufferSize(this.highWaterMark);
        } catch (e) {
          // Ignore if not supported
        }
        
        const conn = { 
          socket, 
          idle: true, 
          created: Date.now(),
          totalBytes: 0,
          errors: 0
        };
        
        this.pool.push(conn);
        this.stats.totalConnections++;
        this.lastActivity.set(socket, Date.now());
        
        socket.on('close', () => {
          this.removeConnection(socket);
          this.emit('connectionClosed');
        });
        
        socket.on('error', (err) => {
          conn.errors++;
          this.stats.errors++;
          this.removeConnection(socket);
          this.emit('connectionError', err);
        });

        resolve(socket);
      });

      socket.on('error', (err) => {
        this.stats.errors++;
        reject(err);
      });
    });
  }
  
  removeConnection(socket) {
    const index = this.pool.findIndex(c => c.socket === socket);
    if (index !== -1) {
      this.pool.splice(index, 1);
      if (this.stats.activeConnections > 0) {
        this.stats.activeConnections--;
      }
    }
    this.lastActivity.delete(socket);
    
    // Process waiting queue if any
    if (this.waitingQueue.length > 0) {
      const { resolve } = this.waitingQueue.shift();
      this.stats.waitingRequests--;
      setImmediate(() => this.getConnection().then(resolve));
    }
  }

  // Optimized getConnection with load balancing
  async getConnection() {
    // Try to get the best idle connection (least used, most recent)
    let bestConn = null;
    let bestScore = -1;
    
    for (const conn of this.pool) {
      if (conn.idle) {
        // Score based on errors (fewer is better) and age (newer is better)
        const score = (1000 - conn.errors) + (Date.now() - conn.created) / 1000;
        if (score > bestScore) {
          bestScore = score;
          bestConn = conn;
        }
      }
    }
    
    if (bestConn) {
      bestConn.idle = false;
      this.stats.activeConnections++;
      this.lastActivity.set(bestConn.socket, Date.now());
      return bestConn.socket;
    }

    // Try to create new connection if under max capacity
    if (this.pool.length < this.maxPoolSize && !this.scalingLock) {
      try {
        return await this.createConnection();
      } catch (err) {
        // Fall through to waiting queue
      }
    }

    // Queue the request if pool is at capacity
    return new Promise((resolve) => {
      this.waitingQueue.push({ resolve, timestamp: Date.now() });
      this.stats.waitingRequests++;
      
      // Timeout for waiting requests
      setTimeout(() => {
        const queueIndex = this.waitingQueue.findIndex(q => q.resolve === resolve);
        if (queueIndex !== -1) {
          this.waitingQueue.splice(queueIndex, 1);
          this.stats.waitingRequests--;
          resolve(null); // Return null to indicate timeout
        }
      }, 5000);
    });
  }

  releaseConnection(socket) {
    const conn = this.pool.find(c => c.socket === socket);
    if (conn) {
      conn.idle = true;
      this.stats.activeConnections--;
      this.lastActivity.set(socket, Date.now());
      
      // Process waiting queue immediately
      if (this.waitingQueue.length > 0) {
        const { resolve } = this.waitingQueue.shift();
        this.stats.waitingRequests--;
        conn.idle = false;
        this.stats.activeConnections++;
        setImmediate(() => resolve(socket));
      }
    }
  }
  
  // Enhanced cleanup with performance tracking
  cleanup() {
    const now = Date.now();
    let cleaned = 0;
    
    // Remove stale connections
    for (let i = this.pool.length - 1; i >= 0; i--) {
      const conn = this.pool[i];
      const lastActivity = this.lastActivity.get(conn.socket) || conn.created;
      
      if (conn.idle && (now - lastActivity > this.idleTimeout)) {
        conn.socket.destroy();
        this.pool.splice(i, 1);
        this.lastActivity.delete(conn.socket);
        cleaned++;
      }
    }
    
    // Clean up stale waiting requests
    const expiredRequests = this.waitingQueue.filter(q => now - q.timestamp > 10000);
    this.waitingQueue = this.waitingQueue.filter(q => now - q.timestamp <= 10000);
    this.stats.waitingRequests = this.waitingQueue.length;
    
    if (cleaned > 0 || expiredRequests.length > 0) {
      logger.debug('TCP pool cleanup completed', {
        cleanedConnections: cleaned,
        expiredRequests: expiredRequests.length
      });
    }
  }
  
  destroy() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
    }
    
    // Clear waiting queue
    for (const waiting of this.waitingQueue) {
      waiting.resolve(null);
    }
    this.waitingQueue = [];
    
    for (const conn of this.pool) {
      conn.socket.destroy();
      this.lastActivity.delete(conn.socket);
    }
    this.pool = [];
  }
  
  getStats() {
    return {
      ...this.stats,
      poolSize: this.pool.length,
      idleConnections: this.pool.filter(c => c.idle).length,
      maxPoolSize: this.maxPoolSize,
      minPoolSize: this.minPoolSize,
      waitingQueueSize: this.waitingQueue.length
    };
  }
}

// Zero-copy data transfer optimization class
class ZeroCopyProxy {
  static setupPipe(localSocket, targetSocket, onError) {
    // Use Node.js streams for zero-copy data transfer
    const localToTarget = localSocket.pipe(targetSocket, { end: false });
    const targetToLocal = targetSocket.pipe(localSocket, { end: false });
    
    // Enhanced error handling
    const cleanup = () => {
      try {
        localSocket.unpipe(targetSocket);
        targetSocket.unpipe(localSocket);
      } catch (e) {
        // Ignore cleanup errors
      }
    };
    
    localToTarget.on('error', (err) => {
      cleanup();
      onError('local-to-target', err);
    });
    
    targetToLocal.on('error', (err) => {
      cleanup();
      onError('target-to-local', err);
    });
    
    // Handle connection termination
    localSocket.on('close', () => {
      cleanup();
      if (!targetSocket.destroyed) {
        targetSocket.end();
      }
    });
    
    targetSocket.on('close', () => {
      cleanup();
      if (!localSocket.destroyed) {
        localSocket.end();
      }
    });
    
    return { localToTarget, targetToLocal, cleanup };
  }
}

// Updated function to accept the whole rule object
function startTCPServer(rule) {
  const { localHost, targetHost, name } = rule;
  const ruleIdentifier = name ? `${name} (ID: ${rule.id})` : `Rule ID: ${rule.id}`;

  // --- Port Range Logic ---
  if (rule.localPortRange && rule.targetPortRange) {
    const [localStart, localEnd] = rule.localPortRange;
    const [targetStart, targetEnd] = rule.targetPortRange;

    // Basic validation
    if (!Array.isArray(rule.localPortRange) || rule.localPortRange.length !== 2 ||
        !Array.isArray(rule.targetPortRange) || rule.targetPortRange.length !== 2 ||
        localStart > localEnd || targetStart > targetEnd ||
        (localEnd - localStart) !== (targetEnd - targetStart)) {
      logger.error('TCP invalid port range configuration', {
        ruleId: rule.id,
        localPortRange: rule.localPortRange,
        targetPortRange: rule.targetPortRange
      });
      return []; // Return empty array indicating failure for this rule
    }

    const servers = [];
    const pools = {}; // Map to hold connection pools, keyed by targetPort

    logger.info('TCP port range setup started', {
      ruleId: rule.id,
      localRange: [localStart, localEnd],
      targetRange: [targetStart, targetEnd]
    });

    for (let i = 0; i <= localEnd - localStart; i++) {
      const currentLocalPort = localStart + i;
      const currentTargetPort = targetStart + i;

      // Create a pool for the specific target port if it doesn't exist
      if (!pools[currentTargetPort]) {
        pools[currentTargetPort] = new DynamicConnectionPool(targetHost, currentTargetPort, {
          minPoolSize: 3,
          maxPoolSize: 30,
          initialPoolSize: 8,
          scaleUpThreshold: 0.75,
          scaleDownThreshold: 0.25
        });
        logger.info('TCP dynamic connection pool initialized', {
          targetHost,
          targetPort: currentTargetPort,
          ruleId: rule.id,
          minPoolSize: 3,
          maxPoolSize: 30
        });
      }
      const pool = pools[currentTargetPort];

      const tcpServer = net.createServer({
        highWaterMark: 128 * 1024,
        allowHalfOpen: false
      }, async (tcpLocalSocket) => {
        try {
          tcpLocalSocket.setKeepAlive(true, 15000);
          tcpLocalSocket.setNoDelay(true);
          tcpLocalSocket.setTimeout(0);
          
          const tcpTargetSocket = await pool.getConnection();
          if (!tcpTargetSocket) {
            logger.warn('TCP failed to get connection from pool', {
              ruleId: rule.id,
              localPort: currentLocalPort
            });
            tcpLocalSocket.destroy();
            return;
          }

          logger.proxyConnection('tcp', rule.id, {
            address: tcpLocalSocket.remoteAddress,
            port: tcpLocalSocket.remotePort
          }, {
            address: targetHost,
            port: currentTargetPort
          }, {
            localPort: currentLocalPort,
            poolActive: pool.stats.activeConnections,
            poolTotal: pool.pool.length
          });

          // Use zero-copy proxy for maximum performance
          const { cleanup } = ZeroCopyProxy.setupPipe(tcpLocalSocket, tcpTargetSocket, (direction, error) => {
            logger.proxyError('tcp', rule.id, error, {
              direction,
              localPort: currentLocalPort
            });
            pool.releaseConnection(tcpTargetSocket);
            tcpTargetSocket.destroy();
            tcpLocalSocket.destroy();
          });

          tcpLocalSocket.on('close', () => {
            pool.releaseConnection(tcpTargetSocket);
            logger.proxyDisconnection('tcp', rule.id, {
              address: tcpLocalSocket.remoteAddress,
              port: tcpLocalSocket.remotePort
            }, 'normal');
          });

          tcpTargetSocket.on('close', () => {
            cleanup();
            tcpLocalSocket.destroy();
          });

          tcpLocalSocket.on('error', (error) => {
            logger.proxyError('tcp', rule.id, error, {
            type: 'local_socket',
            clientAddress: tcpLocalSocket.remoteAddress,
            clientPort: tcpLocalSocket.remotePort,
            localPort: currentLocalPort
          });
            cleanup();
            pool.releaseConnection(tcpTargetSocket);
            tcpTargetSocket.destroy();
          });

          tcpTargetSocket.on('error', (error) => {
            logger.proxyError('tcp', rule.id, error, {
            type: 'target_socket',
            targetHost,
            targetPort: currentTargetPort
          });
            cleanup();
            pool.releaseConnection(tcpTargetSocket);
            tcpLocalSocket.destroy();
          });
        } catch (err) {
          logger.error('TCP failed to establish connection', {
          ruleId: rule.id,
          localHost,
          localPort: currentLocalPort,
          targetHost,
          targetPort: currentTargetPort,
          error: err.message
        });
          tcpLocalSocket.destroy();
        }
      });

      tcpServer.listen(currentLocalPort, localHost, () => {
        logger.info('TCP proxy server started', {
          ruleId: rule.id,
          localHost,
          localPort: currentLocalPort,
          targetHost,
          targetPort: currentTargetPort,
          type: 'port_range'
        });
      });

      tcpServer.on('error', (error) => {
        logger.error('TCP server error', {
          ruleId: rule.id,
          localHost,
          localPort: currentLocalPort,
          error: error.message
        });
      });

      servers.push(tcpServer);
    }
    return servers; // Return array of created server instances

  // --- Single Port Logic (Legacy/Default) ---
  } else if (rule.localPort && rule.targetPort) {
    const { localPort, targetPort } = rule;
    const pool = new DynamicConnectionPool(targetHost, targetPort);
    // const bufferSize = 64 * 1024; // Buffer size not explicitly used anymore

    const tcpServer = net.createServer({
      highWaterMark: 128 * 1024,
      allowHalfOpen: false
    }, async (tcpLocalSocket) => {
      try {
        tcpLocalSocket.setKeepAlive(true, 15000);
        tcpLocalSocket.setNoDelay(true);
        tcpLocalSocket.setTimeout(0);
        
        const tcpTargetSocket = await pool.getConnection();
        if (!tcpTargetSocket) {
          logger.warn('TCP failed to get connection from pool', {
            ruleId: rule.id,
            localPort
          });
          tcpLocalSocket.destroy();
          return;
        }

        logger.proxyConnection('tcp', rule.id, {
          address: tcpLocalSocket.remoteAddress,
          port: tcpLocalSocket.remotePort
        }, {
          address: targetHost,
          port: targetPort
        }, {
          localPort,
          poolActive: pool.stats.activeConnections,
          poolTotal: pool.pool.length
        });

        // Use zero-copy proxy for maximum performance
        const { cleanup } = ZeroCopyProxy.setupPipe(tcpLocalSocket, tcpTargetSocket, (direction, error) => {
          console.error(`[TCP] [${ruleIdentifier}] Pipe error (${direction}) on ${localPort}: ${error.message}`);
          pool.releaseConnection(tcpTargetSocket);
          tcpTargetSocket.destroy();
          tcpLocalSocket.destroy();
        });

        tcpLocalSocket.on('close', () => {
          pool.releaseConnection(tcpTargetSocket);
          console.log(
            `[TCP] [${ruleIdentifier}] Disconnecting socks from ${tcpLocalSocket.remoteAddress}:${tcpLocalSocket.remotePort} (Local: ${localPort})`
          );
        });

        tcpTargetSocket.on('close', () => {
          cleanup();
          tcpLocalSocket.destroy();
        });

        tcpLocalSocket.on('error', (error) => {
          console.error(`[TCP] [${ruleIdentifier}] Local socket error (${tcpLocalSocket.remoteAddress}:${tcpLocalSocket.remotePort} on ${localPort}): ${error.message}`);
          cleanup();
          pool.releaseConnection(tcpTargetSocket);
          tcpTargetSocket.destroy();
        });

        tcpTargetSocket.on('error', (error) => {
          console.error(`[TCP] [${ruleIdentifier}] Target socket error (${targetHost}:${targetPort}): ${error.message}`);
          cleanup();
          pool.releaseConnection(tcpTargetSocket);
          tcpLocalSocket.destroy();
        });
      } catch (err) {
        console.error(`[TCP] [${ruleIdentifier}] Failed to establish connection for ${localHost}:${localPort} -> ${targetHost}:${targetPort}: ${err.message}`);
        tcpLocalSocket.destroy();
      }
    });

    tcpServer.listen(localPort, localHost, () => {
      logger.info('TCP proxy server started', {
        ruleId: rule.id,
        localHost,
        localPort,
        targetHost,
        targetPort,
        type: 'single_port',
        poolConfig: {
          min: pool.minPoolSize,
          max: pool.maxPoolSize
        }
      });
    });

    tcpServer.on('error', (error) => {
      logger.error('TCP server error', {
        ruleId: rule.id,
        localHost,
        localPort,
        error: error.message
      });
    });

    return [tcpServer]; // Return array containing the single server instance for consistency
  } else {
    logger.error('TCP invalid configuration', {
      ruleId: rule.id,
      reason: 'Missing localPort/targetPort or localPortRange/targetPortRange'
    });
    return []; // Return empty array for invalid config
  }
}

module.exports = { startTCPServer };
