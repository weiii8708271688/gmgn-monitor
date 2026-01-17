import express from 'express';
import walletBalanceMonitor from '../services/walletBalanceMonitor.js';
import logger from '../utils/logger.js';

const router = express.Router();

/**
 * GET /api/wallet/balance/history
 * 獲取錢包餘額歷史記錄
 */
router.get('/balance/history', (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 100;
    const history = walletBalanceMonitor.getBalanceHistory(limit);

    res.json({
      success: true,
      data: history,
    });
  } catch (error) {
    logger.error('獲取餘額歷史失敗:', error.message);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * GET /api/wallet/balance/latest
 * 獲取即時餘額（即時查詢區塊鏈）
 */
router.get('/balance/latest', async (req, res) => {
  try {
    const currentBalance = await walletBalanceMonitor.getCurrentBalance();
    logger.info(`即時餘額: ${currentBalance.balance.toFixed(6)} BNB`);
    res.json({
      success: true,
      data: currentBalance,
    });
  } catch (error) {
    logger.error('獲取即時餘額失敗:', error.message);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * GET /api/wallet/balance/latest-history
 * 獲取最新的歷史記錄（從資料庫讀取）
 */
router.get('/balance/latest-history', (req, res) => {
  try {
    const latest = walletBalanceMonitor.getLatestHistoryRecord();
    res.json({
      success: true,
      data: latest,
    });
  } catch (error) {
    logger.error('獲取最新歷史記錄失敗:', error.message);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * POST /api/wallet/balance/record
 * 手動記錄當前餘額
 */
router.post('/balance/record', async (req, res) => {
  try {
    const result = await walletBalanceMonitor.recordBalance();

    res.json({
      success: true,
      data: result,
    });
  } catch (error) {
    logger.error('記錄餘額失敗:', error.message);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

export default router;
