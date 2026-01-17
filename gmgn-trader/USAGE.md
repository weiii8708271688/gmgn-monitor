# 使用說明

## 重要更新

### 1. 數學優化策略 - 部分止盈/回本（最新）

#### 🎯 核心優化目標：最小化交易手續費

傳統策略問題：
- 止盈時全部賣出 → 重新開倉 = 2 次手續費
- 回本時全部賣出 → 重新開倉 = 2 次手續費

**新策略優勢**：
- ✅ 止盈時只賣出盈利部分，保留本金持倉 = 1 次手續費
- ✅ 回本時只賣出加倉部分，保留 baseAmount = 1 次手續費
- ✅ **節省 50% 手續費成本**

#### 數學計算公式

**場景 1：止盈時部分賣出**
```
假設：投入 $100，止盈目標 20%
當價格達到止盈點時：
- 總價值 = $120
- 盈利金額 = $100 × 20% = $20
- 賣出百分比 = $20 / $120 = 16.67%
- 保留 83.33% 持倉繼續參與行情
```

**場景 2：加倉後回本賣出**
```
假設：開倉 $33，加倉 1 次 $66，總投入 $99
當價格回到均價時：
- 總價值 = $99（回本）
- 需賣出 = $99 - $33 = $66（收回加倉部分）
- 賣出百分比 = $66 / $99 = 66.67%
- 保留 $33 baseAmount，重新開始循環
```

#### 策略流程

1. **開倉** → 價格 $0.0005，投入 $33
2. **下跌 20% 加倉** → 價格 $0.0004，投入 $66，均價 $0.000429
3. **回到均價** → 賣出 66.67% 代幣，收回 $66，保留 $33 持倉
   - ✅ 重置開倉價為當前價 $0.000429
   - ✅ 重置加倉次數為 0
   - ✅ 避免全賣再買，節省 1 次手續費
4. **再次下跌加倉** → 從新開倉價開始計算
5. **上漲止盈 20%** → 賣出 16.67% 代幣，鎖定盈利，保留持倉
   - ✅ 重置開倉價為當前價
   - ✅ 繼續參與後續上漲

#### 測試驗證

運行完整數學測試：
```bash
node test-martingale-math.js
```

查看部分止盈示例：
```bash
node test-partial-takeprofit.js
```

### 2. 價格查詢來源選項

現在支援兩種價格數據來源：

#### 選項 1: 鏈上查詢（推薦）
- **優點**：實時價格、無延遲、無 API rate limit
- **來源**：PancakeSwap 流動性池
- **配置**：`priceSource: 'onchain'`

#### 選項 2: GMGN API
- **優點**：更多數據（歷史價格、24h變化等）
- **缺點**：可能有延遲
- **配置**：`priceSource: 'gmgn'`

**修改方式**：編輯 `martingale-config.js` 第 30 行

```javascript
// 價格數據來源
// 'gmgn' - 使用 GMGN API（可能有延迟）
// 'onchain' - 使用鏈上流動性池查詢（實時，推薦）
priceSource: 'onchain',  // 修改這裡
```

### 3. BNB 價格自動更新（鏈上查詢模式專屬）

當使用 `priceSource: 'onchain'` 時：
- **價格來源**：優先使用幣安 API，失敗則使用鏈上查詢
- **自動更新**：每 1 分鐘自動更新一次
- **緩存機制**：1 分鐘內重複查詢使用緩存，提升性能
- **自動顯示**：每次更新會顯示 `🔄 BNB 價格已更新: $XXX.XX (來源: 幣安 API)`
- **動態計算**：所有交易的 BNB 投入量都使用實時 BNB 價格計算
- **配置忽略**：`martingale-config.js` 中的 `bnbPrice` 會被忽略

當使用 `priceSource: 'gmgn'` 時：
- 使用配置文件中的固定 `bnbPrice` 值

### 4. 交易防重複機制

新增交易狀態追蹤，防止未確認時重複送交易：

- **冷卻時間**：每筆交易後 5 秒內不會送新交易
- **狀態提示**：顯示剩餘冷卻時間和待確認交易 hash
- **自動恢復**：冷卻期過後自動允許新交易

示例輸出：
```
⏳ 交易冷卻中... 剩餘 3 秒（待確認交易: 0xabcd1234...）
```

## 配置說明

### martingale-config.js 主要配置

