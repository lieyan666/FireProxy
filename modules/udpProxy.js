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
          console.log(`[UDP] [${this.ruleIdentifier}] Listening => (${address.family}) ${address.address}:${address.port} -> ${this.targetHost}:${this.targetPort}`);
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
        console.error(`[UDP] [${this.ruleIdentifier}] Error forwarding message to target: ${error.message}`);
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
          console.error(`[UDP] [${this.ruleIdentifier}] Error sending response to client: ${error.message}`);
          this.stats.errors++;
        }
      });
    });

    targetSocket.on('error', (error) => {
      console.error(`[UDP] [${this.ruleIdentifier}] Client socket error: ${error.message}`);
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
      console.log(`[UDP] [${this.ruleIdentifier}] Disconnecting socket from ${clientInfo.address}:${clientInfo.port}`);
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
    console.error(`[UDP] [${this.ruleIdentifier}] Server error: ${error.message}`);
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
      console.error(`[UDP] Invalid port range configuration for ${ruleIdentifier}. Check ranges.`);
      return [];
    }

    const servers = [];
    console.log(`[UDP] Setting up port range for ${ruleIdentifier}: Local ${localStart}-${localEnd} -> Target ${targetStart}-${targetEnd}`);

    for (let i = 0; i <= localEnd - localStart; i++) {
      const currentLocalPort = localStart + i;
      const currentTargetPort = targetStart + i;

      try {
        const proxy = new UDPProxy(localHost, currentLocalPort, targetHost, currentTargetPort, ruleIdentifier);
        proxy.start().then(() => {
          console.log(`[UDP] [${ruleIdentifier}] Successfully started proxy for ${localHost}:${currentLocalPort} -> ${targetHost}:${currentTargetPort}`);
        }).catch(error => {
          console.error(`[UDP] [${ruleIdentifier}] Failed to start proxy for ${localHost}:${currentLocalPort}: ${error.message}`);
        });
        servers.push(proxy);
      } catch (err) {
        console.error(`[UDP] [${ruleIdentifier}] Failed to create proxy for ${localHost}:${currentLocalPort} -> ${targetHost}:${currentTargetPort}: ${err.message}`);
      }
    }
    return servers;

  // --- Single Port Logic ---
  } else if (rule.localPort && rule.targetPort) {
    const { localPort, targetPort } = rule;

    try {
      const proxy = new UDPProxy(localHost, localPort, targetHost, targetPort, ruleIdentifier);
      proxy.start().then(() => {
        console.log(`[UDP] [${ruleIdentifier}] Successfully started proxy`);
      }).catch(error => {
        console.error(`[UDP] [${ruleIdentifier}] Failed to start proxy: ${error.message}`);
      });
      return [proxy];
    } catch (err) {
      console.error(`[UDP] [${ruleIdentifier}] Failed to create proxy for ${localHost}:${localPort} -> ${targetHost}:${targetPort}: ${err.message}`);
      return [];
    }
  } else {
    console.error(`[UDP] Invalid configuration for ${ruleIdentifier}. Missing localPort/targetPort or localPortRange/targetPortRange.`);
    return [];
  }
}

module.exports = { startUDPServer };
