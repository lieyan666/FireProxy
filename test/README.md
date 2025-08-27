# 🔥 FireProxy 性能测试指南

## 📋 测试工具概览

FireProxy 提供了完整的性能测试套件来验证网络转发性能：

### 🛠️ 测试脚本

1. **完整性能测试** (`test/performance-test.js`)
   - 全面的TCP/UDP性能基准测试
   - 支持多种并发级别和数据包大小
   - 生成详细的性能报告

2. **快速基准测试** (`test/quick-benchmark.js`)
   - 轻量级性能验证
   - 快速连接测试
   - 内存使用监控

3. **自动化测试脚本** (`test/run-performance-test.sh`)
   - 完整的测试流程自动化
   - 支持多种测试模式
   - 系统资源监控

## 🚀 使用方法

### NPM 脚本
```bash
# 快速基准测试
npm run bench

# 完整性能测试  
npm run perf

# 自动化测试套件
npm run test:quick   # 快速模式
npm run test:full    # 完整测试
npm run test:stress  # 压力测试
```

### 直接运行
```bash
# 手动执行测试
node test/quick-benchmark.js
node test/performance-test.js

# 使用测试脚本
./test/run-performance-test.sh quick
./test/run-performance-test.sh full
./test/run-performance-test.sh stress
```

## 📊 测试模式

### Quick Mode (快速模式)
- 并发连接: 10, 50
- 测试时长: 10秒
- 用途: 快速验证基本性能

### Full Mode (完整模式)
- 并发连接: 10, 50, 100, 200
- 测试时长: 30秒
- 用途: 全面性能评估

### Stress Mode (压力模式)
- 并发连接: 100, 200, 500, 1000
- 测试时长: 60秒
- 用途: 极限负载测试

## 📈 性能指标

### TCP 指标
- **吞吐量** (Mbps): 数据传输速率
- **请求速率** (req/s): 每秒处理的请求数
- **连接速率** (conn/s): 每秒建立的连接数
- **延迟** (ms): 平均和P95延迟
- **错误率** (%): 失败连接的百分比

### UDP 指标
- **包速率** (pkt/s): 每秒处理的UDP包数
- **吞吐量** (Mbps): UDP数据传输速率
- **延迟** (ms): UDP往返时间
- **丢包率** (%): 数据包丢失百分比

### 系统指标
- **内存使用**: RSS, 堆内存使用情况
- **CPU负载**: 系统负载平均值
- **连接池状态**: 活跃连接、空闲连接统计

## 🔧 测试配置

测试使用专用配置文件 `test/config-performance.json`:

```json
{
  "forward": [
    {
      "id": 1,
      "name": "TCP Performance Test",
      "type": "tcp",
      "localPort": 29171,
      "targetPort": 8001
    },
    {
      "id": 2, 
      "name": "UDP Performance Test",
      "type": "udp",
      "localPort": 29172,
      "targetPort": 8002
    }
  ]
}
```

## 📁 结果输出

- **控制台输出**: 实时性能指标
- **JSON报告**: 详细的测试结果数据
- **CSV监控**: 系统资源使用历史
- **时间戳文件**: 所有结果按时间归档

## ⚠️ 测试注意事项

1. **确保端口可用**: 测试前检查29171/29172端口
2. **系统资源**: 压力测试可能消耗大量系统资源
3. **网络环境**: 建议在稳定的网络环境下测试
4. **并发限制**: 注意系统文件描述符限制

## 🎯 性能优化验证

使用测试脚本可以验证以下优化效果：

- **动态连接池**: 自适应连接数量管理
- **Zero-copy传输**: 减少内存拷贝开销
- **预热机制**: 避免冷启动延迟
- **负载均衡**: 智能连接分配
- **资源监控**: 实时性能跟踪

运行测试前后对比，量化性能提升效果！