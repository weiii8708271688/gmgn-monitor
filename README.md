# 加密貨幣交易機器人

多鏈價格監控與掛單系統，支援 BSC、Solana、Base 三條區塊鏈。

## 功能特色

- 🔍 **多鏈價格監控**: BSC (PancakeSwap)、Solana (Raydium/Jupiter)、Base (Uniswap V4)
- 📊 **智能掛單**: 限價買賣、止損、止盈
- 🔔 **即時通知**: Telegram Webhook 推送
- 💾 **池子緩存**: Solana 鏈池子自動發現與緩存，提升查詢速度
- 🌐 **網頁介面**: 簡潔易用的管理後台

## 快速開始

### 1. 安裝依賴
```bash
npm install
```

### 2. 設定環境變數
```bash
cp .env.example .env
# 編輯 .env 填入你的配置
```

必須配置:
```env
PORT=3000
BSC_RPC_URL=https://bsc-dataseed1.binance.org
SOLANA_RPC_URL=https://api.mainnet-beta.solana.com
BASE_RPC_URL=https://mainnet.base.org
```

### 3. 初始化資料庫
```bash
npm run init-db
```

### 4. 啟動服務
```bash
# 生產模式
npm start

# 開發模式（自動重啟）
npm run dev
```

### 5. 訪問介面
打開瀏覽器: http://localhost:3000

## 測試

### 測試價格監控（包含快取測試）
```bash
node test-prices.js
```
測試項目:
- Base 鏈價格查詢
- Solana 鏈價格查詢
- BSC 鏈價格查詢
- Solana 池子緩存性能測試

### 測試消息推送
```bash
node test-notifications.js
```
測試項目:
- Telegram Webhook 連接
- 價格警報推送
- 訂單執行通知
- 價格更新推送
- 錯誤通知推送

## 專案結構

```
trading/
├── src/
│   ├── index.js                    # 主程式入口
│   ├── config/
│   │   └── config.js               # 配置管理
│   ├── database/
│   │   ├── init.js                 # 資料庫初始化
│   │   └── db.js                   # 資料庫連接
│   ├── services/
│   │   ├── priceMonitor/
│   │   │   ├── bsc.js              # BSC 價格監控
│   │   │   ├── solana.js           # Solana 價格監控（支援多池子類型）
│   │   │   └── base.js             # Base 價格監控
│   │   ├── poolFinder.js           # 池子發現與緩存服務
│   │   ├── orderService.js         # 掛單服務
│   │   ├── alertService.js         # 提醒服務
│   │   └── notification/
│   │       ├── telegram.js         # Telegram Bot
│   │       ├── line.js             # LINE Bot
│   │       └── telegramWebhook.js  # Telegram Webhook
│   ├── routes/
│   │   ├── tokens.js               # 代幣路由
│   │   ├── orders.js               # 掛單路由
│   │   ├── alerts.js               # 提醒路由
│   │   └── price.js                # 價格路由
│   └── utils/
│       └── logger.js               # 日誌工具
├── public/
│   ├── index.html                  # 前端介面
│   ├── css/style.css               # 樣式
│   └── js/app.js                   # 前端邏輯
├── data/                           # 資料庫文件
├── test-prices.js                  # 價格測試（含快取）
├── test-notifications.js           # 消息推送測試
├── .env                            # 環境變數
├── CLAUDE.md                       # Claude Code 項目指南
└── README.md                       # 本文件
```

## 技術架構

### 後端
- **框架**: Node.js + Express.js
- **區塊鏈**:
  - ethers.js (BSC/Base)
  - @solana/web3.js + @raydium-io/raydium-sdk-v2 (Solana)
- **資料庫**: SQLite
- **通知**: Telegraf, LINE Bot SDK

### Solana 特色功能
- **多池子支援**: AMM V4, CPMM, CLMM
- **智能池子發現**: 自動搜尋最佳流動性池
- **池子緩存**: 資料庫緩存池子信息，查詢速度提升 5-10 倍
- **價格來源**: Raydium (鏈上) + Jupiter (API) 雙重來源

### 前端
- HTML/CSS/JavaScript
- Axios (HTTP 請求)

## API 端點

### 代幣管理
- `GET /api/tokens` - 獲取所有代幣
- `POST /api/tokens` - 添加代幣
- `DELETE /api/tokens/:id` - 刪除代幣

### 掛單管理
- `GET /api/orders` - 獲取所有掛單
- `GET /api/orders/active` - 獲取活躍掛單
- `POST /api/orders` - 創建掛單
- `PATCH /api/orders/:id/cancel` - 取消掛單
- `DELETE /api/orders/:id` - 刪除掛單

