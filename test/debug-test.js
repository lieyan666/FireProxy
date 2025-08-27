/*
 * @Author: Lieyan
 * @Date: 2025-08-27
 * @Description: Simple connection test to debug FireProxy issues
 */

const net = require('net');
const dgram = require('dgram');

class DebugTest {
  async testTCPConnection() {
    console.log('🔍 Testing TCP connection to FireProxy...');
    
    return new Promise((resolve) => {
      const socket = net.createConnection(29171, '127.0.0.1');
      
      socket.setTimeout(3000);
      
      socket.on('connect', () => {
        console.log('✅ TCP connection established');
        socket.write('HELLO_FIREPROXY');
      });
      
      socket.on('data', (data) => {
        console.log('✅ TCP data received:', data.toString().slice(0, 50));
        socket.end();
        resolve(true);
      });
      
      socket.on('error', (error) => {
        console.log('❌ TCP connection error:', error.message);
        socket.destroy();
        resolve(false);
      });
      
      socket.on('timeout', () => {
        console.log('⏰ TCP connection timeout');
        socket.destroy();
        resolve(false);
      });
      
      socket.on('close', () => {
        console.log('🔌 TCP connection closed');
      });
    });
  }
  
  async testUDPConnection() {
    console.log('🔍 Testing UDP connection to FireProxy...');
    
    return new Promise((resolve) => {
      const socket = dgram.createSocket('udp4');
      const testData = Buffer.from('HELLO_UDP_FIREPROXY');
      
      const timeout = setTimeout(() => {
        console.log('⏰ UDP test timeout');
        socket.close();
        resolve(false);
      }, 3000);
      
      socket.on('message', (msg) => {
        console.log('✅ UDP response received:', msg.toString().slice(0, 50));
        clearTimeout(timeout);
        socket.close();
        resolve(true);
      });
      
      socket.on('error', (error) => {
        console.log('❌ UDP error:', error.message);
        clearTimeout(timeout);
        socket.close();
        resolve(false);
      });
      
      console.log('📤 Sending UDP packet...');
      socket.send(testData, 29172, '127.0.0.1', (error) => {
        if (error) {
          console.log('❌ UDP send error:', error.message);
          clearTimeout(timeout);
          socket.close();
          resolve(false);
        } else {
          console.log('✅ UDP packet sent successfully');
        }
      });
    });
  }
  
  async checkPorts() {
    console.log('🔍 Checking if FireProxy ports are listening...\n');
    
    const checkPort = (port, type) => {
      return new Promise((resolve) => {
        const socket = net.createConnection(port, '127.0.0.1');
        
        socket.setTimeout(1000);
        
        socket.on('connect', () => {
          console.log(`✅ Port ${port} (${type}) is listening`);
          socket.destroy();
          resolve(true);
        });
        
        socket.on('error', () => {
          console.log(`❌ Port ${port} (${type}) is not accessible`);
          resolve(false);
        });
        
        socket.on('timeout', () => {
          console.log(`⏰ Port ${port} (${type}) timeout`);
          socket.destroy();
          resolve(false);
        });
      });
    };
    
    const tcp29171 = await checkPort(29171, 'TCP');
    const tcp29172 = await checkPort(29172, 'TCP-check'); // UDP port check via TCP
    
    return { tcp29171, tcp29172 };
  }
  
  async run() {
    console.log('🚀 FireProxy Debug Test\n');
    
    // Check if ports are listening
    const portStatus = await this.checkPorts();
    console.log('');
    
    if (!portStatus.tcp29171) {
      console.log('❌ FireProxy doesn\'t seem to be running on expected ports');
      console.log('💡 Make sure FireProxy is running with the correct configuration');
      return;
    }
    
    // Test connections
    const tcpResult = await this.testTCPConnection();
    console.log('');
    
    const udpResult = await this.testUDPConnection();
    console.log('');
    
    // Summary
    console.log('📋 Test Summary:');
    console.log(`TCP Test: ${tcpResult ? '✅ PASS' : '❌ FAIL'}`);
    console.log(`UDP Test: ${udpResult ? '✅ PASS' : '❌ FAIL'}`);
    
    if (!tcpResult || !udpResult) {
      console.log('\n💡 Troubleshooting tips:');
      console.log('1. Ensure FireProxy is running: npm start');
      console.log('2. Check config.json has the correct target servers');
      console.log('3. Verify target servers (192.168.1.3:29171/29172) are reachable');
      console.log('4. Check firewall settings');
    } else {
      console.log('\n🎉 All tests passed! FireProxy is working correctly.');
    }
  }
}

// Run if called directly
if (require.main === module) {
  const debugTest = new DebugTest();
  debugTest.run().catch(console.error);
}

module.exports = DebugTest;