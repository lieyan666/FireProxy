/*
 * @Author: Lieyan
 * @Date: 2025-08-27
 * @Description: Lightweight benchmark script for quick performance validation
 */

const net = require('net');
const { performance } = require('perf_hooks');

class QuickBenchmark {
  async tcpBenchmark(host = '127.0.0.1', port = 29171, connections = 100) {
    console.log(`🔥 TCP Benchmark: ${connections} concurrent connections to ${host}:${port}`);
    
    const promises = [];
    const startTime = performance.now();
    let successful = 0;
    let failed = 0;
    const latencies = [];

    for (let i = 0; i < connections; i++) {
      promises.push(
        new Promise((resolve) => {
          const connStart = performance.now();
          const socket = net.createConnection(port, host);
          
          socket.setTimeout(5000);
          
          socket.on('connect', () => {
            const latency = performance.now() - connStart;
            latencies.push(latency);
            successful++;
            socket.write('BENCHMARK_TEST_DATA_' + i);
          });
          
          socket.on('data', () => {
            socket.end();
            resolve();
          });
          
          socket.on('error', () => {
            failed++;
            resolve();
          });
          
          socket.on('timeout', () => {
            failed++;
            socket.destroy();
            resolve();
          });
        })
      );
    }

    await Promise.all(promises);
    
    const endTime = performance.now();
    const duration = (endTime - startTime) / 1000;
    const avgLatency = latencies.reduce((a, b) => a + b, 0) / latencies.length;
    
    console.log(`✅ Results: ${successful}/${connections} successful, ${duration.toFixed(2)}s total`);
    console.log(`📊 Avg latency: ${avgLatency.toFixed(2)}ms, Rate: ${(successful / duration).toFixed(2)} conn/s`);
    
    return { successful, failed, avgLatency, rate: successful / duration };
  }
  
  async memorySnapshot() {
    const usage = process.memoryUsage();
    console.log(`💾 Memory: RSS ${(usage.rss/1024/1024).toFixed(1)}MB, Heap ${(usage.heapUsed/1024/1024).toFixed(1)}MB`);
    return usage;
  }
}

// Quick benchmark if run directly
if (require.main === module) {
  const benchmark = new QuickBenchmark();
  
  (async () => {
    console.log('🚀 FireProxy Quick Benchmark\n');
    
    await benchmark.memorySnapshot();
    console.log('');
    
    // Test different load levels
    for (const connections of [10, 50, 100]) {
      await benchmark.tcpBenchmark('127.0.0.1', 29171, connections);
      console.log('');
      
      // Cool down
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    await benchmark.memorySnapshot();
    console.log('\n✨ Quick benchmark completed!');
  })().catch(console.error);
}

module.exports = QuickBenchmark;