### 價格提醒
- `GET /api/alerts` - 獲取所有提醒
- `GET /api/alerts/active` - 獲取活躍提醒
- `POST /api/alerts` - 創建提醒
- `PATCH /api/alerts/:id/cancel` - 取消提醒
- `DELETE /api/alerts/:id` - 刪除提醒

### 價格查詢
- `GET /api/price/:chain/:address` - 獲取單個代幣價格
- `POST /api/price/batch` - 批量獲取價格

### 系統狀態
- `GET /api/health` - 健康檢查
- `GET /api/status` - 系統統計

## 使用模式

### 模式一：僅監控 + 通知（預設，低風險）
```env
AUTO_TRADE_ENABLED=false  # 或不設定
```
- 監控價格變化
- 達標時發送通知
- **不執行**實際交易
- 適合觀察市場、手動決策

### 模式二：自動交易（⚠️ 高風險）
```env
AUTO_TRADE_ENABLED=true
BSC_PRIVATE_KEY=0x...
SOLANA_PRIVATE_KEY=[...]
BASE_PRIVATE_KEY=0x...
```
- 監控價格變化
- 達標時**自動執行**鏈上交易
- 需配置私鑰和交易參數
- **僅建議經驗豐富的用戶使用**

## 環境變數完整說明

### 必須配置
```env
PORT=3000
BSC_RPC_URL=https://bsc-dataseed1.binance.org
SOLANA_RPC_URL=https://api.mainnet-beta.solana.com
BASE_RPC_URL=https://mainnet.base.org
```

### 通知服務（可選）
```env
TELEGRAM_BOT_TOKEN=your_bot_token
TELEGRAM_CHAT_ID=your_chat_id
LINE_CHANNEL_ACCESS_TOKEN=your_line_token
LINE_CHANNEL_SECRET=your_line_secret
```

### 自動交易（可選，高風險）
```env
AUTO_TRADE_ENABLED=true
BSC_PRIVATE_KEY=0x...
SOLANA_PRIVATE_KEY=[1,2,3,...]
BASE_PRIVATE_KEY=0x...
BSC_TRADE_AMOUNT=0.01
SOLANA_TRADE_AMOUNT=0.1
BASE_TRADE_AMOUNT=0.01
TRADE_SLIPPAGE=2
TRADE_DEADLINE=20
```

## 注意事項

### 一般使用
1. 妥善保管 `.env` 文件，包含敏感資訊
2. 建議使用付費 RPC 節點以獲得更好的穩定性
3. 首次使用建議先用模式一（僅通知）
4. 定期備份 `data/trading.db` 資料庫

