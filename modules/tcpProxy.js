/*
 * @Author: Lieyan
 * @Date: 2024-02-06 02:00:46
 * @LastEditors: Lieyan
 * @LastEditTime: 2025-04-06 14:03:16
 * @FilePath: /FireProxy/modules/tcpProxy.js
 * @Description:
 * @Contact: QQ: 2102177341  Website: lieyan.space  Github: @lieyan666
 * @Copyright: Copyright (c) 2024 by lieyanDevTeam, All Rights Reserved.
 */
const net = require("net");
const { EventEmitter } = require('events');

class ConnectionPool extends EventEmitter {
  constructor(targetHost, targetPort, poolSize = 10) {
    super();
    this.pool = [];
    this.targetHost = targetHost;
    this.targetPort = targetPort;
    this.poolSize = poolSize;
    this.stats = { totalConnections: 0, activeConnections: 0 };
  }

  async getConnection() {
    // Try to get an idle connection
    for (const conn of this.pool) {
      if (conn.idle) {
        conn.idle = false;
        this.stats.activeConnections++;
        return conn.socket;
      }
    }

    // Create new connection if pool not full
    if (this.pool.length < this.poolSize) {
      return new Promise((resolve, reject) => {
        const socket = net.createConnection(this.targetPort, this.targetHost, () => {
          socket.setKeepAlive(true, 60000);
          socket.setNoDelay(true);
          
          const conn = { socket, idle: false };
          this.pool.push(conn);
          this.stats.totalConnections++;
          this.stats.activeConnections++;
          
          socket.on('close', () => {
            this.pool = this.pool.filter(c => c.socket !== socket);
            this.stats.activeConnections--;
            this.emit('connectionClosed');
          });
          
          socket.on('error', (err) => {
            this.pool = this.pool.filter(c => c.socket !== socket);
            this.stats.activeConnections--;
            this.emit('connectionError', err);
          });

          resolve(socket);
        });

        socket.on('error', (err) => {
          console.error(`[TCP Pool] Error creating connection to ${this.targetHost}:${this.targetPort}: ${err.message}`);
          // No need to filter pool here as it wasn't added yet on error during creation
          reject(err); // Reject the promise on connection error
        });
      });
    }

    // Wait for next available connection if pool is full
    return new Promise(resolve => {
      this.once('connectionClosed', () => resolve(this.getConnection()));
      this.once('connectionError', () => resolve(this.getConnection()));
    });
  }

  releaseConnection(socket) {
    const conn = this.pool.find(c => c.socket === socket);
    if (conn) {
      conn.idle = true;
      this.stats.activeConnections--;
    }
  }
}

function startTCPServer(localHost, localPort, targetHost, targetPort) {
  const pool = new ConnectionPool(targetHost, targetPort);
  const bufferSize = 64 * 1024; // 64KB buffer

  const tcpServer = net.createServer(async (tcpLocalSocket) => {
    try {
      const tcpTargetSocket = await pool.getConnection();
      
      tcpLocalSocket.on('close', () => {
        pool.releaseConnection(tcpTargetSocket);
        console.log(
          `[TCP] Disconnecting socks from ${tcpLocalSocket.remoteAddress}:${tcpLocalSocket.remotePort}`
        );
      });

      tcpTargetSocket.on('close', () => {
        // Optional: Log target closure if needed, but often less critical than local closure
        // console.log(`[TCP] Target closed connection for ${tcpLocalSocket.remoteAddress}:${tcpLocalSocket.remotePort}`);
        tcpLocalSocket.destroy(); // Ensure local socket is closed if target closes
      });

      tcpLocalSocket.on('error', (error) => {
        console.error(`[TCP] Local socket error (${tcpLocalSocket.remoteAddress}:${tcpLocalSocket.remotePort}): ${error.message}`);
        pool.releaseConnection(tcpTargetSocket); // Release target connection
        tcpTargetSocket.destroy(); // Destroy target socket
      });

      tcpTargetSocket.on('error', (error) => {
        console.error(`[TCP] Target socket error (${targetHost}:${targetPort}): ${error.message}`);
        pool.releaseConnection(tcpTargetSocket); // Ensure connection is marked for removal/release
        tcpLocalSocket.destroy(); // Destroy local socket
      });

      // Rely on default Node.js buffer handling - removed explicit set*HighWaterMark

      console.log(
        `[TCP] Proxying ${tcpLocalSocket.remoteAddress}:${tcpLocalSocket.remotePort} <=> ${targetHost}:${targetPort} ` +
        `(Pool: ${pool.stats.activeConnections}/${pool.stats.totalConnections})`
      );

      tcpLocalSocket.pipe(tcpTargetSocket);
      tcpTargetSocket.pipe(tcpLocalSocket);
    } catch (err) {
      console.error(`[TCP] Failed to establish connection: ${err.message}`);
      tcpLocalSocket.destroy();
    }
  });
  tcpServer.listen(localPort, localHost, () => {
    console.log(`[TCP] Listening => ${localHost}:${localPort}`);
    console.log(`[TCP] Connection pool size: ${pool.poolSize}`);
  });

  tcpServer.on('error', (error) => {
    console.error(`[TCP] Server error: ${error.message}`);
  });

  // Removed periodic pool stats logging interval
}

module.exports = { startTCPServer };
