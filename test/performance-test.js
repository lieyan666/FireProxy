/*
 * @Author: Lieyan
 * @Date: 2025-08-27
 * @Description: Comprehensive performance test suite for FireProxy
 * @Contact: QQ: 2102177341  Website: lieyan.space  Github: @lieyan666
 * @Copyright: Copyright (c) 2024 by lieyanDevTeam, All Rights Reserved.
 */

const net = require('net');
const dgram = require('dgram');
const { performance } = require('perf_hooks');
const os = require('os');

class FireProxyPerformanceTest {
  constructor() {
    this.testResults = {
      tcp: {},
      udp: {},
      system: {}
    };
    
    // Test configuration
    this.config = {
      tcp: {
        proxyHost: '127.0.0.1',
        proxyPort: 29171,
        targetHost: '192.168.1.3', // Will be mocked
        targetPort: 29171
      },
      udp: {
        proxyHost: '127.0.0.1',
        proxyPort: 29172,
        targetHost: '192.168.1.3', // Will be mocked
        targetPort: 29172
      },
      concurrent: [10, 50, 100, 200, 500],
      dataSize: [1024, 4096, 16384, 65536], // 1KB to 64KB
      testDuration: 30000, // 30 seconds per test
      warmupTime: 5000 // 5 seconds warmup
    };
    
    this.mockServers = {};
  }

