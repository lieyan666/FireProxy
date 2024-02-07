/*
 * @Author: Lieyan
 * @Date: 2024-02-06 02:00:46
 * @LastEditors: Lieyan
 * @LastEditTime: 2024-02-07 11:37:31
 * @FilePath: /FireProxy/modules/tcpProxy.js
 * @Description:
 * @Contact: QQ: 2102177341  Website: lieyan.space  Github: @lieyan666
 * @Copyright: Copyright (c) 2024 by lieyanDevTeam, All Rights Reserved.
 */
const net = require("net");

function startTCPServer(localHost, localPort, targetHost, targetPort) {
  const tcpServer = net.createServer((tcpLocalSocket) => {
    const tcpTargetSocket = net.createConnection(targetPort, targetHost);
    console.log(
      `[TCP] Connected ${tcpLocalSocket.remoteAddress}:${tcpLocalSocket.remotePort} -> ${targetHost}:${targetPort}`,
    );
    tcpLocalSocket.pipe(tcpTargetSocket);
    tcpTargetSocket.pipe(tcpLocalSocket);

    tcpLocalSocket.on("close", () => {
      console.log(
        `[TCP] Disconnecting socks from ${tcpLocalSocket.remoteAddress}:${tcpLocalSocket.remotePort}`,
      );
    });
    tcpTargetSocket.on("close", () => {
      console.log(
        `[TCP] Target server closed connection from ${targetHost}:${targetPort}`,
      );
    });
    tcpTargetSocket.on('error', (error) => {
      console.error(`[TCP] Error in connection to ${targetHost}:${targetPort}: ${error.message}`);
    });
  });
  tcpServer.on('error', (error) => {
    console.error(`[TCP] Server error: ${error.message}`);
  });
  tcpServer.listen(localPort, localHost, () => {
    console.log(`[TCP] Listening => ${localHost}:${localPort}`);
  });
}

module.exports = { startTCPServer };
