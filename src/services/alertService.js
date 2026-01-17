import db from '../database/db.js';
import logger from '../utils/logger.js';
import TelegramNotification from './notification/telegram.js';
import TelegramWebhookNotification from './notification/telegramWebhook.js';
import LINENotification from './notification/line.js';
import marketDataService from './marketDataService.js';
import { getTaiwanISOString } from '../utils/timeHelper.js';

class AlertService {
  constructor() {
    this.telegram = new TelegramNotification();
    this.telegramWebhook = new TelegramWebhookNotification();
    this.line = new LINENotification();
  }

  /**
   * 建立新提醒
   * @param {Object} alertData - 提醒資料
   * @returns {Object} 建立的提醒
   */
  createAlert(alertData) {
    try {
      const { token_id, condition, target_price, alert_type = 'price', unit = '' } = alertData;

      const stmt = db.prepare(`
        INSERT INTO alerts (token_id, condition, target_price, status, alert_type, unit)
        VALUES (?, ?, ?, 'active', ?, ?)
      `);

      const result = stmt.run(token_id, condition, target_price, alert_type, unit);

      logger.success(`提醒已建立 (ID: ${result.lastInsertRowid}, 類型: ${alert_type})`);

      return {
        id: result.lastInsertRowid,
        ...alertData,
        status: 'active',
        created_at: new Date().toISOString(),
      };
    } catch (error) {
      logger.error('建立提醒失敗:', error.message);
      throw error;
    }
  }

  /**
   * 獲取所有活躍提醒
   * @returns {Array} 提醒列表
   */
  getActiveAlerts() {
    try {
      const stmt = db.prepare(`
        SELECT a.*, t.symbol, t.chain, t.address
        FROM alerts a
        JOIN tokens t ON a.token_id = t.id
        WHERE a.status = 'active'
      `);

      return stmt.all();
    } catch (error) {
      logger.error('獲取活躍提醒失敗:', error.message);
      throw error;
    }
  }

  /**
   * 獲取所有提醒
   * @returns {Array} 提醒列表
   */
  getAllAlerts() {
    try {
      const stmt = db.prepare(`
        SELECT a.*, t.symbol, t.chain, t.address
        FROM alerts a
        JOIN tokens t ON a.token_id = t.id
        ORDER BY a.created_at DESC
      `);

      return stmt.all();
    } catch (error) {
      logger.error('獲取所有提醒失敗:', error.message);
      throw error;
    }
  }

  /**
   * 檢查並觸發提醒
   * @param {number} alertId - 提醒 ID
   * @param {number} currentPrice - 當前價格
   * @param {Object} tokenInfo - 代幣資訊（包含 chain, address）
   * @returns {Promise<boolean>} 是否觸發
   */
  async checkAndTriggerAlert(alertId, currentPrice, tokenInfo = null) {
    try {
      const alert = db.prepare('SELECT * FROM alerts WHERE id = ?').get(alertId);

      if (!alert || alert.status !== 'active') {
        return false;
      }

      let shouldTrigger = false;
      let checkValue = currentPrice;

      // 如果是市值提醒，需要獲取市值資料
      if (alert.alert_type === 'marketcap') {
        if (!tokenInfo) {
          // 從數據庫獲取代幣資訊
          tokenInfo = db.prepare('SELECT chain, address FROM tokens WHERE id = ?').get(alert.token_id);
        }

        if (tokenInfo) {
          try {
            const marketData = await marketDataService.getMarketData(tokenInfo.chain, tokenInfo.address);
            if (marketData.marketCap) {
              checkValue = marketData.marketCap;
              logger.info(`檢查市值提醒 (ID: ${alertId}): 當前 ${checkValue} vs 目標 ${alert.target_price}`);
            } else {
              logger.warn(`無法獲取市值資料 (Alert ID: ${alertId})`);
              return false;
            }
          } catch (error) {
            logger.error(`獲取市值失敗 (Alert ID: ${alertId}):`, error.message);
            return false;
          }
        }
      }

      // 檢查提醒條件
      switch (alert.condition) {
        case 'above':
          // 高於目標
          shouldTrigger = checkValue >= alert.target_price;
          break;
        case 'below':
          // 低於目標
          shouldTrigger = checkValue <= alert.target_price;
          break;
        case 'change_up':
          // 價格上漲達目標百分比
          // TODO: 需要比較歷史價格
          break;
        case 'change_down':
          // 價格下跌達目標百分比
          // TODO: 需要比較歷史價格
          break;
        default:
          logger.warn(`未知的提醒條件: ${alert.condition}`);
      }

      if (shouldTrigger) {
        await this.triggerAlert(alertId, checkValue);
        return true;
      }

      return false;
    } catch (error) {
      logger.error('檢查提醒失敗:', error.message);
      throw error;
    }
  }