### RPC 節點建議
- **BSC**: [QuickNode](https://www.quicknode.com/), [Ankr](https://www.ankr.com/)
- **Solana**: [QuickNode](https://www.quicknode.com/), [Helius](https://www.helius.dev/)
- **Base**: [Alchemy](https://www.alchemy.com/), [Infura](https://www.infura.io/)

### 自動交易（重要！）
⚠️ **使用自動交易功能前請務必：**
1. 在測試網充分測試
2. 使用少量資金的專用錢包
3. 設定合理的交易限額和滑點
4. 啟用 Telegram 通知即時監控
5. 理解可能的風險和損失

## 常見問題

### 1. 如何獲取 Telegram Bot Token?
1. 在 Telegram 搜索 `@BotFather`
2. 發送 `/newbot` 創建機器人
3. 按提示設定名稱，獲取 Token
4. 向你的機器人發送 `/start`
5. 訪問 `https://api.telegram.org/bot<TOKEN>/getUpdates` 獲取 Chat ID

### 2. Solana 代幣價格查不到?
- 系統會自動查找最佳池子並緩存
- 首次查詢較慢（1-2分鐘），之後會很快
- 確保代幣有足夠的流動性
- 支援 Raydium AMM V4、CPMM、CLMM 池子

### 3. 價格監控頻率如何調整?
在 `src/index.js` 修改 cron 表達式:
```javascript
// 每分鐘: '*/1 * * * *'
// 每30秒: '*/30 * * * * *'
// 每5分鐘: '*/5 * * * *'
cron.schedule('*/1 * * * *', monitorPrices);
```

### 4. 如何重置資料庫?
```bash
rm data/trading.db
npm run init-db
```

## 開發指南

詳細的開發指南請參考 [CLAUDE.md](./CLAUDE.md)，包含：
- 專案架構詳解
- 添加新區塊鏈支援
- 修改訂單邏輯
- 資料庫架構
- 測試建議

## License

MIT

## GMGN 新幣監控

### 功能說明
監控 GMGN API 的 BSC 新幣列表（completed 狀態），當發現新地址時自動推送通知。

### 過濾條件
系統會自動過濾掉以下條件的代幣，不會發送通知：
- `top_10_holder_rate > 0.4` - 前10大持有者比例過高（大戶集中）
- `entrapment_ratio > 0.4` - 陷阱比例過高（可能是誘多陷阱）
- `rat_trader_amount_rate > 0.4` - 老鼠倉比例過高（內部交易風險）
- 可在代碼中擴展其他過濾條件

### GMGN API 回傳欄位（completed 狀態）
- `address` - 代幣合約地址（主要監控欄位）
- `pool_address` - 池子地址
- `quote_address` - 交易對地址（通常為 WBNB）
- `logo` - 代幣圖標 URL
- `symbol` - 代幣符號
- `name` - 代幣名稱
- `trans_symbol` / `trans_name` - 翻譯後的名稱
- `launchpad` / `launchpad_platform` - 發射平台（如 fourmeme）
- `exchange` - 交易所（如 pancake_v2）
- `creator_token_status` - 創建者代幣狀態（creator_close/creator_hold）
- `progress` - 完成進度（0-1）
- `total_supply` - 總供應量
- `usd_market_cap` / `market_cap` - 市值（USD）
- `swaps_1h/1m/6h/24h` - 交易次數（不同時間段）
- `volume_1h/1m/6h/24h` - 交易量（不同時間段）
- `buys_1h/1m/6h/24h` - 買入次數
- `sells_1h/1m/6h/24h` - 賣出次數
- `net_buy_1h/1m/6h/24h` - 淨買入量
- **`top_10_holder_rate`** - 前10大持有者比例（關鍵過濾欄位）
- `creator_balance_rate` - 創建者持倉比例
- `rat_trader_amount_rate` - 老鼠倉比例
- `bundler_trader_amount_rate` - 打包交易者比例
- `bundler_mhr` - 打包最高持有率
- `renowned_count` - 知名地址數量
- `bot_degen_rate` / `bot_degen_count` - 機器人/Degen 比例和數量
- `holder_count` - 持有者數量
- `liquidity` - 流動性
- `creator` - 創建者地址
- `creator_created_open_count` - 創建者已開盤項目數
- `creator_created_open_ratio` - 開盤比例
- `creator_created_count` - 創建者總項目數
- `fund_from` - 資金來源（如 Binance）
- `fund_from_ts` - 資金來源時間戳
- `rug_ratio` - Rug 風險比例
- `created_timestamp` - 創建時間戳
- `open_timestamp` - 開盤時間戳
- `complete_timestamp` - 完成時間戳
- `complete_cost_time` - 完成耗時（秒）
- `sniper_count` - 狙擊手數量
- `entrapment_ratio` - 陷阱比例
- `is_wash_trading` - 是否洗盤交易
- `renounced_mint` / `renounced_freeze_account` - 是否放棄鑄幣/凍結權限
- `burn_status` - 銷毀狀態
- `is_honeypot` - 是否蜜罐（yes/no/空）
- `open_source` - 是否開源（yes/no）
- `owner_renounced` - 是否放棄所有權（yes/no）
- `dev_team_hold_rate` - 開發團隊持倉率
- `suspected_insider_hold_rate` - 疑似內部人持倉率
- `top70_sniper_hold_rate` - 前70狙擊手持倉率
- `has_at_least_one_social` - 是否有社交媒體
- `twitter_is_tweet` - 是否有推文
- `twitter` / `twitter_handle` - Twitter 信息
- `website` - 官網
- `telegram` - Telegram 群組
- `twitter_rename_count` - Twitter 改名次數
- `twitter_del_post_token_count` - Twitter 刪推次數
- `twitter_create_token_count` - Twitter 創建代幣數
- `dexscr_ad` / `dexscr_update_link` / `dexscr_trending_bar` / `dexscr_boost_fee` - DexScreener 廣告信息
- `cto_flag` - CTO 標記
- `image_dup` / `twitter_dup` / `telegram_dup` / `website_dup` - 重複檢測
- `status` - 狀態（1=完成）
- `tg_call_count` - Telegram 喊單次數
- `fresh_wallet_rate` - 新錢包比例
- `trade_fee` - 交易費用

### 使用方式
1. 在網頁介面開啟/關閉監控
2. 系統每 10 秒檢查一次新幣
3. 符合條件的新幣會推送通知

## 免責聲明

本工具僅供教育和學習用途。加密貨幣交易有風險，請謹慎使用。開發者不對任何使用本工具導致的損失負責。
