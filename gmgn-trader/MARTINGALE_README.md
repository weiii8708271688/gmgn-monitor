# 马丁格尔策略交易机器人

自动化的马丁格尔策略交易系统，支持BSC链上的代币交易。

## 📋 策略说明

### 核心逻辑

1. **开仓**：首次买入，投入 `baseAmount` 美金
2. **加仓**：价格每下跌 `dropPercentage`%，加仓金额为上次的 `multiplier` 倍
3. **止盈**：当价格达到均价 + `takeProfitPercentage`% 时，全部卖出

### 示例（默认配置）

- **基础投入**: $100
- **加仓倍数**: 2倍
- **下跌触发**: -20%
- **最大加仓**: 3次
- **止盈点**: 均价+20%

**交易序列**:
1. 开仓: $100 @ $0.00001 (100%价格)
2. 加仓1: $200 @ $0.000008 (80%价格，-20%)
3. 加仓2: $400 @ $0.000006 (60%价格，-40%)
4. 加仓3: $800 @ $0.000004 (40%价格，-60%)

**总投入**: $1500
**平均成本**: 根据实际买到的数量计算
**止盈**: 均价 × 1.2

## 🚀 快速开始

### 1. 环境准备

确保已安装依赖：
```bash
npm install
```

### 2. 配置策略

编辑 `martingale-config.js`：

```javascript
export const MARTINGALE_CONFIG = {
  // 代币地址
  tokenAddress: '0x5ae6abd70147d2214cac2e2dee7af15235bf4444',

  // 策略参数
  baseAmount: 100,           // 每次投入金额（美金）
  bnbPrice: 600,            // BNB价格（美金）
  multiplier: 2,            // 加仓倍数
  dropPercentage: 20,       // 下跌多少百分比加仓
  maxAddPositions: 3,       // 最多加仓几次
  takeProfitPercentage: 20, // 止盈百分比

  // 交易设置
  tradeMethod: 'pancakeswap', // 'pancakeswap' 或 'gmgn'
  slippage: 5,                // 滑点（百分比）
  autoTrade: false,           // 是否启用自动交易

  // 监控设置
  priceCheckInterval: 5000,   // 价格检查间隔（毫秒）
};
```

### 3. 设置环境变量

编辑 `.env` 文件：

```env
# 必需 - 钱包地址
GMGN_WALLET_ADDRESS=0xYourWalletAddress

# PancakeSwap交易需要（tradeMethod='pancakeswap'）
BSC_PRIVATE_KEY=your_private_key_here
BSC_RPC_URL=https://bsc-dataseed1.binance.org

# GMGN交易需要（tradeMethod='gmgn'）
# 需要先运行 node setup-browser-session.js
```

### 4. 测试系统

运行测试脚本确保一切正常：

```bash
node test-martingale.js
```

测试内容：
- ✅ 配置验证
- ✅ 计算逻辑
- ✅ 状态管理
- ✅ 价格API
- ✅ 交易器

### 5. 启动策略

**⚠️ 重要：首次运行建议设置 `autoTrade: false`，仅监控不交易！**

```bash
node run-martingale.js
```

## 📊 文件说明

### 核心文件

- **`martingale-config.js`** - 策略配置（重要！必须修改）
- **`martingale-strategy.js`** - 策略核心逻辑
- **`martingale-state.js`** - 状态管理和持久化
- **`pancakeswap-trader.js`** - PancakeSwap交易执行器
- **`gmgn-trader.js`** - GMGN交易执行器
- **`run-martingale.js`** - 主运行程序
- **`test-martingale.js`** - 测试脚本

### 数据文件

- **`martingale-state.json`** - 策略状态（自动生成）
  - 持仓信息
  - 加仓记录
  - 交易历史
  - 统计数据

## ⚙️ 配置详解

### 策略参数

| 参数 | 说明 | 示例 |
|------|------|------|
| `tokenAddress` | 代币合约地址 | `0x5ae6...` |
| `baseAmount` | 每次投入金额（USD） | `100` |
| `bnbPrice` | BNB价格（USD），用于计算 | `600` |
| `multiplier` | 加仓倍数 | `2` (每次翻倍) |
| `dropPercentage` | 触发加仓的下跌百分比 | `20` (下跌20%) |
| `maxAddPositions` | 最多加仓次数 | `3` (总共4次买入) |
| `takeProfitPercentage` | 止盈百分比 | `20` (均价+20%) |

### 交易设置

| 参数 | 说明 | 推荐值 |
|------|------|--------|
| `tradeMethod` | 交易方式 | `'pancakeswap'` (快速) |
| `slippage` | 滑点容忍度（%） | `5` |
| `autoTrade` | 是否自动交易 | `false` (测试用) |
| `priceCheckInterval` | 检查间隔（ms） | `5000` (5秒) |
| `gasPrice` | Gas价格（Gwei） | `5` |
| `gasLimit` | Gas限制 | `500000` |

## 🔄 两种交易方式

### PancakeSwap（推荐）

**优点**:
- ✅ 真正的市价单，立即成交
- ✅ 速度快，延迟低
- ✅ 精确控制Gas和滑点

**缺点**:
- ❌ 需要提供私钥
- ❌ 需要支付Gas费

**配置**:
```javascript
tradeMethod: 'pancakeswap',
privateKey: process.env.BSC_PRIVATE_KEY
```

### GMGN（备选）

**优点**:
- ✅ 不需要私钥
- ✅ 使用GMGN网页托管

