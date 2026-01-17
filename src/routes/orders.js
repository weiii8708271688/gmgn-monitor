import express from 'express';
import OrderService from '../services/orderService.js';
import logger from '../utils/logger.js';

const router = express.Router();
const orderService = new OrderService();

// 獲取所有訂單
router.get('/', (req, res) => {
  try {
    const orders = orderService.getAllOrders();
    res.json({ success: true, data: orders });
  } catch (error) {
    logger.error('獲取訂單列表失敗:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// 獲取活躍訂單
router.get('/active', (req, res) => {
  try {
    const orders = orderService.getActiveOrders();
    res.json({ success: true, data: orders });
  } catch (error) {
    logger.error('獲取活躍訂單失敗:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// 建立新訂單
router.post('/', (req, res) => {
  try {
    const { token_id, type, target_price } = req.body;

    // 驗證必填欄位
    if (!token_id || !type || !target_price) {
      return res.status(400).json({
        success: false,
        error: '缺少必填欄位: token_id, type, target_price',
      });
    }

    // 驗證訂單類型
    const validTypes = ['limit_buy', 'limit_sell', 'stop_loss', 'take_profit'];
    if (!validTypes.includes(type)) {
      return res.status(400).json({
        success: false,
        error: `無效的訂單類型。有效類型: ${validTypes.join(', ')}`,
      });
    }

    const order = orderService.createOrder({ token_id, type, target_price });
    res.json({ success: true, data: order });
  } catch (error) {
    logger.error('建立訂單失敗:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// 取消訂單
router.patch('/:id/cancel', (req, res) => {
  try {
    orderService.cancelOrder(req.params.id);
    res.json({ success: true, message: '訂單已取消' });
  } catch (error) {
    logger.error('取消訂單失敗:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// 刪除訂單
router.delete('/:id', (req, res) => {
  try {
    orderService.deleteOrder(req.params.id);
    res.json({ success: true, message: '訂單已刪除' });
  } catch (error) {
    logger.error('刪除訂單失敗:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
