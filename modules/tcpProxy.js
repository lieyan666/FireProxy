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

class ConnectionPool extends EventEmitter {
  constructor(targetHost, targetPort, poolSize = 20) {
    super();
    this.pool = [];
    this.targetHost = targetHost;
    this.targetPort = targetPort;
    this.poolSize = poolSize;
    this.stats = { totalConnections: 0, activeConnections: 0, errors: 0, reconnects: 0 };
    this.highWaterMark = 64 * 1024; // 64KB buffer
    this.connectTimeout = 5000; // 5s connection timeout
    this.keepAliveInterval = 30000; // 30s keep-alive
    this.idleTimeout = 300000; // 5min idle timeout
    this.lastActivity = new Map();
    
    // Start idle connection cleanup
    this.cleanupInterval = setInterval(() => this.cleanupIdleConnections(), 60000);
  }

  cleanupIdleConnections() {
    const now = Date.now();
    const toRemove = [];
    
    for (let i = 0; i < this.pool.length; i++) {
      const conn = this.pool[i];
      const lastActivity = this.lastActivity.get(conn.socket) || now;
      
      if (conn.idle && now - lastActivity > this.idleTimeout) {
        toRemove.push(i);
        conn.socket.destroy();
        this.lastActivity.delete(conn.socket);
      }
    }
    
    // Remove from pool in reverse order to maintain indices
    for (let i = toRemove.length - 1; i >= 0; i--) {
      this.pool.splice(toRemove[i], 1);
    }
  }

  async getConnection() {
    // Try to get an idle connection
    for (const conn of this.pool) {
      if (conn.idle) {
        conn.idle = false;
        this.stats.activeConnections++;
        this.lastActivity.set(conn.socket, Date.now());
        return conn.socket;
      }
    }

    // Create new connection if pool not full
    if (this.pool.length < this.poolSize) {
      return new Promise((resolve, reject) => {
        const socket = net.createConnection({
          port: this.targetPort,
          host: this.targetHost,
          timeout: this.connectTimeout,
          highWaterMark: this.highWaterMark
        });

        const timeoutHandler = setTimeout(() => {
          socket.destroy();
          this.stats.errors++;
          reject(new Error(`Connection timeout to ${this.targetHost}:${this.targetPort}`));
        }, this.connectTimeout);

        socket.on('connect', () => {
          clearTimeout(timeoutHandler);
          socket.setKeepAlive(true, this.keepAliveInterval);
          socket.setNoDelay(true);
          socket.setTimeout(0);
          
          const conn = { socket, idle: false };
          this.pool.push(conn);
          this.stats.totalConnections++;
          this.stats.activeConnections++;
          this.lastActivity.set(socket, Date.now());
          
          socket.on('close', () => {
            this.pool = this.pool.filter(c => c.socket !== socket);
            this.stats.activeConnections--;
            this.lastActivity.delete(socket);
            this.emit('connectionClosed');
          });
          
          socket.on('error', (err) => {
            clearTimeout(timeoutHandler);
            this.pool = this.pool.filter(c => c.socket !== socket);
            this.stats.activeConnections--;
            this.stats.errors++;
            this.lastActivity.delete(socket);
            this.emit('connectionError', err);
          });

          resolve(socket);
        });

        socket.on('error', (err) => {
          clearTimeout(timeoutHandler);
          this.stats.errors++;
          reject(err);
        });
      });
    }

    // Wait for next available connection if pool is full
    return new Promise(resolve => {
      const onAvailable = () => {
        this.getConnection().then(resolve).catch(() => {
          // Retry on error
          setTimeout(() => this.getConnection().then(resolve), 100);
        });
      };
      
      this.once('connectionClosed', onAvailable);
      this.once('connectionError', onAvailable);
    });
  }

  releaseConnection(socket) {
    const conn = this.pool.find(c => c.socket === socket);
    if (conn) {
      conn.idle = true;
      this.stats.activeConnections--;
      this.lastActivity.set(socket, Date.now());
    }
  }
  
