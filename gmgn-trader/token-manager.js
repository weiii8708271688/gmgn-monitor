/**
 * Token 管理器
 *
 * 功能：
 * 1. 检查 Token 是否过期
 * 2. 使用 Cookie 自动刷新 Token
 * 3. 持久化保存 Token 和 Cookie
 */

import fs from 'fs';
import path from 'path';

class TokenManager {
  constructor() {
    this.tokenFile = path.join(process.cwd(), '.gmgn-session.json');
    this.session = this.loadSession();
  }

  /**
   * 加载保存的会话
   */
  loadSession() {
    try {
      if (fs.existsSync(this.tokenFile)) {
        const data = fs.readFileSync(this.tokenFile, 'utf8');
        return JSON.parse(data);
      }
    } catch (error) {
      console.warn('无法加载会话文件:', error.message);
    }

    return {
      token: null,
      cookies: {},
      localStorage: {},
      expiresAt: null
    };
  }

  /**
   * 保存会话
   */
  saveSession() {
    try {
      fs.writeFileSync(this.tokenFile, JSON.stringify(this.session, null, 2));
      console.log('✅ 会话已保存');
    } catch (error) {
      console.error('保存会话失败:', error.message);
    }
  }

  /**
   * 设置 Token、Cookies 和 localStorage
   * @param {string} token - JWT Token
   * @param {Object} cookies - Cookie 对象
   * @param {Object} localStorage - localStorage 数据
   */
  setSession(token, cookies = {}, localStorage = {}) {
    this.session.token = token;
    this.session.cookies = cookies;
    this.session.localStorage = localStorage;

    // 解析 Token 过期时间
    try {
      const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString());
      this.session.expiresAt = payload.exp * 1000; // 转换为毫秒

      const expiryDate = new Date(this.session.expiresAt);
      console.log(`Token 过期时间: ${expiryDate.toLocaleString()}`);
    } catch (error) {
      console.error('无法解析 Token:', error.message);
      this.session.expiresAt = null;
    }

    this.saveSession();
  }

  /**
   * 检查 Token 是否过期
   * @param {number} bufferMinutes - 提前多少分钟认为过期（默认 5 分钟）
   * @returns {boolean}
   */
  isTokenExpired(bufferMinutes = 5) {
    if (!this.session.token || !this.session.expiresAt) {
      return true;
    }

    const now = Date.now();
    const buffer = bufferMinutes * 60 * 1000;
    const isExpired = now >= (this.session.expiresAt - buffer);

    if (isExpired) {
      const remainingMinutes = Math.floor((this.session.expiresAt - now) / 60000);
      console.log(`⚠️  Token 即将过期（剩余 ${remainingMinutes} 分钟）`);
    }

    return isExpired;
  }

  /**
   * 获取当前 Token
   */
  getToken() {
    return this.session.token;
  }

  /**
   * 获取 Cookies
   */
  getCookies() {
    return this.session.cookies;
  }

  /**
   * 获取 localStorage
   */
  getLocalStorage() {
    return this.session.localStorage || {};
  }

  /**
   * 刷新 Token
   * 使用真實瀏覽器（Playwright）獲取新的 Token
   */
  async refreshToken() {
    console.log('🔄 正在使用瀏覽器刷新 Token...');

    if (!this.session.cookies || Object.keys(this.session.cookies).length === 0) {
      throw new Error('没有可用的 Cookie，请运行: node setup-browser-session.js');
    }

    try {
      // 動態導入 BrowserAuth（避免循環依賴）
      const { default: BrowserAuth } = await import('./browser-auth.js');
      const browserAuth = new BrowserAuth();

      // 啟動無頭瀏覽器
      await browserAuth.launch(true);

      // 刷新 token
      const newToken = await browserAuth.refreshToken();

      // 關閉瀏覽器
      await browserAuth.close();

      console.log('✅ Token 刷新成功（使用瀏覽器）');
      return newToken;

    } catch (error) {
      console.error('❌ 瀏覽器刷新失败:', error.message);
      console.log('💡 請運行: node setup-browser-session.js 重新設置會話');
      throw error;
    }
  }

  /**
   * 格式化 Cookies 为字符串
   */
  formatCookies(cookies) {
    return Object.entries(cookies)
      .map(([key, value]) => `${key}=${value}`)
      .join('; ');
  }

  /**
   * 确保 Token 有效（自动刷新）
   * @returns {Promise<string>} 有效的 Token
   */
  async ensureValidToken() {
    if (this.isTokenExpired()) {
      try {
        return await this.refreshToken();
      } catch (error) {
        throw new Error('Token 过期且刷新失败，请手动登录');
      }
    }
    return this.getToken();
  }

  /**
   * 清除会话
   */
  clearSession() {
    this.session = {
      token: null,
      cookies: {},
      expiresAt: null
    };

    if (fs.existsSync(this.tokenFile)) {
      fs.unlinkSync(this.tokenFile);
      console.log('✅ 会话已清除');
    }
  }
}

export default TokenManager;
