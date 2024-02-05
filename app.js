/*
 * @Author: Lieyan
 * @Date: 2024-02-06 01:59:21
 * @LastEditors: Lieyan
 * @LastEditTime: 2024-02-06 04:01:52
 * @FilePath: /FireProxy/app.js
 * @Description:
 * @Contact: QQ: 2102177341  Website: lieyan.space  Github: @lieyan666
 * @Copyright: Copyright (c) 2024 by lieyanDevTeam, All Rights Reserved.
 */
const fs = require("fs");
const { startTCPServer } = require("./modules/tcpProxy.js");
const { startUDPServer } = require("./modules/udpProxy.js");

// Read config
const config = JSON.parse(fs.readFileSync("config.json"));

// 
config.forward.forEach(server => {
    if (server.status === "active") {
        if (server.type === "tcp") {
            startTCPServer(server.localHost, server.localPort, server.targetHost, server.targetPort);
        } else if (server.type === "udp") {
            startUDPServer(server.localHost, server.localPort, server.targetHost, server.targetPort);
        } else {
            console.error(`Invalid server type: ${server.type}`);
        }
    } else {
        console.log(`Server ${server.id} is inactive.`);
    }
});
