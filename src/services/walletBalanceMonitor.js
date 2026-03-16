import { ethers } from 'ethers';
import config from '../config/config.js';
import db from '../database/db.js';
import logger from '../utils/logger.js';
import { getTaiwanISOString } from '../utils/timeHelper.js';
import browserManager from './browserManager.js';

const WALLET_ADDRESS = '0xe074e46aaa9d3588bed825881c9185a16f9a8555';
const WALLET_ADDRESS_2 = '0x2F1Cb64083cdA1E6bf91cd1C85c08880e49E2E46';

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
  db.exec(`
    CREATE TABLE IF NOT EXISTS wallet_withdrawals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      amount_bnb REAL NOT NULL,
      amount_usd REAL,
      note TEXT,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
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
  async fetchWalletHoldings(bnbPrice, walletAddress = WALLET_ADDRESS) {
    try {
      const authToken = this.getGmgnAuthToken();
      if (!authToken) return null;

      const finalToken = authToken.startsWith('Bearer ') ? authToken : `Bearer ${authToken}`;
      const params = new URLSearchParams({ ...GMGN_QUERY_PARAMS, limit: '100', orderby: 'last_active_timestamp', direction: 'desc', showsmall: 'true'});
      const url = `https://gmgn.ai/api/v1/wallet_holdings/bsc/${walletAddress}?${params.toString()}`;

      const result = await browserManager.fetchInPage(url, {
        headers: {
          'authorization': finalToken,
          'accept': 'application/json, text/plain, */*'
        }
      });

      if (!result || result.error || result.code !== 0) {
        logger.error(`[${walletAddress.slice(0,8)}...] API 請求攔截: ${result?.error || result?.msg || '無回應'}`);
        return null;
      }

      const holdings = result.data.holdings || [];
      let totalUsd = 0;
      const valid = holdings.filter(h => parseFloat(h.history_bought_cost) > 0 && h.token.symbol != "grok5").map(h => {
        const usd = parseFloat(h.usd_value) || 0;
        totalUsd += usd;
        return { symbol: h.token?.symbol, address: h.token?.address, usdValue: usd, bnbValue: bnbPrice ? usd / bnbPrice : 0 };
      });

      logger.info(`[${walletAddress.slice(0,8)}...] 持倉同步成功: ${valid.length} 個代幣`);
      return { tokensValueUsd: totalUsd, tokensValueBnb: bnbPrice ? totalUsd / bnbPrice : 0, holdingsCount: valid.length, holdings: valid };
    } catch (error) {
      logger.error(`fetchWalletHoldings [${walletAddress.slice(0,8)}...] 崩潰: ` + error.message);
      return null;
    }
  }

  async recordBalance() {
    try {
      const bnbPrice = await this.getBNBPrice();
      const [bnbBalance1, bnbBalance2] = await Promise.all([
        this.getBNBBalance(WALLET_ADDRESS),
        this.getBNBBalance(WALLET_ADDRESS_2)
      ]);
      const hData1 = await this.fetchWalletHoldings(bnbPrice, WALLET_ADDRESS);

      const totalBnb = bnbBalance1 + bnbBalance2;
      const totalTokensUsd = (hData1?.tokensValueUsd || 0);
      const totalTokensBnb = (hData1?.tokensValueBnb || 0);
      const totalHoldingsCount = (hData1?.holdingsCount || 0);
      const combinedHoldings = [...(hData1?.holdings || [])];

      db.prepare(`
        INSERT INTO wallet_balance_history (wallet_address, chain, balance, balance_usd, tokens_value_usd, tokens_value_bnb, total_balance_bnb, holdings_count, holdings_detail, timestamp)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        WALLET_ADDRESS, 'BSC', totalBnb, (bnbPrice || 0) * totalBnb,
        totalTokensUsd, totalTokensBnb, totalBnb + totalTokensBnb,
        totalHoldingsCount, JSON.stringify(combinedHoldings), getTaiwanISOString()
      );
      logger.success('✅ 兩個錢包快照已儲存 (合計)');
    } catch (e) { logger.error('錄入失敗: ' + e.message); }
  }

  async getBNBBalance(address = WALLET_ADDRESS) { return Number(ethers.formatEther(await this.bscProvider.getBalance(address))); }
  
  async getBNBPrice() {
    try {
      const router = new ethers.Contract('0x10ED43C718714eb63d5aA57B78B54704E256024E', ['function getAmountsOut(uint amountIn, address[] memory path) public view returns (uint[] memory amounts)'], this.bscProvider);
      const amounts = await router.getAmountsOut(ethers.parseEther('1'), ['0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c', '0x55d398326f99059fF775485246999027B3197955']);
      return Number(ethers.formatUnits(amounts[1], 18));
    } catch (e) { return 0; }
  }

  getBalanceHistory(limit = 100) { return db.prepare(`SELECT * FROM wallet_balance_history WHERE wallet_address = ? ORDER BY timestamp DESC LIMIT ?`).all(WALLET_ADDRESS, limit); }

  getLatestHistoryRecord() { return db.prepare(`SELECT * FROM wallet_balance_history WHERE wallet_address = ? ORDER BY timestamp DESC LIMIT 1`).get(WALLET_ADDRESS); }

  recordWithdrawal({ amount_bnb, amount_usd, note, timestamp }) {
    const ts = timestamp || getTaiwanISOString();
    const info = db.prepare(`INSERT INTO wallet_withdrawals (amount_bnb, amount_usd, note, timestamp) VALUES (?, ?, ?, ?)`).run(amount_bnb, amount_usd || null, note || null, ts);
    return { id: info.lastInsertRowid, amount_bnb, amount_usd, note, timestamp: ts };
  }

  deleteWithdrawal(id) {
    db.prepare(`DELETE FROM wallet_withdrawals WHERE id = ?`).run(id);
  }

  getWithdrawals(limit = 100) { return db.prepare(`SELECT * FROM wallet_withdrawals ORDER BY timestamp DESC LIMIT ?`).all(limit); }

  async getCurrentBalance() {
    const bnbPrice = await this.getBNBPrice();
    const [bnbBalance1, bnbBalance2] = await Promise.all([
      this.getBNBBalance(WALLET_ADDRESS),
      this.getBNBBalance(WALLET_ADDRESS_2)
    ]);
    const hData1 = await this.fetchWalletHoldings(bnbPrice, WALLET_ADDRESS);

    const totalBnb = bnbBalance1 + bnbBalance2;
    const totalTokensUsd = (hData1?.tokensValueUsd || 0);
    const totalTokensBnb = (hData1?.tokensValueBnb || 0);
    const combinedHoldings = [...(hData1?.holdings || [])];

    return {
      wallet_address: `${WALLET_ADDRESS} + ${WALLET_ADDRESS_2}`,
      balance: totalBnb,
      tokens_value_usd: totalTokensUsd,
      holdings_count: combinedHoldings.length,
      total_balance_bnb: totalBnb + totalTokensBnb,
      holdings: combinedHoldings,
      timestamp: getTaiwanISOString()
    };
  }
}

export default new WalletBalanceMonitor();