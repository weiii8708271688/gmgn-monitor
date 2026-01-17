import { Telegraf } from 'telegraf';
import config from '../../config/config.js';
import logger from '../../utils/logger.js';
import { toTaiwanString } from '../../utils/timeHelper.js';

class TelegramNotification {
  constructor() {
    if (!config.telegram.botToken) {
      logger.warn('Telegram Bot Token 未設定，通知功能將無法使用');
      this.enabled = false;
      return;
    }

    this.bot = new Telegraf(config.telegram.botToken);
    this.chatId = config.telegram.chatId;
    this.enabled = true;

    // 設定基本命令
    this.setupCommands();
  }

  setupCommands() {
    this.bot.start((ctx) => {
      ctx.reply('歡迎使用加密貨幣交易機器人！\n\n可用命令:\n/help - 顯示幫助\n/status - 查看系統狀態');
    });

    this.bot.help((ctx) => {
      ctx.reply(
        '📊 *加密貨幣交易機器人* \n\n' +
        '可用命令：\n' +
        '/start - 開始使用\n' +
        '/help - 顯示此幫助訊息\n' +
        '/status - 查看系統狀態\n\n' +
        '您將收到以下通知：\n' +
        '• 價格提醒觸發\n' +
        '• 掛單執行\n' +
        '• 系統警告',
        { parse_mode: 'Markdown' }
      );
    });

    this.bot.command('status', (ctx) => {
      ctx.reply('系統運行中 ✅');
    });
  }

  async launch() {
    if (!this.enabled) {
      return;
    }

    try {
      await this.bot.launch();
      logger.success('Telegram Bot 已啟動');

      // 啟用優雅關閉
      process.once('SIGINT', () => this.bot.stop('SIGINT'));
      process.once('SIGTERM', () => this.bot.stop('SIGTERM'));
    } catch (error) {
      logger.error('Telegram Bot 啟動失敗:', error.message);
    }
  }

  /**
   * 發送訊息
   * @param {string} message - 訊息內容
   * @param {Object} options - 選項
   */
  async sendMessage(message, options = {}) {
    if (!this.enabled || !this.chatId) {
      logger.warn('Telegram 通知未啟用或 Chat ID 未設定');
      return;
    }

    try {
      await this.bot.telegram.sendMessage(this.chatId, message, {
        parse_mode: 'Markdown',
        ...options,
      });
      logger.info('Telegram 訊息已發送');
    } catch (error) {
      logger.error('發送 Telegram 訊息失敗:', error.message);
    }
  }

  /**
   * 發送價格提醒
   * @param {Object} alert - 提醒資訊
   * @param {number} currentPrice - 當前價格
   */
  async sendPriceAlert(alert, currentPrice) {
    const message =
      `🔔 *價格提醒觸發*\n\n` +
      `代幣: ${alert.symbol}\n` +
      `條件: ${alert.condition}\n` +
      `目標價格: ${alert.target_price}\n` +
      `當前價格: ${currentPrice}\n` +
      `時間: ${toTaiwanString()}`;

    await this.sendMessage(message);
  }

  /**
   * 發送掛單執行通知
   * @param {Object} order - 訂單資訊
   */
  async sendOrderExecuted(order) {
    const message =
      `✅ *掛單已執行*\n\n` +
      `代幣: ${order.symbol}\n` +
      `類型: ${order.type}\n` +
      `目標價格: ${order.target_price}\n` +
      `執行價格: ${order.current_price}\n` +
      `時間: ${toTaiwanString()}`;

    await this.sendMessage(message);
  }

  /**
   * 發送錯誤通知
   * @param {string} error - 錯誤訊息
   */
  async sendError(error) {
    const message = `⚠️ *系統錯誤*\n\n${error}`;
    await this.sendMessage(message);
  }
}

export default TelegramNotification;
