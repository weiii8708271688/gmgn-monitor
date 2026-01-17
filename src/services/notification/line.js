import { Client } from '@line/bot-sdk';
import config from '../../config/config.js';
import logger from '../../utils/logger.js';
import { toTaiwanString } from '../../utils/timeHelper.js';

class LINENotification {
  constructor() {
    if (!config.line.channelAccessToken || !config.line.channelSecret) {
      logger.warn('LINE Bot 設定未完成，通知功能將無法使用');
      this.enabled = false;
      return;
    }

    this.client = new Client({
      channelAccessToken: config.line.channelAccessToken,
      channelSecret: config.line.channelSecret,
    });
    this.enabled = true;
  }

  /**
   * 推送訊息給用戶
   * @param {string} userId - 用戶 ID
   * @param {string} message - 訊息內容
   */
  async pushMessage(userId, message) {
    if (!this.enabled) {
      logger.warn('LINE 通知未啟用');
      return;
    }

    try {
      await this.client.pushMessage(userId, {
        type: 'text',
        text: message,
      });
      logger.info('LINE 訊息已發送');
    } catch (error) {
      logger.error('發送 LINE 訊息失敗:', error.message);
    }
  }

  /**
   * 發送價格提醒
   * @param {string} userId - 用戶 ID
   * @param {Object} alert - 提醒資訊
   * @param {number} currentPrice - 當前價格
   */
  async sendPriceAlert(userId, alert, currentPrice) {
    const message =
      `🔔 價格提醒觸發\n\n` +
      `代幣: ${alert.symbol}\n` +
      `條件: ${alert.condition}\n` +
      `目標價格: ${alert.target_price}\n` +
      `當前價格: ${currentPrice}\n` +
      `時間: ${toTaiwanString()}`;

    await this.pushMessage(userId, message);
  }

  /**
   * 發送掛單執行通知
   * @param {string} userId - 用戶 ID
   * @param {Object} order - 訂單資訊
   */
  async sendOrderExecuted(userId, order) {
    const message =
      `✅ 掛單已執行\n\n` +
      `代幣: ${order.symbol}\n` +
      `類型: ${order.type}\n` +
      `目標價格: ${order.target_price}\n` +
      `執行價格: ${order.current_price}\n` +
      `時間: ${toTaiwanString()}`;

    await this.pushMessage(userId, message);
  }

  /**
   * 發送錯誤通知
   * @param {string} userId - 用戶 ID
   * @param {string} error - 錯誤訊息
   */
  async sendError(userId, error) {
    const message = `⚠️ 系統錯誤\n\n${error}`;
    await this.pushMessage(userId, message);
  }

  /**
   * 發送 Flex Message（進階訊息格式）
   * @param {string} userId - 用戶 ID
   * @param {Object} flexMessage - Flex Message 內容
   */
  async sendFlexMessage(userId, flexMessage) {
    if (!this.enabled) {
      logger.warn('LINE 通知未啟用');
      return;
    }

    try {
      await this.client.pushMessage(userId, {
        type: 'flex',
        altText: flexMessage.altText || '通知訊息',
        contents: flexMessage.contents,
      });
      logger.info('LINE Flex 訊息已發送');
    } catch (error) {
      logger.error('發送 LINE Flex 訊息失敗:', error.message);
    }
  }
}

export default LINENotification;
