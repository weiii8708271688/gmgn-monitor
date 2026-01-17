import axios from 'axios';
import config from '../../config/config.js';
import logger from '../../utils/logger.js';
import { toTaiwanString } from '../../utils/timeHelper.js';

class TelegramWebhookNotification {
  constructor() {
    if (!config.telegramWebhook.serverUrl) {
      logger.warn('Telegram Webhook Server URL 未設定，webhook 通知功能將無法使用');
      this.enabled = false;
      return;
    }

    this.serverUrl = config.telegramWebhook.serverUrl;
    this.chatId = config.telegramWebhook.chatId;
    this.enabled = true;

    logger.success('Telegram Webhook 通知服務已初始化');
  }

  /**
   * 發送訊息到 Flask webhook 服務器
   * @param {string} message - 訊息內容 (HTML 格式)
   */
  async sendMessage(message) {
    if (!this.enabled) {
      logger.warn('Telegram Webhook 通知未啟用');
      return;
    }

    try {
      const response = await axios.post(
        `${this.serverUrl}/send_price_alert`,
        {
          message: message,
        },
        {
          headers: {
            'Content-Type': 'application/json',
          },
          timeout: 10000, // 10秒超時
        }
      );

      if (response.data.success) {
        logger.info('Telegram Webhook 訊息已發送');
        return true;
      } else {
        logger.error('Telegram Webhook 發送失敗:', response.data.error);
        return false;
      }
    } catch (error) {
      logger.error('發送 Telegram Webhook 訊息失敗:', error.message);
      return false;
    }
  }

  /**
   * 發送郵件警報
   * @param {string} subject - 郵件主題
   * @param {string} body - 郵件內容
   */
  async sendEmailAlert(subject, body) {
    if (!this.enabled) {
      logger.warn('Telegram Webhook 通知未啟用');
      return;
    }

    try {
      const response = await axios.post(
        `${this.serverUrl}/send_email_alert`,
        {
          subject: subject,
          body: body,
        },
        {
          headers: {
            'Content-Type': 'application/json',
          },
          timeout: 10000,
        }
      );

      if (response.data.status === 'success') {
        logger.info('郵件警報已發送');
        return true;
      } else {
        logger.error('郵件警報發送失敗:', response.data.message);
        return false;
      }
    } catch (error) {
      logger.error('發送郵件警報失敗:', error.message);
      return false;
    }
  }

  /**
   * 發送價格提醒
   * @param {Object} alert - 提醒資訊
   * @param {number} currentPrice - 當前價格
   */
  async sendPriceAlert(alert, currentPrice) {
    const message =
      `⚠️ <b>價格警報觸發</b> ⚠️\n\n` +
      `💎 <b>代幣資訊</b> 💎\n` +
      `🌟名稱: <b>${alert.symbol}</b>\n` +
      `💫地址: <code>${alert.address || 'N/A'}</code>\n` +
      `💲當前價格: <b>${currentPrice}</b>\n` +
      `🔔 警報條件: <b>${alert.condition}</b>\n` +
      `🎯 目標價格: <b>${alert.target_price}</b>\n` +
      `⏰ 時間: ${toTaiwanString()}\n\n` +
      `🔔 警報已觸發，請注意價格變動`;

    await this.sendMessage(message);

    // 同時發送郵件
    const emailSubject = `價格警報 - ${alert.symbol}`;
    const emailBody =
      `代幣: ${alert.symbol}\n` +
      `條件: ${alert.condition}\n` +
      `目標價格: ${alert.target_price}\n` +
      `當前價格: ${currentPrice}\n` +
      `時間: ${toTaiwanString()}`;

    await this.sendEmailAlert(emailSubject, emailBody);
  }

  /**
   * 發送掛單執行通知
   * @param {Object} order - 訂單資訊
   */
  async sendOrderExecuted(order) {
    const orderTypeEmoji = {
      'limit_buy': '🟢',
      'limit_sell': '🔴',
      'stop_loss': '🛑',
      'take_profit': '💰',
    };

    const emoji = orderTypeEmoji[order.type] || '📊';
    const typeText = {
      'limit_buy': '限價買入',
      'limit_sell': '限價賣出',
      'stop_loss': '止損',
      'take_profit': '止盈',
    }[order.type] || order.type;

    const message =
      `${emoji} <b>掛單已執行</b> ${emoji}\n\n` +
      `💎 <b>代幣資訊</b> 💎\n` +
      `🌟名稱: <b>${order.symbol}</b>\n` +
      `💫地址: <code>${order.address || 'N/A'}</code>\n` +
      `📋 訂單類型: <b>${typeText}</b>\n` +
      `🎯 目標價格: <b>${order.target_price}</b>\n` +
      `💲執行價格: <b>${order.current_price}</b>\n` +
      `⏰ 執行時間: ${toTaiwanString()}\n\n` +
      `✅ 訂單已成功執行`;

    await this.sendMessage(message);

    // 同時發送郵件
    const emailSubject = `訂單執行 - ${order.symbol} (${typeText})`;
    const emailBody =
      `代幣: ${order.symbol}\n` +
      `類型: ${typeText}\n` +
      `目標價格: ${order.target_price}\n` +
      `執行價格: ${order.current_price}\n` +
      `時間: ${toTaiwanString()}`;

    await this.sendEmailAlert(emailSubject, emailBody);
  }

  /**
   * 發送錯誤通知
   * @param {string} error - 錯誤訊息
   */
  async sendError(error) {
    const message =
      `⚠️ <b>系統錯誤</b> ⚠️\n\n` +
      `❌ 錯誤訊息:\n` +
      `<code>${error}</code>\n\n` +
      `⏰ 時間: ${toTaiwanString()}`;

    await this.sendMessage(message);

    // 同時發送郵件
    await this.sendEmailAlert('系統錯誤通知', error);
  }

  /**
   * 發送一般價格更新消息
   * @param {Object} data - 價格數據
   */
  async sendPriceUpdate(data) {
    const { tokenName, tokenAddress, currentPrice, priceChange, priceType } = data;
    const price_emoji = priceType === 'down' ? '🔻' : '🔺';

    const message =
      `🚨 <b>價格更新通知</b> 🚨\n\n` +
      `💎 <b>代幣資訊</b> 💎\n` +
      `🌟名稱: <b>${tokenName}</b>\n` +
      `💫地址: <code>${tokenAddress}</code>\n` +
      `💲當前價格: <b>${currentPrice}</b>\n` +
      `${price_emoji} 價格變化: <b>${priceChange}</b>\n\n` +
      `⏰ 時間: ${toTaiwanString()}`;

    await this.sendMessage(message);
  }

  /**
   * 測試連接
   */
  async testConnection() {
    if (!this.enabled) {
      return { success: false, message: 'Webhook 未啟用' };
    }

    try {
      const response = await axios.get(`${this.serverUrl}/health`, {
        timeout: 5000,
      });

      if (response.data.status === 'OK') {
        logger.success('Telegram Webhook 服務器連接正常');
        return { success: true, message: '連接成功' };
      }
    } catch (error) {
      logger.error('Telegram Webhook 服務器連接失敗:', error.message);
      return { success: false, message: error.message };
    }
  }
}

export default TelegramWebhookNotification;