  // Start mock target servers for testing
  async startMockServers() {
    console.log('🚀 Starting mock target servers...');
    
    // Mock TCP server
    const tcpServer = net.createServer((socket) => {
      socket.on('data', (data) => {
        // Echo back the data for testing
        socket.write(data);
      });
      
      socket.on('error', (err) => {
        console.error('Mock TCP server error:', err.message);
      });
    });
    
    tcpServer.listen(8001, '127.0.0.1', () => {
      console.log('✅ Mock TCP server listening on 127.0.0.1:8001');
    });
    
    // Mock UDP server
    const udpServer = dgram.createSocket('udp4');
    
    udpServer.on('message', (msg, rinfo) => {
      // Echo back the message
      udpServer.send(msg, rinfo.port, rinfo.address);
    });
    
    udpServer.bind(8002, '127.0.0.1', () => {
      console.log('✅ Mock UDP server listening on 127.0.0.1:8002');
    });
    
    this.mockServers.tcp = tcpServer;
    this.mockServers.udp = udpServer;
    
    // Wait for servers to be ready
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  // TCP Performance Tests
  async testTCPPerformance(concurrency, dataSize) {
    console.log(`\n📊 Testing TCP - Concurrency: ${concurrency}, Data Size: ${dataSize}B`);
    
    const results = {
      concurrency,
      dataSize,
      connections: 0,
      successfulConnections: 0,
      totalRequests: 0,
      successfulRequests: 0,
      errors: 0,
      startTime: performance.now(),
      endTime: 0,
      latencies: [],
      throughputMbps: 0
    };

    const testData = Buffer.alloc(dataSize, 'A');
    const promises = [];
    
    // Warmup phase
    console.log('  🔥 Warming up...');
    await this.tcpWarmup(Math.min(concurrency, 10), testData);
    
    console.log('  ⚡ Starting performance test...');
    const testStartTime = performance.now();

    for (let i = 0; i < concurrency; i++) {
      promises.push(this.runTCPClient(testData, results, testStartTime));
    }

    await Promise.all(promises);
    results.endTime = performance.now();
    
    // Calculate metrics
    const durationMs = results.endTime - results.startTime;
    const durationSeconds = durationMs / 1000;
    results.avgLatency = results.latencies.reduce((a, b) => a + b, 0) / results.latencies.length;
    results.p95Latency = results.latencies.sort((a, b) => a - b)[Math.floor(results.latencies.length * 0.95)];
    results.requestsPerSecond = results.successfulRequests / durationSeconds;
    results.connectionRate = results.successfulConnections / durationSeconds;
    results.throughputMbps = (results.successfulRequests * dataSize * 8) / (durationSeconds * 1024 * 1024);
    results.errorRate = (results.errors / results.totalRequests) * 100;

    console.log(`  ✅ Completed: ${results.successfulRequests}/${results.totalRequests} requests, ${results.requestsPerSecond.toFixed(2)} req/s, ${results.throughputMbps.toFixed(2)} Mbps`);
    
    return results;
  }

  async tcpWarmup(connections, testData) {
    const promises = [];
    for (let i = 0; i < connections; i++) {
      promises.push(this.createTCPConnection(testData, true));
    }
    await Promise.allSettled(promises);
  }

  async runTCPClient(testData, results, testStartTime) {
    const endTime = testStartTime + this.config.testDuration;
    
    while (performance.now() < endTime) {
      try {
        const latency = await this.createTCPConnection(testData);
        results.totalRequests++;
        results.successfulRequests++;
        results.latencies.push(latency);
      } catch (error) {
        results.totalRequests++;
        results.errors++;
      }
      
      // Small delay to prevent overwhelming
      await new Promise(resolve => setImmediate(resolve));
    }
  }

  createTCPConnection(testData, isWarmup = false) {
    return new Promise((resolve, reject) => {
      const startTime = performance.now();
      const socket = net.createConnection(this.config.tcp.proxyPort, this.config.tcp.proxyHost);
      
      // Prevent EventEmitter memory leak warnings
      socket.setMaxListeners(20);
      socket.setTimeout(5000);
      
      let resolved = false;
      
      const cleanup = () => {
        if (!socket.destroyed) {
          socket.removeAllListeners();
          socket.destroy();
        }
      };
      
      const resolveOnce = (value) => {
        if (!resolved) {
          resolved = true;
          resolve(value);
        }
      };
      
      const rejectOnce = (error) => {
        if (!resolved) {
          resolved = true;
          cleanup();
          reject(error);
        }
      };
      
      socket.on('connect', () => {
        if (!isWarmup) {
          this.testResults.tcp.connections++;
        }
        socket.write(testData);
      });
      
      socket.on('data', (data) => {
        const latency = performance.now() - startTime;
        cleanup();
        resolveOnce(isWarmup ? 0 : latency);
      });
      
      socket.on('error', (error) => {
        rejectOnce(error);
      });
      
      socket.on('timeout', () => {
        rejectOnce(new Error('Connection timeout'));
      });
      
      socket.on('close', () => {
        if (!resolved) {
          rejectOnce(new Error('Connection closed unexpectedly'));
        }
      });
    });
  }

  // UDP Performance Tests
  async testUDPPerformance(concurrency, dataSize) {
    console.log(`\n📊 Testing UDP - Concurrency: ${concurrency}, Data Size: ${dataSize}B`);
    
    const results = {
      concurrency,
      dataSize,
      totalPackets: 0,
      successfulPackets: 0,
      errors: 0,
      startTime: performance.now(),
      endTime: 0,
      latencies: [],
      throughputMbps: 0
    };

    const testData = Buffer.alloc(dataSize, 'U');
    const promises = [];
    
    console.log('  ⚡ Starting UDP performance test...');
    const testStartTime = performance.now();

    for (let i = 0; i < concurrency; i++) {
      promises.push(this.runUDPClient(testData, results, testStartTime));
    }

    await Promise.all(promises);
    results.endTime = performance.now();
    
    // Calculate metrics
    const durationMs = results.endTime - results.startTime;
    const durationSeconds = durationMs / 1000;
    results.avgLatency = results.latencies.reduce((a, b) => a + b, 0) / results.latencies.length;
    results.p95Latency = results.latencies.sort((a, b) => a - b)[Math.floor(results.latencies.length * 0.95)];
    results.packetsPerSecond = results.successfulPackets / durationSeconds;
    results.throughputMbps = (results.successfulPackets * dataSize * 8) / (durationSeconds * 1024 * 1024);
    results.errorRate = (results.errors / results.totalPackets) * 100;

    console.log(`  ✅ Completed: ${results.successfulPackets}/${results.totalPackets} packets, ${results.packetsPerSecond.toFixed(2)} pkt/s, ${results.throughputMbps.toFixed(2)} Mbps`);
    
    return results;
  }

  async runUDPClient(testData, results, testStartTime) {
    const endTime = testStartTime + this.config.testDuration;
    const socket = dgram.createSocket('udp4');
    
    while (performance.now() < endTime) {
      try {
        const latency = await this.sendUDPPacket(socket, testData);
        results.totalPackets++;
        results.successfulPackets++;
        results.latencies.push(latency);
      } catch (error) {
        results.totalPackets++;
        results.errors++;
      }
      
      // Small delay between packets
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    
    socket.close();
  }

  sendUDPPacket(socket, testData) {
    return new Promise((resolve, reject) => {
      const startTime = performance.now();
      
      // Increase max listeners to prevent warnings
      socket.setMaxListeners(50);
      
      const timeout = setTimeout(() => {
        reject(new Error('UDP timeout'));
      }, 1000);
      
      const messageHandler = (msg) => {
        clearTimeout(timeout);
        socket.removeListener('message', messageHandler);
        const latency = performance.now() - startTime;
        resolve(latency);
      };
      
      socket.once('message', messageHandler);
      
      socket.send(testData, this.config.udp.proxyPort, this.config.udp.proxyHost, (error) => {
        if (error) {
          clearTimeout(timeout);
          socket.removeListener('message', messageHandler);
          reject(error);
        }
      });
    });
  }

  // System monitoring during tests
  getSystemMetrics() {
    const cpus = os.cpus();
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedMem = totalMem - freeMem;
    
    return {
      cpu: {
        count: cpus.length,
        model: cpus[0].model,
        loadAverage: os.loadavg()
      },
      memory: {
        total: Math.round(totalMem / 1024 / 1024),
        used: Math.round(usedMem / 1024 / 1024),
        free: Math.round(freeMem / 1024 / 1024),
        usage: Math.round((usedMem / totalMem) * 100)
      },
      process: {
        memory: process.memoryUsage(),
        uptime: process.uptime()
      }
    };
  }

  // Run comprehensive test suite
  async runAllTests() {
    console.log('🔥 FireProxy Performance Test Suite 🔥\n');
    console.log('System Information:');
    console.log('OS:', os.type(), os.release());
    console.log('CPU:', os.cpus()[0].model);
    console.log('Memory:', Math.round(os.totalmem() / 1024 / 1024 / 1024), 'GB');
    console.log('Node.js:', process.version);
    console.log('\n' + '='.repeat(80) + '\n');
    
    await this.startMockServers();
    
    const allResults = {
      tcp: [],
      udp: [],
      systemMetrics: {
        start: this.getSystemMetrics(),
        end: null
      },
      testConfig: this.config
    };

    // TCP Tests
    console.log('🔧 Running TCP Performance Tests');
    for (const concurrency of this.config.concurrent) {
      for (const dataSize of this.config.dataSize) {
        const result = await this.testTCPPerformance(concurrency, dataSize);
        allResults.tcp.push(result);
        
        // Cool down between tests
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }

    // UDP Tests
    console.log('\n🔧 Running UDP Performance Tests');
    for (const concurrency of this.config.concurrent) {
      for (const dataSize of this.config.dataSize) {
        const result = await this.testUDPPerformance(concurrency, dataSize);
        allResults.udp.push(result);
        
        // Cool down between tests
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }

    allResults.systemMetrics.end = this.getSystemMetrics();
    
    // Generate report
    this.generateReport(allResults);
    
    // Cleanup
    this.mockServers.tcp.close();
    this.mockServers.udp.close();
    
    return allResults;
  }

  generateReport(results) {
    console.log('\n' + '='.repeat(80));
    console.log('📈 PERFORMANCE TEST REPORT');
    console.log('='.repeat(80));
    
    // TCP Summary
    console.log('\n🔗 TCP Performance Summary:');
    const tcpBest = results.tcp.reduce((best, current) => 
      current.throughputMbps > best.throughputMbps ? current : best
    );
    console.log(`Best Throughput: ${tcpBest.throughputMbps.toFixed(2)} Mbps (${tcpBest.concurrency} concurrent, ${tcpBest.dataSize}B)`);
    console.log(`Best Request Rate: ${Math.max(...results.tcp.map(r => r.requestsPerSecond)).toFixed(2)} req/s`);
    console.log(`Avg Latency Range: ${Math.min(...results.tcp.map(r => r.avgLatency)).toFixed(2)}ms - ${Math.max(...results.tcp.map(r => r.avgLatency)).toFixed(2)}ms`);
    
    // UDP Summary
    console.log('\n📡 UDP Performance Summary:');
    const udpBest = results.udp.reduce((best, current) => 
      current.throughputMbps > best.throughputMbps ? current : best
    );
    console.log(`Best Throughput: ${udpBest.throughputMbps.toFixed(2)} Mbps (${udpBest.concurrency} concurrent, ${udpBest.dataSize}B)`);
    console.log(`Best Packet Rate: ${Math.max(...results.udp.map(r => r.packetsPerSecond)).toFixed(2)} pkt/s`);
    console.log(`Avg Latency Range: ${Math.min(...results.udp.map(r => r.avgLatency)).toFixed(2)}ms - ${Math.max(...results.udp.map(r => r.avgLatency)).toFixed(2)}ms`);
    
    // System Impact
    console.log('\n💾 System Resource Usage:');
    const startMem = results.systemMetrics.start.memory;
    const endMem = results.systemMetrics.end.memory;
    console.log(`Memory Usage: ${startMem.used}MB → ${endMem.used}MB (${endMem.used - startMem.used > 0 ? '+' : ''}${endMem.used - startMem.used}MB)`);
    console.log(`Final Memory Usage: ${endMem.usage}%`);
    
    console.log('\n✨ Test completed successfully! ✨');
    
    // Save detailed results to file
    const fs = require('fs');
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `performance-report-${timestamp}.json`;
    fs.writeFileSync(filename, JSON.stringify(results, null, 2));
    console.log(`📁 Detailed results saved to: ${filename}`);
  }
}

// Run tests if called directly
if (require.main === module) {
  const tester = new FireProxyPerformanceTest();
  
  // Handle graceful shutdown
  process.on('SIGINT', () => {
    console.log('\n❌ Test interrupted by user');
    if (tester.mockServers.tcp) tester.mockServers.tcp.close();
    if (tester.mockServers.udp) tester.mockServers.udp.close();
    process.exit(0);
  });
  
  tester.runAllTests().catch(console.error);
}

module.exports = FireProxyPerformanceTest;