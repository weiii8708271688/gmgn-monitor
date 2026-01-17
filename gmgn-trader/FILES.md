# 文件結構說明

## 📁 核心文件（必需）

### 策略相關
- `martingale-config.js` - 策略配置
- `martingale-strategy.js` - 策略核心邏輯
- `martingale-state.js` - 狀態管理
- `pancakeswap-trader.js` - PancakeSwap 交易執行
- `onchain-price-fetcher.js` - 鏈上價格查詢

### 啟動腳本
- `run-martingale.js` - 單代幣啟動器
- `run-token.js` - 多代幣啟動器
- `show-status.js` - 查看持倉狀態

## 📁 GMGN 相關（可選）

- `gmgn-browser-api.js` - GMGN API 封裝
- `gmgn-trader.js` - GMGN 交易執行
- `gmgn-config.js` - GMGN 配置
- `browser-auth.js` - 瀏覽器認證
- `token-manager.js` - Token 管理
- `setup-browser-session.js` - GMGN 會話設置

## 📁 輔助工具（可選）

- `backtest-martingale.js` - 回測工具
- `generate-price-data.js` - 生成測試數據

## 📁 文檔

- `README.md` - 快速開始
- `USAGE.md` - 詳細使用說明
- `MARTINGALE_README.md` - 策略說明
- `CLAUDE.md` - AI 開發指南
- `FILES.md` - 本文件

## 📁 配置和狀態（自動生成）

```
configs/
├── token1.config.js  # 代幣1配置
└── token2.config.js  # 代幣2配置

states/
├── token1.state.json # 代幣1狀態
└── token2.state.json # 代幣2狀態
```

## 使用建議

**僅使用 PancakeSwap（推薦）**：
只需核心文件，可忽略所有 `gmgn-*` 文件

**使用 GMGN API**：
需要 GMGN 相關文件和運行 `setup-browser-session.js`
