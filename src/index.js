import express from 'express';
import cors from 'cors';
import cron from 'node-cron';
import config from './config/config.js';
import logger from './utils/logger.js';
import TelegramNotification from './services/notification/telegram.js';
import OrderService from './services/orderService.js';
import AlertService from './services/alertService.js';
import BSCPriceMonitor from './services/priceMonitor/bsc.js';
import SolanaPriceMonitor from './services/priceMonitor/solana.js';
import BasePriceMonitor from './services/priceMonitor/base.js';
import walletManager from './services/walletManager.js';
import db from './database/db.js';
import * as gmgnMonitor from './services/gmgnMonitor.js';
import { toTaiwanString } from './utils/timeHelper.js';
import walletBalanceMonitor from './services/walletBalanceMonitor.js';

// 引入路由
import tokensRouter from './routes/tokens.js';
import ordersRouter from './routes/orders.js';
import alertsRouter from './routes/alerts.js';
import priceRouter from './routes/price.js';
import marketRouter from './routes/market.js';
import gmgnRouter from './routes/gmgn.js';
import walletRouter from './routes/wallet.js';

const app = express();

// 中間件
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// 服務實例
const telegram = new TelegramNotification();
const orderService = new OrderService();
const alertService = new AlertService();
const monitors = {
  bsc: new BSCPriceMonitor(),
  solana: new SolanaPriceMonitor(),
  base: new BasePriceMonitor(),
};

// 初始化服務
async function initializeServices() {
  logger.info('正在初始化服務...');

  // 初始化錢包管理器
  try {
    await walletManager.initialize();
  } catch (error) {
    logger.error('錢包管理器初始化失敗:', error.message);
    logger.warn('自動交易功能將無法使用');
  }

  // 初始化訂單服務
  await orderService.initialize();

  // 初始化 GMGN 監控資料庫
  gmgnMonitor.initDatabase();

  logger.success('服務初始化完成');
}

// API 路由
app.use('/api/tokens', tokensRouter);
app.use('/api/orders', ordersRouter);
app.use('/api/alerts', alertsRouter);
app.use('/api/price', priceRouter);
app.use('/api/market', marketRouter);
app.use('/api/gmgn', gmgnRouter);
app.use('/api/wallet', walletRouter);

// 健康檢查
app.get('/api/health', (req, res) => {
  res.json({
    success: true,
    status: 'running',
    timestamp: toTaiwanString(),
  });
});