  destroy() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
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
      idleConnections: this.pool.filter(c => c.idle).length
    };
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
      console.error(`[TCP] Invalid port range configuration for ${ruleIdentifier}. Check ranges.`);
      return []; // Return empty array indicating failure for this rule
    }

    const servers = [];
    const pools = {}; // Map to hold connection pools, keyed by targetPort

    console.log(`[TCP] Setting up port range for ${ruleIdentifier}: Local ${localStart}-${localEnd} -> Target ${targetStart}-${targetEnd}`);

    for (let i = 0; i <= localEnd - localStart; i++) {
      const currentLocalPort = localStart + i;
      const currentTargetPort = targetStart + i;

      // Create a pool for the specific target port if it doesn't exist
      if (!pools[currentTargetPort]) {
        pools[currentTargetPort] = new ConnectionPool(targetHost, currentTargetPort);
        console.log(`[TCP] Initialized connection pool for ${targetHost}:${currentTargetPort} (Rule: ${ruleIdentifier})`);
      }
      const pool = pools[currentTargetPort];

      const tcpServer = net.createServer({
        highWaterMark: 64 * 1024,
        allowHalfOpen: false
      }, async (tcpLocalSocket) => {
        try {
          tcpLocalSocket.setKeepAlive(true, 30000);
          tcpLocalSocket.setNoDelay(true);
          tcpLocalSocket.setTimeout(0);
          
          const tcpTargetSocket = await pool.getConnection();

          tcpLocalSocket.on('close', () => {
            pool.releaseConnection(tcpTargetSocket);
            console.log(
              `[TCP] [${ruleIdentifier}] Disconnecting socks from ${tcpLocalSocket.remoteAddress}:${tcpLocalSocket.remotePort} (Local: ${currentLocalPort})`
            );
          });

          tcpTargetSocket.on('close', () => {
            tcpLocalSocket.destroy();
          });

          tcpLocalSocket.on('error', (error) => {
            console.error(`[TCP] [${ruleIdentifier}] Local socket error (${tcpLocalSocket.remoteAddress}:${tcpLocalSocket.remotePort} on ${currentLocalPort}): ${error.message}`);
            pool.releaseConnection(tcpTargetSocket);
            tcpTargetSocket.destroy();
          });

          tcpTargetSocket.on('error', (error) => {
            console.error(`[TCP] [${ruleIdentifier}] Target socket error (${targetHost}:${currentTargetPort}): ${error.message}`);
            pool.releaseConnection(tcpTargetSocket);
            tcpLocalSocket.destroy();
          });

          console.log(
            `[TCP] [${ruleIdentifier}] Proxying ${tcpLocalSocket.remoteAddress}:${tcpLocalSocket.remotePort} via ${localHost}:${currentLocalPort} <=> ${targetHost}:${currentTargetPort} ` +
            `(Pool: ${pool.stats.activeConnections}/${pool.stats.totalConnections})`
          );

          const localToPipe = tcpLocalSocket.pipe(tcpTargetSocket, { end: false });
          const targetToPipe = tcpTargetSocket.pipe(tcpLocalSocket, { end: false });
          
          localToPipe.on('error', () => {
            pool.releaseConnection(tcpTargetSocket);
            tcpTargetSocket.destroy();
          });
          
          targetToPipe.on('error', () => {
            tcpLocalSocket.destroy();
          });
        } catch (err) {
          console.error(`[TCP] [${ruleIdentifier}] Failed to establish connection for ${localHost}:${currentLocalPort} -> ${targetHost}:${currentTargetPort}: ${err.message}`);
          tcpLocalSocket.destroy();
        }
      });

      tcpServer.listen(currentLocalPort, localHost, () => {
        console.log(`[TCP] [${ruleIdentifier}] Listening => ${localHost}:${currentLocalPort} -> ${targetHost}:${currentTargetPort}`);
        // console.log(`[TCP] Connection pool size for ${currentTargetPort}: ${pool.poolSize}`); // Log pool size if needed
      });

      tcpServer.on('error', (error) => {
        console.error(`[TCP] [${ruleIdentifier}] Server error on ${localHost}:${currentLocalPort}: ${error.message}`);
      });

      servers.push(tcpServer);
    }
    return servers; // Return array of created server instances

  // --- Single Port Logic (Legacy/Default) ---
  } else if (rule.localPort && rule.targetPort) {
    const { localPort, targetPort } = rule;
    const pool = new ConnectionPool(targetHost, targetPort);
    // const bufferSize = 64 * 1024; // Buffer size not explicitly used anymore

    const tcpServer = net.createServer({
      highWaterMark: 64 * 1024,
      allowHalfOpen: false
    }, async (tcpLocalSocket) => {
      try {
        tcpLocalSocket.setKeepAlive(true, 30000);
        tcpLocalSocket.setNoDelay(true);
        tcpLocalSocket.setTimeout(0);
        
        const tcpTargetSocket = await pool.getConnection();

        tcpLocalSocket.on('close', () => {
          pool.releaseConnection(tcpTargetSocket);
          console.log(
            `[TCP] [${ruleIdentifier}] Disconnecting socks from ${tcpLocalSocket.remoteAddress}:${tcpLocalSocket.remotePort} (Local: ${localPort})`
          );
        });

        tcpTargetSocket.on('close', () => {
          tcpLocalSocket.destroy();
        });

        tcpLocalSocket.on('error', (error) => {
          console.error(`[TCP] [${ruleIdentifier}] Local socket error (${tcpLocalSocket.remoteAddress}:${tcpLocalSocket.remotePort} on ${localPort}): ${error.message}`);
          pool.releaseConnection(tcpTargetSocket);
          tcpTargetSocket.destroy();
        });

        tcpTargetSocket.on('error', (error) => {
          console.error(`[TCP] [${ruleIdentifier}] Target socket error (${targetHost}:${targetPort}): ${error.message}`);
          pool.releaseConnection(tcpTargetSocket);
          tcpLocalSocket.destroy();
        });

        console.log(
          `[TCP] [${ruleIdentifier}] Proxying ${tcpLocalSocket.remoteAddress}:${tcpLocalSocket.remotePort} via ${localHost}:${localPort} <=> ${targetHost}:${targetPort} ` +
          `(Pool: ${pool.stats.activeConnections}/${pool.stats.totalConnections})`
        );

        const localToPipe = tcpLocalSocket.pipe(tcpTargetSocket, { end: false });
        const targetToPipe = tcpTargetSocket.pipe(tcpLocalSocket, { end: false });
        
        localToPipe.on('error', () => {
          pool.releaseConnection(tcpTargetSocket);
          tcpTargetSocket.destroy();
        });
        
        targetToPipe.on('error', () => {
          tcpLocalSocket.destroy();
        });
      } catch (err) {
        console.error(`[TCP] [${ruleIdentifier}] Failed to establish connection for ${localHost}:${localPort} -> ${targetHost}:${targetPort}: ${err.message}`);
        tcpLocalSocket.destroy();
      }
    });

    tcpServer.listen(localPort, localHost, () => {
      console.log(`[TCP] [${ruleIdentifier}] Listening => ${localHost}:${localPort} -> ${targetHost}:${targetPort}`);
      console.log(`[TCP] [${ruleIdentifier}] Connection pool size: ${pool.poolSize}`);
    });

    tcpServer.on('error', (error) => {
      console.error(`[TCP] [${ruleIdentifier}] Server error on ${localHost}:${localPort}: ${error.message}`);
    });

    return [tcpServer]; // Return array containing the single server instance for consistency
  } else {
    console.error(`[TCP] Invalid configuration for ${ruleIdentifier}. Missing localPort/targetPort or localPortRange/targetPortRange.`);
    return []; // Return empty array for invalid config
  }
}

module.exports = { startTCPServer };
