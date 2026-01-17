# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## ⚠️ IMPORTANT DEVELOPMENT PRINCIPLES

**DO NOT:**
1. **Never use non-aggregator APIs** like DexScreener, CoinGecko, CoinMarketCap for price queries
   - These APIs have rate limits, require API keys, and are not reliable for real-time trading
   - Always use on-chain data or DEX aggregator APIs (Jupiter, PancakeSwap Router, Uniswap)

2. **Never create unnecessary documentation files**
   - Do not create new .md files unless explicitly requested by the user
   - All necessary documentation already exists in README.md and CLAUDE.md
   - Keep documentation minimal and focused

3. **Never create unnecessary test files**
   - Do not create new test files unless explicitly requested by the user
   - Existing test files: `test-prices.js` and `test-notifications.js` are sufficient
   - Only create tests when user specifically asks for them

**DO:**
- Use direct on-chain queries via RPC endpoints
- Use DEX aggregator APIs (Jupiter for Solana, PancakeSwap Router for BSC)
- Modify existing files rather than creating new ones
- Ask user before creating any new files

## Project Overview

A cryptocurrency trading bot for monitoring prices and executing orders across BSC (Binance Smart Chain), Solana, and Base networks. The system supports limit orders, stop-loss/take-profit orders, and price alerts with Telegram/LINE notifications.

**Type**: Node.js Express application with SQLite database
**Language**: JavaScript (ES modules)

## Common Commands

### Development
```bash
# Install dependencies
npm install

# Initialize database (creates tables and indexes)
npm run init-db

# Start server in production mode
npm start

# Start server in development mode with auto-reload
npm run dev
```

### Database Management
- Database file location: `./data/trading.db`
- Backup database: `cp data/trading.db data/trading.db.backup`
- Reset database: Delete `data/trading.db` and run `npm run init-db`

## Architecture

### Core Components

**Price Monitoring System**
- `src/services/priceMonitor/bsc.js` - BSC price monitoring via PancakeSwap
- `src/services/priceMonitor/solana.js` - Solana price monitoring via Jupiter API
- `src/services/priceMonitor/base.js` - Base chain price monitoring
- Cron job in `src/index.js` runs every minute (`*/1 * * * *`) to check prices

**Order Execution Flow**
1. Price monitor detects price changes for all tokens in database
2. `OrderService.checkAndExecuteOrder()` evaluates active orders against current price
3. If conditions met, `OrderService.executeOrder()` is called
4. If `AUTO_TRADE_ENABLED=true`, executes on-chain trade via chain-specific executor
5. If `AUTO_TRADE_ENABLED=false`, only sends notification (default, safer mode)
6. Order status updated to 'executed' in database

**Trade Executors** (Optional - only active when AUTO_TRADE_ENABLED=true)
- `src/services/tradeExecutor/bscExecutor.js` - BSC/PancakeSwap trades using ethers.js
- `src/services/tradeExecutor/solanaExecutor.js` - Solana trades using @solana/web3.js
- `src/services/tradeExecutor/baseExecutor.js` - Base chain trades using ethers.js
- Wallet management handled by `src/services/walletManager.js`

**Notification System**
- `src/services/notification/telegram.js` - Telegram bot notifications
- `src/services/notification/line.js` - LINE bot notifications
- Sends alerts for price triggers and order executions

### Database Schema

**tokens** - Token registry
- `chain`, `address`, `symbol`, `decimals`, `pair_address`

**orders** - Trading orders (limit buy/sell, stop-loss, take-profit)
- `token_id`, `type`, `target_price`, `current_price`, `status`
- Status: 'active', 'executed', 'cancelled'

**alerts** - Price alerts
- `token_id`, `condition` (above/below), `target_price`, `status`
- Status: 'active', 'triggered', 'cancelled'

**price_history** - Historical price data
- `token_id`, `price`, `timestamp`

### API Routes

Routes are mounted in `src/index.js`:
- `/api/tokens` - Token CRUD operations
- `/api/orders` - Order management (create, list, cancel, delete)
- `/api/alerts` - Alert management (create, list, cancel, delete)
- `/api/price` - Price queries (single token or batch)
- `/api/health` - Health check endpoint
- `/api/status` - System statistics (token count, active orders/alerts, uptime)

## Configuration

### Environment Variables (.env)

**Required**
- `PORT` - Server port (default: 3000)
- `BSC_RPC_URL` - BSC RPC endpoint
- `SOLANA_RPC_URL` - Solana RPC endpoint
- `BASE_RPC_URL` - Base RPC endpoint

**Optional - Notifications**
- `TELEGRAM_BOT_TOKEN` - Telegram bot token
- `TELEGRAM_CHAT_ID` - Telegram chat ID
- `LINE_CHANNEL_ACCESS_TOKEN` - LINE channel access token
- `LINE_CHANNEL_SECRET` - LINE channel secret

