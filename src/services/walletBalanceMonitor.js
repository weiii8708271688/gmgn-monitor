import { ethers } from 'ethers';
import config from '../config/config.js';
import db from '../database/db.js';
import logger from '../utils/logger.js';
import { getTaiwanISOString } from '../utils/timeHelper.js';

// Hard-coded 錢包地址
const WALLET_ADDRESS = '0xe074e46aaa9d3588bed825881c9185a16f9a8555';

class WalletBalanceMonitor {
  constructor() {
    this.bscProvider = new ethers.JsonRpcProvider(config.rpc.bsc);
  }

  /**
   * 獲取 BNB 餘額
   */
  async getBNBBalance() {
    try {
      const balance = await this.bscProvider.getBalance(WALLET_ADDRESS);
      const balanceInBNB = Number(ethers.formatEther(balance));
      logger.info(`BNB 餘額: ${balanceInBNB.toFixed(6)} BNB`);
      return balanceInBNB;
    } catch (error) {
      logger.error('獲取 BNB 餘額失敗:', error.message);
      throw error;
    }
  }

  /**
   * 獲取 BNB 的 USD 價格
   */
  async getBNBPrice() {
    try {
      // 使用 PancakeSwap Router 查詢 BNB/USDT 價格
      const PANCAKE_ROUTER = '0x10ED43C718714eb63d5aA57B78B54704E256024E';
      const WBNB = '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c';
      const USDT = '0x55d398326f99059fF775485246999027B3197955';

      const routerContract = new ethers.Contract(
        PANCAKE_ROUTER,
        ['function getAmountsOut(uint amountIn, address[] memory path) public view returns (uint[] memory amounts)'],
        this.bscProvider
      );

      // 查詢 1 BNB = ? USDT
      const amounts = await routerContract.getAmountsOut(
        ethers.parseEther('1'),
        [WBNB, USDT]
      );

      const bnbPrice = Number(ethers.formatUnits(amounts[1], 18));
      logger.debug(`BNB 價格: $${bnbPrice.toFixed(2)}`);
      return bnbPrice;
    } catch (error) {
      logger.error('獲取 BNB 價格失敗:', error.message);
      // 如果失敗，返回 null
      return null;
    }
  }

  /**
   * 記錄錢包餘額
   */
  async recordBalance() {
    try {
      logger.info('開始記錄錢包餘額...');

      // 獲取 BNB 餘額
      const bnbBalance = await this.getBNBBalance();

      // 獲取 BNB 價格
      const bnbPrice = await this.getBNBPrice();
      const balanceUSD = bnbPrice ? bnbBalance * bnbPrice : null;

      // 獲取台灣時間
      const taiwanTime = getTaiwanISOString();

      // 儲存到資料庫
      db.prepare(`
        INSERT INTO wallet_balance_history (wallet_address, chain, balance, balance_usd, timestamp)
        VALUES (?, ?, ?, ?, ?)
      `).run(WALLET_ADDRESS, 'BSC', bnbBalance, balanceUSD, taiwanTime);

      logger.success(
        `✅ 錢包餘額已記錄: ${bnbBalance.toFixed(6)} BNB` +
        (balanceUSD ? ` ($${balanceUSD.toFixed(2)})` : '')
      );

      return { balance: bnbBalance, balanceUSD };
    } catch (error) {
      logger.error('記錄錢包餘額失敗:', error.message);
      throw error;
    }
  }

  /**
   * 獲取餘額歷史記錄
   */
  getBalanceHistory(limit = 100) {
    try {
      const history = db.prepare(`
        SELECT * FROM wallet_balance_history
        WHERE wallet_address = ?
        ORDER BY timestamp DESC
        LIMIT ?
      `).all(WALLET_ADDRESS, limit);

      return history;
    } catch (error) {
      logger.error('獲取餘額歷史失敗:', error.message);
      throw error;
    }
  }

  /**
   * 獲取即時餘額（不記錄到資料庫）
   */
  async getCurrentBalance() {
    try {
      // 獲取 BNB 餘額
      const bnbBalance = await this.getBNBBalance();

      // 獲取 BNB 價格
      const bnbPrice = await this.getBNBPrice();
      const balanceUSD = bnbPrice ? bnbBalance * bnbPrice : null;

      return {
        wallet_address: WALLET_ADDRESS,
        chain: 'BSC',
        balance: bnbBalance,
        balance_usd: balanceUSD,
        timestamp: getTaiwanISOString(),
        isRealtime: true // 標記這是即時查詢的資料
      };
    } catch (error) {
      logger.error('獲取即時餘額失敗:', error.message);
      throw error;
    }
  }

  /**
   * 獲取最新的歷史記錄
   */
  getLatestHistoryRecord() {
    try {
      const latest = db.prepare(`
        SELECT * FROM wallet_balance_history
        WHERE wallet_address = ?
        ORDER BY timestamp DESC
        LIMIT 1
      `).get(WALLET_ADDRESS);

      return latest;
    } catch (error) {
      logger.error('獲取最新歷史記錄失敗:', error.message);
      throw error;
    }
  }
}

export default new WalletBalanceMonitor();
