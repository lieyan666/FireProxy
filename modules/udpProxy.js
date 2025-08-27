/*
 * @Author: Lieyan
 * @Date: 2024-02-06 02:08:34
 * @LastEditors: Lieyan
 * @LastEditTime: 2025-04-13 14:04:15
 * @FilePath: /FireProxy/modules/udpProxy.js
 * @Description:
 * @Contact: QQ: 2102177341  Website: lieyan.space  Github: @lieyan666
 * @Copyright: Copyright (c) 2024 by lieyanDevTeam, All Rights Reserved.
 */
const dgram = require("dgram");
const net = require("net");
const { logger } = require('./logger');

class UDPProxy {
  constructor(localHost, localPort, targetHost, targetPort, ruleIdentifier) {
    this.localHost = localHost;
    this.localPort = localPort;
    this.targetHost = targetHost;
    this.targetPort = targetPort;
    this.ruleIdentifier = ruleIdentifier;
    this.clients = new Map();
    this.stats = { messagesForwarded: 0, clientConnections: 0, errors: 0 };
    this.clientTimeout = 300000; // 5 minutes
    this.bufferSize = 64 * 1024; // 64KB
    this.isIPv6 = net.isIPv6(targetHost);
    this.server = null;
  }

  start() {
    return new Promise((resolve, reject) => {
      try {
        this.server = dgram.createSocket({
          type: this.isIPv6 ? 'udp6' : 'udp4',
          reuseAddr: true,
          recvBufferSize: this.bufferSize,
          sendBufferSize: this.bufferSize
        });

        this.server.on('message', this.handleMessage.bind(this));
        this.server.on('error', this.handleServerError.bind(this));
        this.server.on('listening', () => {
          const address = this.server.address();
          logger.info('UDP proxy server started', {
            ruleId: this.ruleIdentifier,
            family: address.family,
            host: address.address,
            port: address.port,
            targetHost: this.targetHost,
            targetPort: this.targetPort
          });
          resolve();
        });

        this.server.bind(this.localPort, this.localHost);

        // Clean up stale client connections
        this.cleanupInterval = setInterval(() => {
          this.cleanupStaleClients();
        }, 60000);
      } catch (error) {
        reject(error);
      }
    });
  }

  handleMessage(message, clientInfo) {
    const clientKey = `${clientInfo.address}:${clientInfo.port}`;
    let client = this.clients.get(clientKey);

    if (!client) {
      client = this.createClient(clientInfo);
      this.clients.set(clientKey, client);
      this.stats.clientConnections++;
    }

    client.lastActivity = Date.now();
    client.targetSocket.send(message, this.targetPort, this.targetHost, (error) => {
      if (error) {
        logger.proxyError('udp', this.ruleIdentifier, error, {
          type: 'forward_message',
          targetHost: this.targetHost,
          targetPort: this.targetPort
        });
        this.stats.errors++;
      } else {
        this.stats.messagesForwarded++;
      }
    });
  }

  createClient(clientInfo) {
    const targetSocket = dgram.createSocket({
      type: this.isIPv6 ? 'udp6' : 'udp4',
      recvBufferSize: this.bufferSize,
      sendBufferSize: this.bufferSize
    });

    const client = {
      info: clientInfo,
      targetSocket,
      lastActivity: Date.now()
    };

    targetSocket.on('message', (message) => {
      this.server.send(message, clientInfo.port, clientInfo.address, (error) => {
        if (error) {
          logger.proxyError('udp', this.ruleIdentifier, error, {
            type: 'response_to_client',
            clientAddress: clientInfo.address,
            clientPort: clientInfo.port
          });
          this.stats.errors++;
        }
      });
    });

    targetSocket.on('error', (error) => {
      logger.proxyError('udp', this.ruleIdentifier, error, {
        type: 'client_socket',
        clientAddress: clientInfo.address,
        clientPort: clientInfo.port
      });
      this.stats.errors++;
      this.removeClient(clientInfo);
    });

    return client;
  }

  removeClient(clientInfo) {
    const clientKey = `${clientInfo.address}:${clientInfo.port}`;
    const client = this.clients.get(clientKey);
    if (client) {
      client.targetSocket.close();
      this.clients.delete(clientKey);
      logger.proxyDisconnection('udp', this.ruleIdentifier, {
        address: clientInfo.address,
        port: clientInfo.port
      }, 'cleanup');
    }
  }

  cleanupStaleClients() {
    const now = Date.now();
    for (const [clientKey, client] of this.clients.entries()) {
      if (now - client.lastActivity > this.clientTimeout) {
        this.removeClient(client.info);
      }
    }
  }

  handleServerError(error) {
    logger.proxyError('udp', this.ruleIdentifier, error, {
      type: 'server_error'
    });
    this.stats.errors++;
  }

  stop() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
    for (const client of this.clients.values()) {
      client.targetSocket.close();
    }
    this.clients.clear();
    if (this.server) {
      this.server.close();
    }
  }

  getStats() {
    return {
      ...this.stats,
      activeClients: this.clients.size
    };
  }
}

// Updated function to accept the whole rule object
function startUDPServer(rule) {
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
      logger.error('UDP invalid port range configuration', {
        ruleId: rule.id,
        localPortRange: rule.localPortRange,
        targetPortRange: rule.targetPortRange
      });
      return [];
    }

    const servers = [];
    logger.info('UDP port range setup started', {
      ruleId: rule.id,
      localRange: [localStart, localEnd],
      targetRange: [targetStart, targetEnd]
    });

    for (let i = 0; i <= localEnd - localStart; i++) {
      const currentLocalPort = localStart + i;
      const currentTargetPort = targetStart + i;

      try {
        const proxy = new UDPProxy(localHost, currentLocalPort, targetHost, currentTargetPort, ruleIdentifier);
        proxy.start().then(() => {
          logger.info('UDP proxy started successfully', {
            ruleId: rule.id,
            localHost,
            localPort: currentLocalPort,
            targetHost,
            targetPort: currentTargetPort
          });
        }).catch(error => {
          logger.error('UDP proxy start failed', {
            ruleId: rule.id,
            localHost,
            localPort: currentLocalPort,
            error: error.message
          });
        });
        servers.push(proxy);
      } catch (err) {
        logger.error('UDP proxy creation failed', {
          ruleId: rule.id,
          localHost,
          localPort: currentLocalPort,
          targetHost,
          targetPort: currentTargetPort,
          error: err.message
        });
      }
    }
    return servers;

  // --- Single Port Logic ---
  } else if (rule.localPort && rule.targetPort) {
    const { localPort, targetPort } = rule;

    try {
      const proxy = new UDPProxy(localHost, localPort, targetHost, targetPort, ruleIdentifier);
      proxy.start().then(() => {
        logger.info('UDP proxy started successfully', {
          ruleId: rule.id,
          localHost,
          localPort,
          targetHost,
          targetPort
        });
      }).catch(error => {
        logger.error('UDP proxy start failed', {
          ruleId: rule.id,
          localHost,
          localPort,
          error: error.message
        });
      });
      return [proxy];
    } catch (err) {
      logger.error('UDP proxy creation failed', {
        ruleId: rule.id,
        localHost,
        localPort,
        targetHost,
        targetPort,
        error: err.message
      });
      return [];
    }
  } else {
    logger.error('UDP invalid configuration', {
      ruleId: rule.id,
      reason: 'Missing localPort/targetPort or localPortRange/targetPortRange'
    });
    return [];
  }
}

module.exports = { startUDPServer };
