e/*
 * @Author: Lieyan
 * @Date: 2024-02-06 02:08:34
 * @LastEditors: Lieyan
 * @LastEditTime: 2025-04-06 14:05:50
 * @FilePath: /FireProxy/modules/udpProxy.js
 * @Description:
 * @Contact: QQ: 2102177341  Website: lieyan.space  Github: @lieyan666
 * @Copyright: Copyright (c) 2024 by lieyanDevTeam, All Rights Reserved.
 */
const proxy = require("udp-proxy");

function startUDPServer(
  localHost,
  localPort,
  targetHost,
  targetPort,
  isIPv6 = false,
  isLocalIPv6 = false,
) {
  const options = {
      address: targetHost,
      port: targetPort,
      ipv6: isIPv6,
      localaddress: localHost,
      localport: localPort,
      localipv6: isLocalIPv6,
      // proxyaddress: '::0',
      timeOutTime: 10000,
    };

  // Create the server, each connection is handled internally
  const server = proxy.createServer(options);

  server.on("listening", function (details) {
    console.log("[UDP] Proxy Started!");
    console.log(
      `[UDP] Listening => (${details.server.family}) ${details.server.address}:${details.server.port}`,
    );
    console.log(
      `[UDP] Destination => (${details.target.family}) ${details.target.address}:${details.target.port}`,
    );
  });

  // The connection to server has been made and the proxying is in action
  server.on("bound", function (details) {
    console.log(
      `[UDP] Proxy is bound to -> ${details.route.address}:${details.route.port}`,
    );
    console.log(
      `[UDP] Peer is bound to -> ${details.peer.address}:${details.peer.port}`,
    );
  });

  // // when the server gets a message (Commented out for performance)
  // server.on("message", function (message, sender) {
  //   console.log(
  //     `[UDP] Message from ${sender.address}:${sender.port} {{message}}`, // Don't show message
  //   );
  // });

  // // when the bound socket gets a message and it's send back to the peer the socket was bound to (Commented out for performance)
  // server.on("proxyMsg", function (message, sender, peer) {
  //   console.log(
  //     `[UDP] Answer from ${sender.address}:${sender.port} - ${peer.address}:${peer.port} {{message}}`, // Don't show message
  //   );
  // });

  // when the socket closes (from a timeout) without new messages
  server.on("proxyClose", function (peer) {
    console.log(`[UDP] Disconnecting socket from ${peer.address}`);
  });

  server.on("proxyError", function (err) {
    console.log(`[UDP] ProxyError! ${err}`);
  });

  server.on("error", function (err) {
    console.log(`[UDP] Error!!! ${err}`);
  });
}
module.exports = { startUDPServer };
