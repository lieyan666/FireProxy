#!/bin/bash
#
# Quick Performance Test with Local Mock Servers
#

echo "🚀 Starting Quick Performance Test with Local Setup..."

# Kill any existing processes on test ports
echo "🧹 Cleaning up existing processes..."
lsof -ti:29171,29172,8001,8002 | xargs kill -9 2>/dev/null || true
sleep 2

# Backup current config
echo "💾 Backing up current configuration..."
cp config.json config.json.backup 2>/dev/null || true

# Use local test config
echo "⚙️  Switching to local test configuration..."
cp config-test-local.json config.json

# Start mock target servers
echo "🎯 Starting mock target servers..."

# Mock TCP server (port 8001)
node -e "
const net = require('net');
const server = net.createServer((socket) => {
  socket.on('data', (data) => {
    socket.write(data); // Echo back
  });
});
server.listen(8001, '127.0.0.1', () => {
  console.log('✅ Mock TCP server listening on 127.0.0.1:8001');
});
" &
TCP_SERVER_PID=$!

# Mock UDP server (port 8002)  
node -e "
const dgram = require('dgram');
const server = dgram.createSocket('udp4');
server.on('message', (msg, rinfo) => {
  server.send(msg, rinfo.port, rinfo.address);
});
server.bind(8002, '127.0.0.1', () => {
  console.log('✅ Mock UDP server listening on 127.0.0.1:8002');
});
" &
UDP_SERVER_PID=$!

# Wait for servers to start
sleep 3

# Start FireProxy
echo "🔥 Starting FireProxy..."
node app.js &
FIREPROXY_PID=$!

# Wait for FireProxy to start
sleep 5

# Run quick benchmark
echo "⚡ Running performance test..."
npm run bench

# Cleanup function
cleanup() {
  echo "🧹 Cleaning up..."
  kill $TCP_SERVER_PID $UDP_SERVER_PID $FIREPROXY_PID 2>/dev/null || true
  
  # Restore original config
  if [ -f config.json.backup ]; then
    mv config.json.backup config.json
    echo "✅ Original configuration restored"
  fi
  
  echo "✨ Cleanup completed"
}

# Set trap for cleanup
trap cleanup EXIT INT TERM

# Wait a bit to let the test run
sleep 15

echo "📊 Performance test completed!"