**Optional - Auto Trading (⚠️ HIGH RISK)**
- `AUTO_TRADE_ENABLED` - Set to 'true' to enable actual on-chain trading (default: false)
- `BSC_PRIVATE_KEY` - Private key for BSC wallet (required if auto-trading on BSC)
- `SOLANA_PRIVATE_KEY` - Private key for Solana wallet in JSON array format (required if auto-trading on Solana)
- `BASE_PRIVATE_KEY` - Private key for Base wallet (required if auto-trading on Base)
- `BSC_TRADE_AMOUNT` - Amount of BNB to trade (default: 0.01)
- `SOLANA_TRADE_AMOUNT` - Amount of SOL to trade (default: 0.1)
- `BASE_TRADE_AMOUNT` - Amount of ETH to trade (default: 0.01)
- `TRADE_SLIPPAGE` - Slippage tolerance in percentage (default: 2)
- `TRADE_DEADLINE` - Transaction deadline in minutes (default: 20)

## Important Notes

### Two Operating Modes

**Mode 1: Monitor + Notify (Default, LOW RISK)**
- Set `AUTO_TRADE_ENABLED=false` or leave unset
- System monitors prices and sends notifications when conditions met
- No actual trading executed - user must trade manually
- Recommended for testing and safe operation

**Mode 2: Auto Trading (HIGH RISK)**
- Set `AUTO_TRADE_ENABLED=true`
- Requires private keys configured in .env
- Executes actual on-chain trades when order conditions met
- Use with extreme caution, only with dedicated wallets and small amounts

### Order Types Logic

- `limit_buy` - Executes when price <= target_price
- `limit_sell` - Executes when price >= target_price
- `stop_loss` - Executes when price <= target_price (sell to prevent further loss)
- `take_profit` - Executes when price >= target_price (sell to lock in profit)

### Price Monitoring

- Runs every minute via cron job in `src/index.js`
- Modify cron schedule: Change `'*/1 * * * *'` in cron.schedule() call
- Examples: `'*/30 * * * * *'` (every 30s), `'*/5 * * * *'` (every 5min)

### Wallet Manager Security

- Private keys loaded from environment variables only
- Never commit .env file or expose private keys
- Use dedicated wallets with limited funds for auto-trading
- Wallet encryption/decryption methods available but not currently used

### Chain-Specific Notes

**BSC**:
- Uses PancakeSwap router for on-chain price queries and trades
- Queries prices directly from liquidity pools via ethers.js
- **DO NOT** use DexScreener or CoinGecko APIs

**Solana**:
- Uses Raydium SDK for on-chain price queries (AMM V4, CPMM, CLMM pools)
- Uses Jupiter aggregator API as fallback for price queries
- Automatic pool discovery and caching for optimal performance
- **DO NOT** use DexScreener or CoinGecko APIs

**Base**:
- Uses Uniswap V4 pools for on-chain price queries
- Requires `pair_address` for each token (LP pair address)
- **DO NOT** use DexScreener or CoinGecko APIs

**Price Query Priority:**
1. On-chain queries via RPC (most reliable, no rate limits)
2. DEX aggregator APIs (Jupiter for Solana) as fallback
3. **NEVER** use centralized price APIs (DexScreener, CoinGecko, CoinMarketCap)

## Development Guidelines

### Adding New Chains

1. Create price monitor in `src/services/priceMonitor/`
2. Create trade executor in `src/services/tradeExecutor/`
3. Add RPC config to `src/config/config.js`
4. Add wallet support to `src/services/walletManager.js`
5. Update chain switch statements in `src/index.js` and `src/services/orderService.js`

### Modifying Order Logic

Order execution logic is in `src/services/orderService.js`:
- `checkAndExecuteOrder()` - Condition checking
- `executeOrder()` - Execution and notification
- `executeTrade()` - On-chain trade execution (if AUTO_TRADE_ENABLED)

### Database Migrations

This project does not have a formal migration system. To modify schema:
1. Update `src/database/init.js` with new schema
2. Either manually ALTER existing database or delete and reinitialize
3. Test with `npm run init-db`

### Testing

No formal test suite currently exists. Manual testing recommended:
1. Test with `AUTO_TRADE_ENABLED=false` first
2. Use testnet RPCs for blockchain testing
3. Verify notifications work before enabling auto-trading
4. Test with small amounts on mainnet

## Frontend

Static files in `public/`:
- `index.html` - Main UI with tabs for tokens, orders, alerts, price monitoring
- `js/app.js` - Frontend JavaScript using Axios for API calls
- `css/style.css` - Styling

Frontend communicates with backend via REST API endpoints.
