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
const proxy = require("udp-proxy");

// Updated function to accept the whole rule object
function startUDPServer(rule) {
  const { localHost, targetHost, name } = rule;
  const ruleIdentifier = name ? `${name} (ID: ${rule.id})` : `Rule ID: ${rule.id}`;
  // Determine IPv6 status based on host addresses (basic check)
  const isIPv6 = net.isIPv6(targetHost);
  const isLocalIPv6 = net.isIPv6(localHost);

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
      return []; // Return empty array indicating failure for this rule
    }

    const servers = [];
    console.log(`[UDP] Setting up port range for ${ruleIdentifier}: Local ${localStart}-${localEnd} -> Target ${targetStart}-${targetEnd}`);

    for (let i = 0; i <= localEnd - localStart; i++) {
      const currentLocalPort = localStart + i;
      const currentTargetPort = targetStart + i;

      const options = {
        address: targetHost,
        port: currentTargetPort,
        ipv6: isIPv6,
        localaddress: localHost,
        localport: currentLocalPort,
        localipv6: isLocalIPv6,
        timeOutTime: 10000,
      };

      try {
        const server = proxy.createServer(options);

        server.on("listening", function (details) {
          console.log(
            `[UDP] [${ruleIdentifier}] Listening => (${details.server.family}) ${details.server.address}:${details.server.port} -> (${details.target.family}) ${details.target.address}:${details.target.port}`
          );
        });

        server.on("bound", function (details) {
          // Optional: Log bound details if needed
          // console.log(`[UDP] [${ruleIdentifier}] Proxy bound: Route ${details.route.address}:${details.route.port}, Peer ${details.peer.address}:${details.peer.port}`);
        });

        server.on("proxyClose", function (peer) {
          console.log(`[UDP] [${ruleIdentifier}] Disconnecting socket from ${peer.address} on local port ${currentLocalPort}`);
        });

        server.on("proxyError", function (err) {
          console.error(`[UDP] [${ruleIdentifier}] ProxyError on ${localHost}:${currentLocalPort}: ${err}`);
        });

        server.on("error", function (err) {
          console.error(`[UDP] [${ruleIdentifier}] Server Error on ${localHost}:${currentLocalPort}: ${err}`);
        });

        servers.push(server);
      } catch (err) {
         console.error(`[UDP] [${ruleIdentifier}] Failed to create server for ${localHost}:${currentLocalPort} -> ${targetHost}:${currentTargetPort}: ${err}`);
      }
    }
    return servers; // Return array of created server instances

  // --- Single Port Logic (Legacy/Default) ---
  } else if (rule.localPort && rule.targetPort) {
    const { localPort, targetPort } = rule;

    const options = {
      address: targetHost,
      port: targetPort,
      ipv6: isIPv6,
      localaddress: localHost,
      localport: localPort,
      localipv6: isLocalIPv6,
      timeOutTime: 10000,
    };

    try {
      const server = proxy.createServer(options);

      server.on("listening", function (details) {
        console.log(`[UDP] [${ruleIdentifier}] Proxy Started!`);
        console.log(
          `[UDP] [${ruleIdentifier}] Listening => (${details.server.family}) ${details.server.address}:${details.server.port}`
        );
        console.log(
          `[UDP] [${ruleIdentifier}] Destination => (${details.target.family}) ${details.target.address}:${details.target.port}`
        );
      });

      server.on("bound", function (details) {
        // Optional: Log bound details if needed
        // console.log(`[UDP] [${ruleIdentifier}] Proxy bound: Route ${details.route.address}:${details.route.port}, Peer ${details.peer.address}:${details.peer.port}`);
      });

      // // when the server gets a message (Commented out for performance)
  // server.on("message", function (message, sender) {
      // server.on("message", function (message, sender) {
      //   console.log(
      //     `[UDP] [${ruleIdentifier}] Message from ${sender.address}:${sender.port}`
      //   );
      // });

      // // when the bound socket gets a message and it's send back to the peer the socket was bound to (Commented out for performance)
      // server.on("proxyMsg", function (message, sender, peer) {
      //   console.log(
      //     `[UDP] [${ruleIdentifier}] Answer from ${sender.address}:${sender.port} - ${peer.address}:${peer.port}`
      //   );
      // });

      server.on("proxyClose", function (peer) {
        console.log(`[UDP] [${ruleIdentifier}] Disconnecting socket from ${peer.address} on local port ${localPort}`);
      });

      server.on("proxyError", function (err) {
        console.error(`[UDP] [${ruleIdentifier}] ProxyError on ${localHost}:${localPort}: ${err}`);
      });

      server.on("error", function (err) {
        console.error(`[UDP] [${ruleIdentifier}] Server Error on ${localHost}:${localPort}: ${err}`);
      });

      return [server]; // Return array containing the single server instance
    } catch (err) {
      console.error(`[UDP] [${ruleIdentifier}] Failed to create server for ${localHost}:${localPort} -> ${targetHost}:${targetPort}: ${err}`);
      return [];
    }
  } else {
    console.error(`[UDP] Invalid configuration for ${ruleIdentifier}. Missing localPort/targetPort or localPortRange/targetPortRange.`);
    return []; // Return empty array for invalid config
  }
}

// Need net module for IP validation
const net = require("net");

module.exports = { startUDPServer };
