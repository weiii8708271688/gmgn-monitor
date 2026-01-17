import express from 'express';
import AlertService from '../services/alertService.js';
import logger from '../utils/logger.js';

const router = express.Router();
const alertService = new AlertService();

// 獲取所有提醒
router.get('/', (req, res) => {
  try {
    const alerts = alertService.getAllAlerts();
    res.json({ success: true, data: alerts });
  } catch (error) {
    logger.error('獲取提醒列表失敗:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// 獲取活躍提醒
router.get('/active', (req, res) => {
  try {
    const alerts = alertService.getActiveAlerts();
    res.json({ success: true, data: alerts });
  } catch (error) {
    logger.error('獲取活躍提醒失敗:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// 建立新提醒
router.post('/', (req, res) => {
  try {
    const { token_id, condition, target_price, alert_type, unit } = req.body;

    // 驗證必填欄位
    if (!token_id || !condition || !target_price) {
      return res.status(400).json({
        success: false,
        error: '缺少必填欄位: token_id, condition, target_price',
      });
    }

    // 驗證條件類型
    const validConditions = ['above', 'below', 'change_up', 'change_down'];
    if (!validConditions.includes(condition)) {
      return res.status(400).json({
        success: false,
        error: `無效的提醒條件。有效條件: ${validConditions.join(', ')}`,
      });
    }

    // 驗證提醒類型
    const validAlertTypes = ['price', 'marketcap'];
    if (alert_type && !validAlertTypes.includes(alert_type)) {
      return res.status(400).json({
        success: false,
        error: `無效的提醒類型。有效類型: ${validAlertTypes.join(', ')}`,
      });
    }

    logger.info(`建立提醒: 類型=${alert_type || 'price'}, 單位=${unit || ''}, 目標=${target_price}`);

    const alert = alertService.createAlert({
      token_id,
      condition,
      target_price,
      alert_type: alert_type || 'price',
      unit: unit || ''
    });
    res.json({ success: true, data: alert });
  } catch (error) {
    logger.error('建立提醒失敗:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// 取消提醒
router.patch('/:id/cancel', (req, res) => {
  try {
    alertService.cancelAlert(req.params.id);
    res.json({ success: true, message: '提醒已取消' });
  } catch (error) {
    logger.error('取消提醒失敗:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// 刪除提醒
router.delete('/:id', (req, res) => {
  try {
    alertService.deleteAlert(req.params.id);
    res.json({ success: true, message: '提醒已刪除' });
  } catch (error) {
    logger.error('刪除提醒失敗:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
