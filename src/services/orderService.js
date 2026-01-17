import db from '../database/db.js';
import logger from '../utils/logger.js';
import TelegramNotification from './notification/telegram.js';
import TelegramWebhookNotification from './notification/telegramWebhook.js';
import LINENotification from './notification/line.js';
import walletManager from './walletManager.js';
import BSCTradeExecutor from './tradeExecutor/bscExecutor.js';
import SolanaTradeExecutor from './tradeExecutor/solanaExecutor.js';
import BaseTradeExecutor from './tradeExecutor/baseExecutor.js';
import config from '../config/config.js';
import { getTaiwanISOString } from '../utils/timeHelper.js';

class OrderService {
  constructor() {
    this.telegram = new TelegramNotification();
    this.telegramWebhook = new TelegramWebhookNotification();
    this.line = new LINENotification();
    this.executors = {
      bsc: new BSCTradeExecutor(),
      solana: new SolanaTradeExecutor(),
      base: new BaseTradeExecutor(),
    };
    this.autoTradeEnabled = false;
  }

  /**
   * 初始化服務（載入配置）
   */
  async initialize() {
    // 檢查是否啟用自動交易
    this.autoTradeEnabled = process.env.AUTO_TRADE_ENABLED === 'true';

    if (this.autoTradeEnabled) {
      logger.warn('⚠️  自動交易功能已啟用！');
      logger.warn('請確保已經：');
      logger.warn('1. 設定私鑰');
      logger.warn('2. 配置交易限額');
      logger.warn('3. 充值足夠的 Gas 費用');
    } else {
      logger.info('自動交易功能未啟用（僅監控+通知）');
    }
  }

  /**
   * 建立新訂單
   * @param {Object} orderData - 訂單資料
   * @returns {Object} 建立的訂單
   */
  createOrder(orderData) {
    try {
      const { token_id, type, target_price } = orderData;

      const stmt = db.prepare(`
        INSERT INTO orders (token_id, type, target_price, status)
        VALUES (?, ?, ?, 'active')
      `);

      const result = stmt.run(token_id, type, target_price);

      logger.success(`訂單已建立 (ID: ${result.lastInsertRowid})`);

      return {
        id: result.lastInsertRowid,
        ...orderData,
        status: 'active',
        created_at: new Date().toISOString(),
      };
    } catch (error) {
      logger.error('建立訂單失敗:', error.message);
      throw error;
    }
  }

  /**
   * 獲取所有活躍訂單
   * @returns {Array} 訂單列表
   */
  getActiveOrders() {
    try {
      const stmt = db.prepare(`
        SELECT o.*, t.symbol, t.chain, t.address
        FROM orders o
        JOIN tokens t ON o.token_id = t.id
        WHERE o.status = 'active'
      `);

      return stmt.all();
    } catch (error) {
      logger.error('獲取活躍訂單失敗:', error.message);
      throw error;
    }
  }

  /**
   * 獲取所有訂單
   * @returns {Array} 訂單列表
   */
  getAllOrders() {
    try {
      const stmt = db.prepare(`
        SELECT o.*, t.symbol, t.chain, t.address
        FROM orders o
        JOIN tokens t ON o.token_id = t.id
        ORDER BY o.created_at DESC
      `);

      return stmt.all();
    } catch (error) {
      logger.error('獲取所有訂單失敗:', error.message);
      throw error;
    }
  }

  /**
   * 更新訂單當前價格
   * @param {number} orderId - 訂單 ID
   * @param {number} currentPrice - 當前價格
   */
  updateOrderPrice(orderId, currentPrice) {
    try {
      const stmt = db.prepare(`
        UPDATE orders
        SET current_price = ?
        WHERE id = ?
      `);

      stmt.run(currentPrice, orderId);
    } catch (error) {
      logger.error('更新訂單價格失敗:', error.message);
      throw error;
    }
  }