  /**
   * 觸發提醒
   * @param {number} alertId - 提醒 ID
   * @param {number} currentValue - 當前值（價格或市值）
   */
  async triggerAlert(alertId, currentValue) {
    try {
      const stmt = db.prepare(`
        UPDATE alerts
        SET status = 'triggered',
            triggered_at = ?
        WHERE id = ?
      `);

      stmt.run(getTaiwanISOString(), alertId);

      // 獲取提醒詳情
      const alert = db.prepare(`
        SELECT a.*, t.symbol, t.chain, t.address
        FROM alerts a
        JOIN tokens t ON a.token_id = t.id
        WHERE a.id = ?
      `).get(alertId);

      // 根據提醒類型格式化顯示
      let displayValue = currentValue;
      let displayType = '價格';

      if (alert.alert_type === 'marketcap') {
        displayType = '市值';
        displayValue = marketDataService.formatMarketCap(currentValue, alert.unit || 'auto');
      } else {
        displayValue = `$${currentValue.toFixed(8)}`;
      }

      logger.success(`提醒已觸發 (ID: ${alertId}, ${displayType}: ${displayValue})`);

      // 準備通知內容
      const notification = {
        ...alert,
        currentValue: displayValue,
        displayType: displayType,
      };

      // 發送原本的 Telegram 通知
      if (alert.alert_type === 'marketcap') {
        // 為市值提醒自定義通知格式
        const message =
          `🔔 市值提醒觸發\n\n` +
          `代幣: ${alert.symbol}\n` +
          `條件: ${alert.condition === 'above' ? '高於' : '低於'}\n` +
          `目標${displayType}: ${marketDataService.formatMarketCap(alert.target_price, alert.unit)}\n` +
          `當前${displayType}: ${displayValue}\n` +
          `時間: ${new Date().toLocaleString('zh-TW')}`;

        await this.telegram.sendMessage(message);
        await this.telegramWebhook.sendMessage(message);
      } else {
        this.telegram.sendPriceAlert(alert, currentValue);
        this.telegramWebhook.sendPriceAlert(alert, currentValue);
      }
    } catch (error) {
      logger.error('觸發提醒失敗:', error.message);
      throw error;
    }
  }

  /**
   * 取消提醒
   * @param {number} alertId - 提醒 ID
   */
  cancelAlert(alertId) {
    try {
      const stmt = db.prepare(`
        UPDATE alerts
        SET status = 'cancelled'
        WHERE id = ? AND status = 'active'
      `);

      const result = stmt.run(alertId);

      if (result.changes === 0) {
        throw new Error('提醒不存在或已觸發');
      }

      logger.info(`提醒已取消 (ID: ${alertId})`);
    } catch (error) {
      logger.error('取消提醒失敗:', error.message);
      throw error;
    }
  }

  /**
   * 刪除提醒
   * @param {number} alertId - 提醒 ID
   */
  deleteAlert(alertId) {
    try {
      const stmt = db.prepare('DELETE FROM alerts WHERE id = ?');
      const result = stmt.run(alertId);

      if (result.changes === 0) {
        throw new Error('提醒不存在');
      }

      logger.info(`提醒已刪除 (ID: ${alertId})`);
    } catch (error) {
      logger.error('刪除提醒失敗:', error.message);
      throw error;
    }
  }
}

export default AlertService;