**缺点**:
- ❌ 限价单模拟市价单，可能有延迟
- ❌ 需要先运行 `setup-browser-session.js`
- ❌ 成交时间不确定（通常几秒）

**配置**:
```javascript
tradeMethod: 'gmgn'
```

需要先运行：
```bash
node setup-browser-session.js
```

## 📈 运行示例

### 启动日志

```
🚀 马丁格尔策略初始化
======================================================================

📋 策略配置:
   代币地址: 0x5ae6abd70147d2214cac2e2dee7af15235bf4444
   基础投入: $100
   加仓倍数: 2x
   最大仓位数: 4
   总投入（满仓）: $1500
   加仓触发: -20%, -40%, -60%
   止盈百分比: +20%
   交易方式: PANCAKESWAP
   滑点: 5%
   自动交易: ❌ 未启用（仅监控）

✅ 策略初始化完成

▶️  启动马丁格尔策略
价格检查间隔: 5秒

[2025-01-11 10:30:00] 💲 当前价格: $0.00001
   ➡️  无持仓，准备开仓...
⚠️  自动交易未启用，跳过实际交易
```

### 监控中

```
[2025-01-11 10:30:05] 💲 当前价格: $0.000009
   ⏳ 持仓中，相对均价: -10.00%

[2025-01-11 10:30:10] 💲 当前价格: $0.000008
   ⬇️  价格下跌 -20.00%，准备加仓...
⚠️  自动交易未启用，跳过实际交易
```

### 止盈触发

```
[2025-01-11 10:35:00] 💲 当前价格: $0.000012
   ✅ 达到止盈条件！(+20.50%)

💰 执行止盈
======================================================================
   当前价格: $0.000012
   均价: $0.00001
   卖出数量: 35000000.00 tokens
   预估价值: $420.00
   预估盈利: $120.00 (40.00%)
⚠️  自动交易未启用，跳过实际交易
```

## ⚠️ 风险警告

### 高风险策略

马丁格尔策略具有以下风险：

1. **资金需求高**：每次加仓金额翻倍，需要充足资金
2. **连续下跌风险**：价格持续下跌可能导致全部资金投入仍未止盈
3. **流动性风险**：代币流动性不足可能导致滑点过大
4. **Gas费用**：频繁交易会产生大量Gas费用

### 安全建议

1. **小额测试**：先用小金额测试策略
2. **设置止损**：考虑设置最大亏损限制
3. **选择流动性高的代币**：避免滑点过大
4. **监控市场**：不要完全依赖自动交易
5. **保管私钥**：永远不要泄露私钥

## 🔧 故障排除

### 价格获取失败

```
❌ 无法获取价格
```

**解决方案**:
1. 检查GMGN session是否有效: `node setup-browser-session.js`
2. 检查代币地址是否正确
3. 检查网络连接

### 交易失败

```
❌ 买入失败: insufficient funds
```

**解决方案**:
1. 检查BNB余额是否充足
2. 检查Gas设置是否合理
3. 检查滑点设置是否足够

### PancakeSwap初始化失败

```
❌ PancakeSwap交易器初始化失败: 未设置私钥
```

**解决方案**:
1. 在 `.env` 中设置 `BSC_PRIVATE_KEY`
2. 或切换到GMGN模式: `tradeMethod: 'gmgn'`

## 📝 状态文件

### martingale-state.json

状态文件记录了完整的交易历史和持仓信息：

```json
{
  "hasPosition": true,
  "entryPrice": 0.00001,
  "averagePrice": 0.0000085,
  "totalTokens": 35000000,
  "totalInvestedUSD": 300,
  "totalInvestedBNB": 0.5,
  "addPositionCount": 1,
  "purchases": [
    {
      "timestamp": 1234567890,
      "type": "entry",
      "priceUSD": 0.00001,
      "bnbAmount": 0.1,
      "usdAmount": 100,
      "tokensReceived": 10000000,
      "txHash": "0x..."
    }
  ],
  "sales": [],
  "stats": {
    "totalTrades": 0,
    "totalProfit": 0,
    "totalLoss": 0,
    "winRate": 0,
    "maxProfit": 0,
    "maxLoss": 0
  }
}
```

## 🎯 最佳实践

### 开始前

1. ✅ 运行测试: `node test-martingale.js`
2. ✅ 设置 `autoTrade: false`
3. ✅ 监控几个周期，观察策略行为
4. ✅ 确认代币流动性充足

### 运行中

1. ✅ 定期查看 `martingale-state.json`
2. ✅ 监控BNB余额
3. ✅ 注意市场异常波动
4. ✅ 准备手动干预

### 启用自动交易

只有在完全理解策略逻辑后才启用：

```javascript
autoTrade: true  // ⚠️ 谨慎启用
```

## 📚 进阶配置

### 自定义加仓序列

如果想要不同的加仓倍数，可以修改 `martingale-strategy.js` 中的 `calculateNextPositionBNB()` 方法。

### 添加止损

可以在 `checkPrice()` 中添加止损逻辑：

```javascript
if (shouldStopLoss(currentPrice)) {
  await executeStopLoss(currentPrice);
}
```

### 多代币支持

复制配置文件，为每个代币创建独立实例。

## 🤝 支持

如有问题，请检查：
1. 配置是否正确
2. 余额是否充足
3. 网络连接是否正常
4. 测试脚本是否通过

---

**免责声明**: 本策略仅供学习和研究使用。加密货币交易存在高风险，请谨慎使用并自行承担风险。