```javascript
export const MARTINGALE_CONFIG = {
  // 代幣地址
  tokenAddress: '0x94569e17a820b11eab7cd51c050becac01aa4444',

  // 價格數據來源（新增）
  priceSource: 'onchain', // 'gmgn' 或 'onchain'

  // 策略參數
  baseAmount: 33,        // 首次投入（USD）
  bnbPrice: 980,         // BNB 參考價格（用於計算投入量）
  multiplier: 2,         // 加倉倍數
  dropPercentage: 20,    // 下跌多少%加倉
  maxAddPositions: 3,    // 最多加倉次數
  takeProfitPercentage: 20, // 止盈百分比

  // 交易方式
  tradeMethod: 'pancakeswap', // 'pancakeswap' 或 'gmgn'
  slippage: 40,               // 滑點 (4%)

  // 監控設置
  priceCheckInterval: 3000, // 價格檢查間隔（毫秒）
  autoTrade: false,         // 是否自動交易
};
```

## 使用流程

### 1. 首次使用（如果使用 GMGN API）

```bash
# 設置瀏覽器會話（僅 GMGN API 需要）
node setup-browser-session.js
```

### 2. 配置策略

編輯 `martingale-config.js`，設置：
- 代幣地址
- 價格來源（推薦 `'onchain'`）
- 策略參數
- 是否啟用自動交易

### 3. 測試價格查詢

```bash
# 測試鏈上價格查詢
node test-onchain-price.js
```

### 4. 啟動策略

```bash
# 僅監控模式（autoTrade: false）
node run-martingale.js

# 自動交易模式（autoTrade: true，高風險！）
# 確保已設置 BSC_PRIVATE_KEY
node run-martingale.js
```

### 5. 停止策略

按 `Ctrl+C` 停止

## 常見問題

### Q1: 鏈上查詢和 GMGN API 哪個更好？

**A**: 推薦使用鏈上查詢（`priceSource: 'onchain'`）
- ✅ 實時價格，無延遲
- ✅ 無 API rate limit
- ✅ 更穩定可靠
- ❌ 但沒有歷史數據和額外資訊

### Q2: 為什麼每秒查詢但還會重複送交易？

**A**: 已修復！新版本有交易冷卻機制：
- 每筆交易送出後會記錄 hash
- 30 秒冷卻期內不會送新交易
- 避免重複送交易的問題

### Q3: BNB 價格是固定的嗎？

**A**: 取決於價格來源設置！

**鏈上查詢模式（`priceSource: 'onchain'`）**：
- ✅ 每 1 分鐘自動更新 BNB 價格（幣安 API）
- ✅ 所有 USD → BNB 轉換都使用實時價格
- ✅ 配置中的 `bnbPrice` 會被忽略
- ✅ 交易時顯示當前 BNB 價格
- ✅ 幣安 API 失敗時自動切換到鏈上查詢

**GMGN API 模式（`priceSource: 'gmgn'`）**：
- 使用配置文件中的固定 `bnbPrice` 值
- 需要手動更新配置文件來調整

### Q4: 如何調整交易冷卻時間？

**A**: 編輯 `martingale-strategy.js` 第 31 行：

```javascript
this.txCooldown = 5000; // 5秒，可改為其他值（毫秒）
```

建議設置：
- **3-5 秒**：正常使用（預設 5 秒）
- **10 秒以上**：網路不穩定時

### Q5: 價格檢查間隔建議設多少？

**A**:
- **測試階段**：3-5 秒（`priceCheckInterval: 3000`）
- **實際運行**：5-10 秒（避免過度查詢）
- **鏈上查詢**：可以設更短，無 rate limit

## 測試建議

1. **先用鏈上查詢測試**
   ```bash
   node test-onchain-price.js
   ```

2. **監控模式運行一段時間**
   - 設置 `autoTrade: false`
   - 觀察價格查詢和策略邏輯

3. **小額測試自動交易**
   - 設置 `autoTrade: true`
   - 用小額資金測試
   - 確認交易冷卻機制正常

4. **逐步增加投入**
   - 確認策略穩定後再增加 `baseAmount`

## 安全提醒

- ⚠️ 自動交易有風險，請謹慎使用
- ⚠️ 建議先用監控模式（`autoTrade: false`）測試
- ⚠️ 使用專用錢包，不要放太多資金
- ⚠️ 定期檢查運行狀態和日誌
- ⚠️ 設置合理的 `baseAmount` 和 `maxAddPositions`
