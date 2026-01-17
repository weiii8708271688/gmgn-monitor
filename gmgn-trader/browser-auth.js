/**
 * 使用 Playwright 從真實瀏覽器獲取 Token
 *
 * 這個方法完全繞過 Cloudflare，因為使用的是真實的 Chrome 瀏覽器
 */

import { chromium } from 'playwright';
import TokenManager from './token-manager.js';

class BrowserAuth {
  constructor() {
    this.browser = null;
    this.context = null;
    this.page = null;
    this.tokenManager = new TokenManager();
  }

  /**
   * 啟動瀏覽器並導航到 GMGN.ai
   * @param {boolean} headless - 是否無頭模式（false 顯示瀏覽器視窗）
   */
  async launch(headless = false) {
    console.log('🚀 啟動瀏覽器...');

    this.browser = await chromium.launch({
      headless: headless,
      args: [
        '--disable-blink-features=AutomationControlled',
        '--disable-dev-shm-usage',
        '--no-sandbox'
      ]
    });

    // 創建上下文，避免被檢測為機器人
    this.context = await this.browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      viewport: { width: 1280, height: 720 },
      locale: 'zh-TW',
      timezoneId: 'Asia/Taipei'
    });

    // 載入已保存的 cookies（如果有）
    const savedCookies = this.tokenManager.getCookies();
    if (Object.keys(savedCookies).length > 0) {
      console.log('📦 載入已保存的 cookies...');
      const cookies = Object.entries(savedCookies).map(([name, value]) => ({
        name,
        value,
        domain: '.gmgn.ai',
        path: '/'
      }));
      await this.context.addCookies(cookies);
    }

    // 載入已保存的 localStorage（如果有）
    const savedLocalStorage = this.tokenManager.getLocalStorage();
    if (savedLocalStorage && Object.keys(savedLocalStorage).length > 0) {
      console.log('📦 載入已保存的 localStorage...');
    }

    this.page = await this.context.newPage();

    // 注入反檢測腳本和 localStorage
    const localStorageToInject = savedLocalStorage;
    await this.page.addInitScript((storage) => {
      // 反檢測
      Object.defineProperty(navigator, 'webdriver', {
        get: () => false,
      });

      // 注入 localStorage
      if (storage && Object.keys(storage).length > 0) {
        for (const [key, value] of Object.entries(storage)) {
          try {
            window.localStorage.setItem(key, value);
          } catch (e) {
            console.error('Failed to set localStorage:', key, e);
          }
        }
      }
    }, localStorageToInject);

    console.log('✅ 瀏覽器已啟動');
  }

  /**
   * 打開 GMGN.ai 並等待用戶登入
   */
  async waitForLogin() {
    console.log('🌐 打開 GMGN.ai...');

    try {
      // 使用 domcontentloaded 而不是 networkidle
      await this.page.goto('https://gmgn.ai/?chain=bsc', {
        waitUntil: 'domcontentloaded',
        timeout: 30000
      });
    } catch (error) {
      console.log('⚠️  頁面載入超時，但這是正常的（GMGN 持續有網路請求）');
    }

    // 等待頁面基本元素加載
    await this.page.waitForTimeout(3000);

    console.log('\n' + '='.repeat(60));
    console.log('請在瀏覽器視窗中手動登入 GMGN.ai');
    console.log('登入完成後，按 Enter 繼續...');
    console.log('='.repeat(60) + '\n');

    // 等待用戶按 Enter
    await new Promise(resolve => {
      process.stdin.once('data', resolve);
    });

    console.log('✅ 繼續處理...');
  }

  /**
   * 從瀏覽器中提取 Token 和 Cookies
   */
  async extractTokenAndCookies() {
    console.log('🔍 提取 Token 和 Cookies...');

    let token = null;

    // 設置請求攔截器
    const requestHandler = request => {
      const headers = request.headers();
      if (headers['authorization']) {
        const authToken = headers['authorization'].replace('Bearer ', '').trim();
        if (authToken && authToken.length > 50) {
          token = authToken;
          console.log('✅ 從請求中捕獲到 Token');
        }
      }
    };

    this.page.on('request', requestHandler);

    // 回到主頁觸發請求
    console.log('📡 導航到主頁以觸發 API 請求...');
    try {
      await this.page.goto('https://gmgn.ai/?chain=bsc', {
        waitUntil: 'domcontentloaded',
        timeout: 15000
      });
    } catch (error) {
      console.log('⚠️  導航超時（正常，GMGN 持續請求）');
    }

    // 等待網路請求
    await this.page.waitForTimeout(5000);

    // 移除監聽器
    this.page.off('request', requestHandler);

    // 方法 2: 從 localStorage/sessionStorage 獲取
    if (!token) {
      console.log('🔍 從瀏覽器 Storage 中查找 token...');
      token = await this.page.evaluate(() => {
        // 檢查所有可能的存儲位置
        const storageKeys = ['token', 'auth_token', 'jwt', 'access_token', 'authToken'];

        for (const key of storageKeys) {
          const localValue = localStorage.getItem(key);
          if (localValue && localValue.length > 50) return localValue;

          const sessionValue = sessionStorage.getItem(key);
          if (sessionValue && sessionValue.length > 50) return sessionValue;
        }

        return null;
      });
    }

    // 獲取所有 Cookies
    const cookies = await this.context.cookies();
    const cookieObj = {};
    cookies.forEach(cookie => {
      cookieObj[cookie.name] = cookie.value;
    });

    // 獲取 localStorage
    console.log('🔍 提取 localStorage...');
    const localStorage = await this.page.evaluate(() => {
      const data = {};
      for (let i = 0; i < window.localStorage.length; i++) {
        const key = window.localStorage.key(i);
        data[key] = window.localStorage.getItem(key);
      }
      return data;
    });

    console.log(`\n提取結果:`);
    console.log(`Token: ${token ? token.substring(0, 50) + '...' : '❌ 未找到'}`);
    console.log(`Cookies 數量: ${Object.keys(cookieObj).length}`);
    console.log(`localStorage 數量: ${Object.keys(localStorage).length}`);

    if (Object.keys(cookieObj).length > 0) {
      console.log(`Cookies: ${Object.keys(cookieObj).join(', ')}`);
    }

    // 檢查是否有 tgInfo
    if (localStorage.tgInfo) {
      try {
        const tgInfo = JSON.parse(localStorage.tgInfo);
        if (tgInfo.token && tgInfo.token.access_token) {
          console.log(`✅ 找到 tgInfo.access_token`);
        }
      } catch (e) {}
    }

    if (token && Object.keys(cookieObj).length > 0) {
      // 保存到 TokenManager（包含 localStorage）
      this.tokenManager.setSession(token, cookieObj, localStorage);
      console.log('\n✅ Token、Cookies 和 localStorage 已保存到 .gmgn-session.json');
      return { token, cookies: cookieObj, localStorage };
    } else {
      throw new Error(`無法提取完整信息 - Token: ${token ? '有' : '無'}, Cookies: ${Object.keys(cookieObj).length}`);
    }
  }

  /**
   * 刷新 Token（在已登入狀態下）
   */
  async refreshToken() {
    console.log('🔄 使用瀏覽器刷新 Token...');

    if (!this.page) {
      await this.launch(true); // 無頭模式
    }

    let newToken = null;

    // 設置請求攔截器
    const requestHandler = request => {
      const headers = request.headers();
      if (headers['authorization']) {
        const authToken = headers['authorization'].replace('Bearer ', '').trim();
        if (authToken && authToken.length > 50) {
          newToken = authToken;
        }
      }
    };

    this.page.on('request', requestHandler);

    // 導航到主頁觸發請求
    try {
      await this.page.goto('https://gmgn.ai/?chain=bsc', {
        waitUntil: 'domcontentloaded',
        timeout: 15000
      });
    } catch (error) {
      // 超時是正常的
    }

    await this.page.waitForTimeout(5000);

    this.page.off('request', requestHandler);

    if (newToken) {
      const cookies = await this.context.cookies();
      const cookieObj = {};
      cookies.forEach(cookie => {
        cookieObj[cookie.name] = cookie.value;
      });

      // 同時提取 localStorage
      const localStorage = await this.page.evaluate(() => {
        const data = {};
        for (let i = 0; i < window.localStorage.length; i++) {
          const key = window.localStorage.key(i);
          data[key] = window.localStorage.getItem(key);
        }
        return data;
      });

      this.tokenManager.setSession(newToken, cookieObj, localStorage);
      console.log('✅ Token、Cookies 和 localStorage 已刷新');
      return newToken;
    } else {
      throw new Error('無法獲取新 Token');
    }
  }

  /**
   * 關閉瀏覽器
   */
  async close() {
    if (this.browser) {
      await this.browser.close();
      console.log('✅ 瀏覽器已關閉');
    }
  }
}

export default BrowserAuth;