  /**
   * 檢查並執行訂單
   * @param {number} orderId - 訂單 ID
   * @param {number} currentPrice - 當前價格
   * @returns {boolean} 是否執行
   */
  checkAndExecuteOrder(orderId, currentPrice) {
    try {
      const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);

      if (!order || order.status !== 'active') {
        return false;
      }

      let shouldExecute = false;

      // 檢查訂單類型和條件
      switch (order.type) {
        case 'limit_buy':
          // 限價買入：當前價格 <= 目標價格
          shouldExecute = currentPrice <= order.target_price;
          break;
        case 'limit_sell':
          // 限價賣出：當前價格 >= 目標價格
          shouldExecute = currentPrice >= order.target_price;
          break;
        case 'stop_loss':
          // 止損：當前價格 <= 目標價格
          shouldExecute = currentPrice <= order.target_price;
          break;
        case 'take_profit':
          // 止盈：當前價格 >= 目標價格
          shouldExecute = currentPrice >= order.target_price;
          break;
        default:
          logger.warn(`未知的訂單類型: ${order.type}`);
      }

      if (shouldExecute) {
        this.executeOrder(orderId, currentPrice);
        return true;
      }

      return false;
    } catch (error) {
      logger.error('檢查訂單失敗:', error.message);
      throw error;
    }
  }

  /**
   * 執行訂單
   * @param {number} orderId - 訂單 ID
   * @param {number} executionPrice - 執行價格
   */
  async executeOrder(orderId, executionPrice) {
    try {
      // 獲取訂單和代幣詳情
      const order = db.prepare(`
        SELECT o.*, t.symbol, t.chain, t.address, t.decimals, t.pair_address
        FROM orders o
        JOIN tokens t ON o.token_id = t.id
        WHERE o.id = ?
      `).get(orderId);

      if (!order) {
        throw new Error('訂單不存在');
      }

      logger.info(`準備執行訂單 (ID: ${orderId}, 類型: ${order.type})`);

      let tradeResult = null;

      // 如果啟用自動交易，執行實際交易
      if (this.autoTradeEnabled) {
        tradeResult = await this.executeTrade(order, executionPrice);

        if (!tradeResult.success) {
          logger.error(`交易執行失敗: ${tradeResult.error}`);
          // 不標記訂單為執行，保持活躍狀態
          this.telegram.sendError(`訂單 ${orderId} 執行失敗: ${tradeResult.error}`);
          return;
        }
      }

      // 更新訂單狀態
      const stmt = db.prepare(`
        UPDATE orders
        SET status = 'executed',
            current_price = ?,
            executed_at = ?
        WHERE id = ?
      `);

      stmt.run(executionPrice, getTaiwanISOString(), orderId);

      logger.success(`✅ 訂單已執行 (ID: ${orderId}, 價格: ${executionPrice})`);

      // 發送通知
      const notification = {
        ...order,
        current_price: executionPrice,
        txHash: tradeResult?.txHash || tradeResult?.signature,
        autoTraded: this.autoTradeEnabled,
      };

      // 發送原本的 Telegram 通知
      this.telegram.sendOrderExecuted(notification);

      // 發送 Webhook 通知
      this.telegramWebhook.sendOrderExecuted(notification);
    } catch (error) {
      logger.error('執行訂單失敗:', error.message);
      throw error;
    }
  }

  /**
   * 執行鏈上交易
   * @param {Object} order - 訂單詳情
   * @param {number} currentPrice - 當前價格
   * @returns {Promise<Object>} 交易結果
   */
  async executeTrade(order, currentPrice) {
    try {
      const chain = order.chain.toLowerCase();

      // 檢查是否有對應鏈的錢包
      if (!walletManager.hasWallet(chain)) {
        return {
          success: false,
          error: `${chain} 鏈的錢包未配置`,
        };
      }

      const executor = this.executors[chain];
      if (!executor) {
        return {
          success: false,
          error: `不支援的鏈: ${chain}`,
        };
      }

      // 獲取交易金額（從環境變數或使用預設值）
      const tradeAmount = this.getTradeAmount(chain, order.type);

      // 構建交易參數
      const params = {
        tokenAddress: order.address,
        tokenMint: order.address, // Solana
        amountIn: tradeAmount,
        decimals: order.decimals,
        slippage: parseFloat(process.env.TRADE_SLIPPAGE || '2'),
        deadline: parseInt(process.env.TRADE_DEADLINE || '20'),
      };

      // 添加 pair_address (Base 鏈需要)
      if (order.pair_address) {
        params.pairAddress = order.pair_address;
      }

      logger.info(`執行 ${chain} 鏈 ${order.type} 交易`);
      logger.info(`金額: ${tradeAmount}`);

      // 根據訂單類型執行交易
      let result;
      if (order.type === 'limit_buy') {
        result = await executor.executeBuy(params);
      } else if (order.type === 'limit_sell' || order.type === 'stop_loss' || order.type === 'take_profit') {
        result = await executor.executeSell(params);
      } else {
        return {
          success: false,
          error: `不支援的訂單類型: ${order.type}`,
        };
      }

      return result;
    } catch (error) {
      logger.error('執行交易失敗:', error.message);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * 獲取交易金額
   * @param {string} chain - 鏈名稱
   * @param {string} orderType - 訂單類型
   * @returns {number} 金額
   */
  getTradeAmount(chain, orderType) {
    // 從環境變數獲取，或使用預設值
    const envKey = `${chain.toUpperCase()}_TRADE_AMOUNT`;
    const defaultAmount = chain === 'solana' ? 0.1 : 0.01; // SOL: 0.1, BNB/ETH: 0.01

    return parseFloat(process.env[envKey] || defaultAmount);
  }

  /**
   * 取消訂單
   * @param {number} orderId - 訂單 ID
   */
  cancelOrder(orderId) {
    try {
      const stmt = db.prepare(`
        UPDATE orders
        SET status = 'cancelled'
        WHERE id = ? AND status = 'active'
      `);

      const result = stmt.run(orderId);

      if (result.changes === 0) {
        throw new Error('訂單不存在或已執行');
      }

      logger.info(`訂單已取消 (ID: ${orderId})`);
    } catch (error) {
      logger.error('取消訂單失敗:', error.message);
      throw error;
    }
  }

  /**
   * 刪除訂單
   * @param {number} orderId - 訂單 ID
   */
  deleteOrder(orderId) {
    try {
      const stmt = db.prepare('DELETE FROM orders WHERE id = ?');
      const result = stmt.run(orderId);

      if (result.changes === 0) {
        throw new Error('訂單不存在');
      }

      logger.info(`訂單已刪除 (ID: ${orderId})`);
    } catch (error) {
      logger.error('刪除訂單失敗:', error.message);
      throw error;
    }
  }
}

export default OrderService;
