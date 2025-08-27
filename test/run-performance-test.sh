#!/bin/bash
#
# FireProxy Performance Test Runner
# 
# Usage: ./run-performance-test.sh [quick|full|stress]
#

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
PROXY_CONFIG="test/config-performance.json"
TEST_SCRIPT="test/performance-test.js"
RESULTS_DIR="test/results"

# Test modes
TEST_MODE=${1:-quick}

echo -e "${BLUE}🔥 FireProxy Performance Test Runner 🔥${NC}\n"

# Check if FireProxy is running
check_fireproxy() {
    echo -e "${YELLOW}Checking FireProxy status...${NC}"
    
    # Check if ports are in use
    if lsof -Pi :29171 -sTCP:LISTEN -t >/dev/null 2>&1 || lsof -Pi :29172 -sUDP:Bind -t >/dev/null 2>&1; then
        echo -e "${RED}❌ FireProxy appears to be already running on test ports${NC}"
        echo -e "${YELLOW}Please stop FireProxy before running performance tests${NC}"
        echo "Kill processes using ports 29171/29172:"
        lsof -Pi :29171 -sTCP:LISTEN 2>/dev/null || true
        lsof -Pi :29172 -sUDP:Bind 2>/dev/null || true
        exit 1
    fi
}

# Start FireProxy for testing
start_fireproxy() {
    echo -e "${YELLOW}Starting FireProxy with performance test configuration...${NC}"
    
    # Copy test config
    cp config.json config.json.backup 2>/dev/null || true
    cp $PROXY_CONFIG config.json
    
    # Start FireProxy in background
    node app.js > fireproxy-test.log 2>&1 &
    FIREPROXY_PID=$!
    
    echo "FireProxy PID: $FIREPROXY_PID"
    
    # Wait for FireProxy to start
    echo -e "${YELLOW}Waiting for FireProxy to initialize...${NC}"
    sleep 5
    
    # Verify it's running
    if ! kill -0 $FIREPROXY_PID 2>/dev/null; then
        echo -e "${RED}❌ Failed to start FireProxy${NC}"
        cat fireproxy-test.log
        exit 1
    fi
    
    echo -e "${GREEN}✅ FireProxy started successfully${NC}"
}

# Stop FireProxy
stop_fireproxy() {
    echo -e "${YELLOW}Stopping FireProxy...${NC}"
    
    if [ ! -z "$FIREPROXY_PID" ] && kill -0 $FIREPROXY_PID 2>/dev/null; then
        kill $FIREPROXY_PID
        wait $FIREPROXY_PID 2>/dev/null || true
        echo -e "${GREEN}✅ FireProxy stopped${NC}"
    fi
    
    # Restore original config
    if [ -f config.json.backup ]; then
        mv config.json.backup config.json
        echo -e "${GREEN}✅ Original configuration restored${NC}"
    fi
}

# Run performance tests
run_tests() {
    echo -e "${BLUE}🚀 Running performance tests in $TEST_MODE mode...${NC}\n"
    
    # Create results directory
    mkdir -p $RESULTS_DIR
    
    case $TEST_MODE in
        "quick")
            echo -e "${YELLOW}Quick test mode: Limited concurrency and duration${NC}"
            CONCURRENT_LEVELS="10,50"
            TEST_DURATION=10000
            ;;
        "full")
            echo -e "${YELLOW}Full test mode: Complete test suite${NC}"
            CONCURRENT_LEVELS="10,50,100,200"
            TEST_DURATION=30000
            ;;
        "stress")
            echo -e "${YELLOW}Stress test mode: Maximum load testing${NC}"
            CONCURRENT_LEVELS="100,200,500,1000"
            TEST_DURATION=60000
            ;;
        *)
            echo -e "${RED}❌ Invalid test mode: $TEST_MODE${NC}"
            echo "Available modes: quick, full, stress"
            exit 1
            ;;
    esac
    
    # Set environment variables for test configuration
    export TEST_MODE=$TEST_MODE
    export CONCURRENT_LEVELS=$CONCURRENT_LEVELS
    export TEST_DURATION=$TEST_DURATION
    
    # Run the performance test
    node $TEST_SCRIPT
    
    echo -e "\n${GREEN}✅ Performance tests completed!${NC}"
}

# Monitor system resources during test
monitor_resources() {
    echo -e "${YELLOW}Starting system resource monitoring...${NC}"
    
    # Start monitoring in background
    {
        echo "timestamp,cpu_usage,memory_usage,load_avg"
        while kill -0 $FIREPROXY_PID 2>/dev/null; do
            timestamp=$(date '+%Y-%m-%d %H:%M:%S')
            cpu_usage=$(top -l 1 -n 0 | grep "CPU usage" | awk '{print $3}' | sed 's/%//' 2>/dev/null || echo "0")
            memory_usage=$(vm_stat | grep "Pages active" | awk '{print $3}' | sed 's/\.//' 2>/dev/null || echo "0")
            load_avg=$(uptime | awk -F'load averages:' '{print $2}' | awk '{print $1}' 2>/dev/null || echo "0")
            
            echo "$timestamp,$cpu_usage,$memory_usage,$load_avg"
            sleep 5
        done
    } > "$RESULTS_DIR/system_monitor_$(date +%Y%m%d_%H%M%S).csv" &
    
    MONITOR_PID=$!
}

# Cleanup function
cleanup() {
    echo -e "\n${YELLOW}Cleaning up...${NC}"
    
    # Stop monitoring
    if [ ! -z "$MONITOR_PID" ] && kill -0 $MONITOR_PID 2>/dev/null; then
        kill $MONITOR_PID 2>/dev/null || true
    fi
    
    # Stop FireProxy
    stop_fireproxy
    
    # Clean up log files
    rm -f fireproxy-test.log
    
    echo -e "${GREEN}✅ Cleanup completed${NC}"
}

# Set up signal handlers
trap cleanup EXIT INT TERM

# Main execution
main() {
    echo -e "Test mode: ${BLUE}$TEST_MODE${NC}\n"
    
    check_fireproxy
    start_fireproxy
    monitor_resources
    run_tests
    
    echo -e "\n${GREEN}🎉 All tests completed successfully!${NC}"
    echo -e "${BLUE}Check the results directory for detailed reports${NC}"
}

# Show help
show_help() {
    echo "FireProxy Performance Test Runner"
    echo ""
    echo "Usage: $0 [MODE]"
    echo ""
    echo "Modes:"
    echo "  quick   - Quick test with limited load (default)"
    echo "  full    - Complete test suite"
    echo "  stress  - Maximum load stress testing"
    echo ""
    echo "Examples:"
    echo "  $0 quick    # Run quick tests"
    echo "  $0 full     # Run full test suite"
    echo "  $0 stress   # Run stress tests"
    echo ""
}

# Parse command line arguments
case $1 in
    -h|--help)
        show_help
        exit 0
        ;;
    quick|full|stress|"")
        main
        ;;
    *)
        echo -e "${RED}❌ Invalid option: $1${NC}"
        show_help
        exit 1
        ;;
esac