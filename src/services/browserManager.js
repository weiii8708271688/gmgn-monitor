import { chromium } from 'playwright';
import logger from '../utils/logger.js';

/**
 * 共用瀏覽器管理器 - 單一 Playwright 頁面供所有服務使用
 * 透過瀏覽器內部執行 fetch，繞過 Cloudflare 防護
 */
class BrowserManager {
  constructor() {
    this.browser = null;
    this.page = null;
    this._initPromise = null;
  }

  /**
   * 初始化常駐分頁（只會啟動一次）
   */
  async init() {
    if (this.page) return this.page;
    // 避免多處同時呼叫造成重複啟動
    if (this._initPromise) return this._initPromise;

    this._initPromise = this._launch();
    try {
      await this._initPromise;
      return this.page;
    } finally {
      this._initPromise = null;
    }
  }

  async _launch() {
    try {
      logger.info('🚀 啟動共用瀏覽器 (繞過 Cloudflare)...');
      this.browser = await chromium.launch({ headless: true });
      const context = await this.browser.newContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      });

      this.page = await context.newPage();
      // 先導航到首頁，確保拿到所有必要的 Cookie 和驗證狀態
      await this.page.goto('https://gmgn.ai/bsc', { waitUntil: 'domcontentloaded' });
      // 等待 Cloudflare 挑戰完成
      await this.page.waitForTimeout(3000);

      logger.success('✅ 共用瀏覽器已就緒');
    } catch (error) {
      logger.error('共用瀏覽器初始化失敗: ' + error.message);
      this.page = null;
    }
  }

  /**
   * 透過瀏覽器內部執行 fetch（與真實使用者操作 100% 一致）
   * @param {string} url - 完整 API URL
   * @param {object} options - fetch options (method, headers, body)
   * @returns {object|null} - JSON 回應或 null
   */
  async fetchInPage(url, options = {}) {
    await this.init();
    if (!this.page) return null;

    try {
      const result = await this.page.evaluate(async ({ url, options }) => {
        try {
          const res = await fetch(url, options);
          if (!res.ok) return { error: `HTTP ${res.status}` };
          return await res.json();
        } catch (e) {
          return { error: e.message };
        }
      }, { url, options });

      return result;
    } catch (error) {
      logger.error('fetchInPage 錯誤: ' + error.message);
      // 頁面可能崩潰，重置以便下次重新初始化
      this.page = null;
      return null;
    }
  }

  /**
   * 關閉瀏覽器
   */
  async close() {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
      this.page = null;
      logger.info('共用瀏覽器已關閉');
    }
  }
}

export default new BrowserManager();