// 系統狀態
app.get('/api/status', (req, res) => {
  try {
    const stats = {
      tokens: db.prepare('SELECT COUNT(*) as count FROM tokens').get().count,
      activeOrders: db.prepare("SELECT COUNT(*) as count FROM orders WHERE status = 'active'").get().count,
      activeAlerts: db.prepare("SELECT COUNT(*) as count FROM alerts WHERE status = 'active'").get().count,
      uptime: process.uptime(),
      timestamp: toTaiwanString(),
    };

    res.json({ success: true, data: stats });
  } catch (error) {
    logger.error('獲取系統狀態失敗:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// 測試通知發送
app.post('/api/test-notification', async (req, res) => {
  try {
    const message =
      `🧪 *測試通知*\n\n` +
      `這是一則測試訊息\n` +
      `時間: ${toTaiwanString()}\n\n` +
      `✅ 通知系統運作正常！`;

    await telegram.sendMessage(message);

    res.json({
      success: true,
      message: '測試訊息已發送，請檢查 Telegram'
    });
  } catch (error) {
    logger.error('測試通知發送失敗:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * 價格監控任務
 */
async function monitorPrices() {
  try {
    logger.info('執行價格監控任務...');

    // 獲取所有需要監控的代幣
    const tokens = db.prepare('SELECT * FROM tokens').all();

    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i];

      // 🔥 Base 鏈需要額外等待時間（避免 RPC 限制）
      if (i > 0 && token.chain.toLowerCase() === 'base') {
        logger.debug('Base 鏈查詢等待 10 秒...');
        await new Promise(resolve => setTimeout(resolve, 10000));
      }

      try {
        let tokenInfo = null;
        const monitor = monitors[token.chain.toLowerCase()];

        if (!monitor) {
          logger.warn(`不支援的鏈: ${token.chain}`);
          continue;
        }

        // 🔥 準備快取的池子資訊
        const cachedPoolInfo = token.pool_address ? {
          poolAddress: token.pool_address,
          version: token.pool_version,
          protocol: token.pool_protocol,
          pairToken: token.pool_pair_token,
        } : null;

        // 獲取價格和市值信息
        switch (token.chain.toLowerCase()) {
          case 'bsc':
            tokenInfo = await monitor.getTokenInfo(token.address, token.decimals);
            break;
          case 'solana':
            // Solana 使用快取的池子資訊（如果有的話）
            if (cachedPoolInfo && cachedPoolInfo.poolAddress) {
              tokenInfo = await monitor.getTokenInfoWithCachedPool(token.address, cachedPoolInfo);
            } else {
              tokenInfo = await monitor.getTokenInfo(token.address);
            }
            break;
          case 'base':
            // Base 使用快取的池子資訊（如果有的話）
            if (cachedPoolInfo && cachedPoolInfo.poolAddress) {
              // 直接獲取價格，不需要重新查找池子
              const priceInUSD = await monitor.getPriceWithCachedPool(token.address, token.decimals, cachedPoolInfo);

              // 獲取市值信息
              const tokenContract = new (await import('ethers')).ethers.Contract(
                token.address,
                ['function totalSupply() external view returns (uint256)'],
                monitor.provider
              );
              const totalSupply = await tokenContract.totalSupply();
              const totalSupplyFormatted = Number((await import('ethers')).ethers.formatUnits(totalSupply, token.decimals));
              const marketCap = priceInUSD * totalSupplyFormatted;

              let marketCapFormatted;
              if (marketCap >= 1_000_000) {
                marketCapFormatted = `$${(marketCap / 1_000_000).toFixed(2)}M`;
              } else if (marketCap >= 1_000) {
                marketCapFormatted = `$${(marketCap / 1_000).toFixed(2)}K`;
              } else {
                marketCapFormatted = `$${marketCap.toFixed(2)}`;
              }

              tokenInfo = { priceUSD: priceInUSD, marketCap, marketCapFormatted, totalSupply: totalSupplyFormatted };
            } else if (token.pair_address) {
              tokenInfo = await monitor.getTokenInfoWithPair(token.pair_address, token.address, token.decimals);
            } else {
              tokenInfo = await monitor.getTokenInfo(token.address, token.decimals);
            }
            break;
        }

        if (!tokenInfo || tokenInfo.priceUSD === null) {
          continue;
        }

        // 記錄 USD 價格歷史
        db.prepare(`
          INSERT INTO price_history (token_id, price)
          VALUES (?, ?)
        `).run(token.id, tokenInfo.priceUSD);

        // 檢查活躍訂單
        const activeOrders = orderService.getActiveOrders().filter(
          (order) => order.token_id === token.id
        );

        for (const order of activeOrders) {
          orderService.updateOrderPrice(order.id, tokenInfo.priceUSD);
          orderService.checkAndExecuteOrder(order.id, tokenInfo.priceUSD);
        }

        // 檢查活躍提醒
        const activeAlerts = alertService.getActiveAlerts().filter(
          (alert) => alert.token_id === token.id
        );

        for (const alert of activeAlerts) {
          await alertService.checkAndTriggerAlert(alert.id, tokenInfo.priceUSD, {
            chain: token.chain,
            address: token.address,
          });
        }

        logger.debug(
          `${token.symbol} (${token.chain}): $${tokenInfo.priceUSD.toFixed(8)} | 市值: ${tokenInfo.marketCapFormatted}`
        );
      } catch (error) {
        logger.error(`監控 ${token.symbol} 價格失敗:`, error.message);
      }
    }

    logger.info('價格監控任務完成');
  } catch (error) {
    logger.error('價格監控任務失敗:', error.message);
  }
}

// 設定定時任務（每分鐘執行一次）
cron.schedule('*/1 * * * *', monitorPrices);

// 設定 GMGN 監控任務（每 1 秒執行一次）
cron.schedule('*/1 * * * * *', async () => {
  try {
    await gmgnMonitor.monitorNewTokens();
  } catch (error) {
    logger.error('GMGN 監控任務失敗:', error.message);
  }
});

// 設定錢包餘額記錄任務（每天中午12點和凌晨12點）
cron.schedule('0 0,12 * * *', async () => {
  try {
    logger.info('執行錢包餘額記錄任務...');
    await walletBalanceMonitor.recordBalance();
  } catch (error) {
    logger.error('錢包餘額記錄任務失敗:', error.message);
  }
});

// 啟動 Telegram Bot
telegram.launch().catch((error) => {
  logger.error('啟動 Telegram Bot 失敗:', error.message);
});

// 啟動服務器
const PORT = config.server.port;
app.listen(PORT, async () => {
  logger.success(`🚀 服務器運行在 http://localhost:${PORT}`);

  // 初始化服務
  await initializeServices();

  logger.info('價格監控任務已啟動（每分鐘執行一次）');
  logger.info('按 Ctrl+C 停止服務');

  // 立即執行一次價格監控
  setTimeout(monitorPrices, 5000);
});

// 優雅關閉
process.on('SIGINT', () => {
  logger.info('正在關閉服務器...');
  db.close();
  process.exit(0);
});

process.on('SIGTERM', () => {
  logger.info('正在關閉服務器...');
  db.close();
  process.exit(0);
});
