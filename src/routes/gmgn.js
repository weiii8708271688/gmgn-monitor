import express from 'express';
import * as gmgnMonitor from '../services/gmgnMonitor.js';
import logger from '../utils/logger.js';

const router = express.Router();

/**
 * GET /api/gmgn/status
 * 獲取監控狀態
 */
router.get('/status', (req, res) => {
  try {
    const status = gmgnMonitor.getMonitoringStatus();
    res.json({
      success: true,
      data: status
    });
  } catch (error) {
    logger.error('獲取監控狀態失敗:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/gmgn/toggle
 * 開啟/關閉監控
 * Body: { enabled: boolean }
 */
router.post('/toggle', (req, res) => {
  try {
    const { enabled } = req.body;

    if (typeof enabled !== 'boolean') {
      return res.status(400).json({
        success: false,
        error: 'enabled 參數必須是 boolean 類型'
      });
    }

    const result = gmgnMonitor.setMonitoringStatus(enabled);
    logger.info(`GMGN 監控已${enabled ? '開啟' : '關閉'}`);

    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    logger.error('切換監控狀態失敗:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/gmgn/auth-token
 * 設置 Auth Token
 * Body: { token: string }
 */
router.post('/auth-token', (req, res) => {
  try {
    const { token } = req.body;

    if (!token || typeof token !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'token 參數是必須的'
      });
    }

    gmgnMonitor.updateAuthToken(token);
    logger.info('GMGN Auth Token 已更新');

    res.json({
      success: true,
      message: 'Auth Token 已設置'
    });
  } catch (error) {
    logger.error('設置 Auth Token 失敗:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/gmgn/tokens
 * 獲取已監控的代幣列表
 * Query: limit (optional, default: 50)
 */
router.get('/tokens', (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 50;
    const tokens = gmgnMonitor.getMonitoredTokens(limit);

    res.json({
      success: true,
      data: tokens
    });
  } catch (error) {
    logger.error('獲取監控代幣列表失敗:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/gmgn/statistics
 * 獲取統計信息
 */
router.get('/statistics', (req, res) => {
  try {
    const stats = gmgnMonitor.getStatistics();

    res.json({
      success: true,
      data: stats
    });
  } catch (error) {
    logger.error('獲取統計信息失敗:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/gmgn/check-now
 * 立即執行一次檢查
 */
router.post('/check-now', async (req, res) => {
  try {
    logger.info('手動觸發 GMGN 檢查');
    const result = await gmgnMonitor.monitorNewTokens();

    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    logger.error('執行檢查失敗:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * DELETE /api/gmgn/clean-old
 * 清除舊記錄（7天前）
 */
router.delete('/clean-old', (req, res) => {
  try {
    const result = gmgnMonitor.cleanOldRecords();
    logger.info(`清除了 ${result.deleted} 條舊記錄`);

    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    logger.error('清除舊記錄失敗:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
