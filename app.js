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

let config;
const configPath = "config.json";

// Read and parse config with error handling
try {
  if (!fs.existsSync(configPath)) {
    console.error(`Error: Configuration file "${configPath}" not found.`);
    console.log(`Please create "${configPath}" based on "config.example.json".`);
    process.exit(1); // Exit if config file is missing
  }
  const configFileContent = fs.readFileSync(configPath);
  config = JSON.parse(configFileContent);
  if (!config || !Array.isArray(config.forward)) {
    throw new Error("Invalid config format. 'forward' array not found.");
  }
} catch (error) {
  console.error(`Error reading or parsing ${configPath}: ${error.message}`);
  process.exit(1); // Exit on config error
}

// Start performance monitoring
monitor.start();
console.log(`[INFO] Performance monitoring enabled. Summary reports every 5 minutes.`);

// Iterate through rules and start servers
config.forward.forEach((rule, index) => {
    // Use 'rule' instead of 'server' for clarity
    if (rule.status === "active") {
        const ruleIdentifier = rule.name ? `${rule.name} (ID: ${rule.id})` : `Rule ID: ${rule.id}`;
        console.log(`[INFO] Initializing active rule: ${ruleIdentifier}`);
        if (rule.type === "tcp") {
            // Pass the entire rule object
            const servers = startTCPServer(rule);
            servers.forEach((server, serverIndex) => {
                monitor.registerProxy(`tcp_${rule.id}_${serverIndex}`, server);
            });
        } else if (rule.type === "udp") {
            // Pass the entire rule object
            const servers = startUDPServer(rule);
            servers.forEach((server, serverIndex) => {
                monitor.registerProxy(`udp_${rule.id}_${serverIndex}`, server);
            });
        } else {
            console.error(`[ERROR] Invalid server type "${rule.type}" for rule ${ruleIdentifier}. Skipping.`);
        }
    } else if (rule.id) { // Only log if it's a valid rule entry with an ID
        const ruleIdentifier = rule.name ? `${rule.name} (ID: ${rule.id})` : `Rule ID: ${rule.id}`;
        console.log(`[INFO] Skipping inactive rule: ${ruleIdentifier}`);
    } else {
        console.warn("[WARN] Skipping entry in config: Missing ID or invalid format.");
    }
});

// Graceful shutdown handling
process.on('SIGINT', () => {
    console.log('\n[INFO] Received SIGINT. Shutting down gracefully...');
    monitor.stop();
    process.exit(0);
});

process.on('SIGTERM', () => {
    console.log('\n[INFO] Received SIGTERM. Shutting down gracefully...');
    monitor.stop();
    process.exit(0);
});
