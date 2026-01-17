# GMGN 馬丁格爾交易機器人

自動化馬丁格爾策略交易機器人，支援 BSC 鏈上多代幣交易。

## 快速開始

### 單代幣模式

```bash
# 1. 配置策略
# 編輯 martingale-config.js 設置代幣地址和參數

# 2. 運行
node run-martingale.js
```

### 多代幣模式

```bash
# 1. 複製配置
cp martingale-config.js configs/token2.config.js

# 2. 編輯 configs/token2.config.js
# 修改 tokenAddress 為新代幣地址

# 3. 同時運行（不同終端）
node run-token.js token1  # 終端1
node run-token.js token2  # 終端2
```

## 核心功能

- ✅ 馬丁格爾策略（開倉、加倉、止盈、回本）
- ✅ 數學優化（部分止盈/回本，節省 50% 手續費）
- ✅ 鏈上實時價格查詢（PancakeSwap）
- ✅ 多代幣獨立運行
- ✅ 交易確認後驗證實際數量

## 重要文件

| 文件 | 說明 |
|------|------|
| `martingale-config.js` | 策略配置 |
| `run-martingale.js` | 單代幣啟動 |
| `run-token.js` | 多代幣啟動 |
| `show-status.js` | 查看持倉狀態 |
| `USAGE.md` | 詳細使用說明 |
| `MARTINGALE_README.md` | 策略說明 |

## 詳細文檔

- 使用說明：`USAGE.md`
- 策略說明：`MARTINGALE_README.md`
- AI 開發指南：`CLAUDE.md`

## 安全提醒

⚠️ 先用 `autoTrade: false` 監控模式測試
⚠️ 使用專用錢包，不要放太多資金
⚠️ 設置合理的投入金額
