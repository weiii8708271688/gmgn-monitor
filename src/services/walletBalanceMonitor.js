import { ethers } from 'ethers';
import config from '../config/config.js';
import db from '../database/db.js';
import logger from '../utils/logger.js';
import { getTaiwanISOString } from '../utils/timeHelper.js';
import browserManager from './browserManager.js';

const WALLET_ADDRESS = '0xe074e46aaa9d3588bed825881c9185a16f9a8555';

// 參數完全同步
const GMGN_QUERY_PARAMS = {
  device_id: 'f829d5a2-f18d-4e76-b67c-751aaca9e556',
  fp_did: 'ac2515382b84577aab6572d7d47d29fb',
  client_id: 'gmgn_web_20251101-6461-0986672',
  from_app: 'gmgn',
  app_ver: '20251101-6461-0986672',
  tz_name: 'Asia/Taipei',
  tz_offset: '28800',
  app_lang: 'zh-TW',
  os: 'web',
  worker: '0'
};

// 確保資料庫欄位
(function migrate() {
  const cols = ['tokens_value_usd', 'tokens_value_bnb', 'total_balance_bnb', 'holdings_count', 'holdings_detail'];
  cols.forEach(c => {
    try { db.exec(`ALTER TABLE wallet_balance_history ADD COLUMN ${c} ${c.includes('count') ? 'INTEGER' : 'REAL'}`); } catch (e) {}
  });
})();

class WalletBalanceMonitor {
  constructor() {
    this.bscProvider = new ethers.JsonRpcProvider(config.rpc.bsc);
  }

  getGmgnAuthToken() {
    const result = db.prepare('SELECT value FROM gmgn_config WHERE key = ?').get('auth_token');
    return result ? result.value : null;
  }

  /**
   * 透過瀏覽器內部執行 fetch (這與真實使用者操作 100% 一致)
   */
  async fetchWalletHoldings(bnbPrice) {
    try {
      const authToken = this.getGmgnAuthToken();
      if (!authToken) return null;

      const finalToken = authToken.startsWith('Bearer ') ? authToken : `Bearer ${authToken}`;
      const params = new URLSearchParams({ ...GMGN_QUERY_PARAMS, limit: '100', orderby: 'last_active_timestamp', direction: 'desc', showsmall: 'true'});
      const url = `https://gmgn.ai/api/v1/wallet_holdings/bsc/${WALLET_ADDRESS}?${params.toString()}`;

      const result = await browserManager.fetchInPage(url, {
        headers: {
          'authorization': finalToken,
          'accept': 'application/json, text/plain, */*'
        }
      });

      if (!result || result.error || result.code !== 0) {
        logger.error(`API 請求攔截: ${result?.error || result?.msg || '無回應'}`);
        return null;
      }

      const holdings = result.data.holdings || [];
      let totalUsd = 0;
      const valid = holdings.filter(h => parseFloat(h.history_bought_cost) > 0 && h.token.symbol != "grok5").map(h => {
        const usd = parseFloat(h.usd_value) || 0;
        totalUsd += usd;
        return { symbol: h.token?.symbol, address: h.token?.address, usdValue: usd, bnbValue: bnbPrice ? usd / bnbPrice : 0 };
      });

      logger.info(`持倉同步成功: ${valid.length} 個代幣`);
      return { tokensValueUsd: totalUsd, tokensValueBnb: bnbPrice ? totalUsd / bnbPrice : 0, holdingsCount: valid.length, holdings: valid };
    } catch (error) {
      logger.error('fetchWalletHoldings 崩潰: ' + error.message);
      return null;
    }
  }

  async recordBalance() {
    try {
      const bnbBalance = await this.getBNBBalance();
      const bnbPrice = await this.getBNBPrice();
      const hData = await this.fetchWalletHoldings(bnbPrice);

      db.prepare(`
        INSERT INTO wallet_balance_history (wallet_address, chain, balance, balance_usd, tokens_value_usd, tokens_value_bnb, total_balance_bnb, holdings_count, holdings_detail, timestamp)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        WALLET_ADDRESS, 'BSC', bnbBalance, (bnbPrice || 0) * bnbBalance,
        hData?.tokensValueUsd || 0, hData?.tokensValueBnb || 0, bnbBalance + (hData?.tokensValueBnb || 0),
        hData?.holdingsCount || 0, hData ? JSON.stringify(hData.holdings) : null, getTaiwanISOString()
      );
      logger.success('✅ 錢包快照已儲存');
    } catch (e) { logger.error('錄入失敗: ' + e.message); }
  }

  async getBNBBalance() { return Number(ethers.formatEther(await this.bscProvider.getBalance(WALLET_ADDRESS))); }
  
  async getBNBPrice() {
    try {
      const router = new ethers.Contract('0x10ED43C718714eb63d5aA57B78B54704E256024E', ['function getAmountsOut(uint amountIn, address[] memory path) public view returns (uint[] memory amounts)'], this.bscProvider);
      const amounts = await router.getAmountsOut(ethers.parseEther('1'), ['0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c', '0x55d398326f99059fF775485246999027B3197955']);
      return Number(ethers.formatUnits(amounts[1], 18));
    } catch (e) { return 0; }
  }

  getBalanceHistory(limit = 100) { return db.prepare(`SELECT * FROM wallet_balance_history WHERE wallet_address = ? ORDER BY timestamp DESC LIMIT ?`).all(WALLET_ADDRESS, limit); }
  
  getLatestHistoryRecord() { return db.prepare(`SELECT * FROM wallet_balance_history WHERE wallet_address = ? ORDER BY timestamp DESC LIMIT 1`).get(WALLET_ADDRESS); }

  async getCurrentBalance() {
    const bnbPrice = await this.getBNBPrice();
    const bnbBalance = await this.getBNBBalance();
    const hData = await this.fetchWalletHoldings(bnbPrice);
    return {
      wallet_address: WALLET_ADDRESS, balance: bnbBalance,
      tokens_value_usd: hData?.tokensValueUsd || 0,
      total_balance_bnb: bnbBalance + (hData?.tokensValueBnb || 0),
      holdings: hData?.holdings || [], timestamp: getTaiwanISOString()
    };
  }
}

export default new WalletBalanceMonitor();