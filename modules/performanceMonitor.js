/*
 * @Author: Lieyan
 * @Date: 2025-08-27
 * @Description: Performance monitoring module for FireProxy
 * @Contact: QQ: 2102177341  Website: lieyan.space  Github: @lieyan666
 * @Copyright: Copyright (c) 2024 by lieyanDevTeam, All Rights Reserved.
 */

const os = require('os');
const process = require('process');

class PerformanceMonitor {
  constructor() {
    this.startTime = Date.now();
    this.stats = {
      system: {
        cpuUsage: 0,
        memoryUsage: 0,
        totalMemory: os.totalmem(),
        loadAverage: os.loadavg(),
        uptime: 0
      },
      process: {
        memoryUsage: process.memoryUsage(),
        cpuUsage: process.cpuUsage(),
        uptime: 0
      },
      proxy: {
        totalConnections: 0,
        activeConnections: 0,
        totalErrors: 0,
        bytesTransferred: 0
      }
    };
    
    this.proxyInstances = new Map();
    this.monitoringInterval = null;
    this.reportInterval = 300000; // 5 minutes
  }

  start() {
    console.log('[Performance] Starting performance monitoring...');
    
    this.monitoringInterval = setInterval(() => {
      this.updateSystemStats();
      this.updateProcessStats();
      this.updateProxyStats();
    }, 30000); // Update every 30 seconds

    // Report summary every 5 minutes
    this.reportingInterval = setInterval(() => {
      this.printSummary();
    }, this.reportInterval);
  }

  stop() {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
    }
    if (this.reportingInterval) {
      clearInterval(this.reportingInterval);
    }
    console.log('[Performance] Performance monitoring stopped');
  }

  registerProxy(proxyId, proxyInstance) {
    this.proxyInstances.set(proxyId, proxyInstance);
  }

  unregisterProxy(proxyId) {
    this.proxyInstances.delete(proxyId);
  }

  updateSystemStats() {
    this.stats.system.uptime = os.uptime();
    this.stats.system.memoryUsage = (os.totalmem() - os.freemem()) / os.totalmem() * 100;
    this.stats.system.loadAverage = os.loadavg();
  }

  updateProcessStats() {
    this.stats.process.memoryUsage = process.memoryUsage();
    this.stats.process.cpuUsage = process.cpuUsage();
    this.stats.process.uptime = (Date.now() - this.startTime) / 1000;
  }

  updateProxyStats() {
    let totalConnections = 0;
    let activeConnections = 0;
    let totalErrors = 0;

    for (const [proxyId, proxy] of this.proxyInstances) {
      if (proxy && typeof proxy.getStats === 'function') {
        const stats = proxy.getStats();
        totalConnections += stats.totalConnections || stats.clientConnections || 0;
        activeConnections += stats.activeConnections || stats.activeClients || 0;
        totalErrors += stats.errors || 0;
      }
    }

    this.stats.proxy.totalConnections = totalConnections;
    this.stats.proxy.activeConnections = activeConnections;
    this.stats.proxy.totalErrors = totalErrors;
  }

  getStats() {
    this.updateSystemStats();
    this.updateProcessStats();
    this.updateProxyStats();
    return { ...this.stats };
  }

  printSummary() {
    const stats = this.getStats();
    const uptime = Math.floor(stats.process.uptime);
    const hours = Math.floor(uptime / 3600);
    const minutes = Math.floor((uptime % 3600) / 60);
    
    console.log('\n================================ Performance Summary ================================');
    console.log(`[Performance] Uptime: ${hours}h ${minutes}m`);
    console.log(`[Performance] System Memory: ${stats.system.memoryUsage.toFixed(1)}% (${(stats.system.totalMemory / 1024 / 1024 / 1024).toFixed(1)}GB total)`);
    console.log(`[Performance] Process Memory: RSS ${(stats.process.memoryUsage.rss / 1024 / 1024).toFixed(1)}MB, Heap ${(stats.process.memoryUsage.heapUsed / 1024 / 1024).toFixed(1)}MB`);
    console.log(`[Performance] Load Average: ${stats.system.loadAverage.map(l => l.toFixed(2)).join(', ')}`);
    console.log(`[Performance] Total Connections: ${stats.proxy.totalConnections}`);
    console.log(`[Performance] Active Connections: ${stats.proxy.activeConnections}`);
    console.log(`[Performance] Total Errors: ${stats.proxy.totalErrors}`);
    console.log(`[Performance] Active Proxy Instances: ${this.proxyInstances.size}`);
    console.log('==================================================================================\n');
  }

  getMemoryUsageMB() {
    const usage = process.memoryUsage();
    return {
      rss: Math.round(usage.rss / 1024 / 1024 * 100) / 100,
      heapTotal: Math.round(usage.heapTotal / 1024 / 1024 * 100) / 100,
      heapUsed: Math.round(usage.heapUsed / 1024 / 1024 * 100) / 100,
      external: Math.round(usage.external / 1024 / 1024 * 100) / 100
    };
  }

  getCPUUsage() {
    const usage = process.cpuUsage();
    return {
      user: usage.user / 1000000, // Convert to seconds
      system: usage.system / 1000000
    };
  }
}

const monitor = new PerformanceMonitor();

module.exports = {
  PerformanceMonitor,
  monitor
};