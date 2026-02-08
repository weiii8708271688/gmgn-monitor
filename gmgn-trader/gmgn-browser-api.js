/**
 * GMGN.ai Browser API - 統一的 API 類別
 *
 * 特點:
 * - 使用持久化的無頭瀏覽器，保持會話活躍
 * - 自動處理認證和 token 管理
 * - 實時交易功能（查詢價格、餘額、持倉等）
 * - 不包含限價單功能
 *
 * 使用方法:
 * ```js
 * import GmgnBrowserAPI from './gmgn-browser-api.js';
 *
 * const api = new GmgnBrowserAPI();
 * await api.init();
 *
 * // 查詢價格
 * const price = await api.getTokenPrice(tokenAddress);
 *
 * // 查詢餘額
 * const balance = await api.getTokenBalance(tokenAddress, walletAddress);
 *
 * // 關閉 API（可選，用於釋放資源）
 * await api.close();
 * ```
 */

import { chromium } from 'playwright';
import TokenManager from './token-manager.js';
import GMGN_CONFIG, { getQueryParams } from './gmgn-config.js';

class GmgnBrowserAPI {
  constructor() {
    this.browser = null;
    this.page = null;
    this.context = null;
    this.tokenManager = GMGN_CONFIG.tokenManager;
    this.walletAddress = GMGN_CONFIG.walletAddress;
    this.isInitialized = false;
  }

  /**
   * 初始化瀏覽器會話
   * 這個方法只在首次使用時調用一次，之後瀏覽器會保持開啟
   */
  async init() {
    if (this.isInitialized) {
      console.log('✅ 瀏覽器已經初始化，跳過');
      return;
    }

    console.log('🚀 初始化無頭瀏覽器...');

    // 載入會話
    const savedCookies = this.tokenManager.getCookies();
    const savedLocalStorage = this.tokenManager.getLocalStorage();

    if (Object.keys(savedCookies).length === 0) {
      throw new Error('沒有保存的會話，請先運行: node setup-browser-session.js');
    }

    // 啟動瀏覽器
    this.browser = await chromium.launch({
      headless: true,
      args: ['--disable-blink-features=AutomationControlled']
    });

    this.context = await this.browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      viewport: { width: 1280, height: 720 },
      locale: 'zh-TW',
      timezoneId: 'Asia/Taipei'
    });

    // 載入 cookies
    const cookies = Object.entries(savedCookies).map(([name, value]) => ({
      name,
      value,
      domain: '.gmgn.ai',
      path: '/'
    }));
    await this.context.addCookies(cookies);

    this.page = await this.context.newPage();

    // 注入 localStorage 和反檢測
    await this.page.addInitScript((storage) => {
      Object.defineProperty(navigator, 'webdriver', {
        get: () => false,
      });

      if (storage && Object.keys(storage).length > 0) {
        for (const [key, value] of Object.entries(storage)) {
          try {
            window.localStorage.setItem(key, value);
          } catch (e) {}
        }
      }
    }, savedLocalStorage);

    // 打開頁面
    await this.page.goto('https://gmgn.ai/bsc', {
      waitUntil: 'domcontentloaded'
    });

    await this.page.waitForTimeout(2000);

    // 檢查登入狀態
    const tgInfo = await this.page.evaluate(() => {
      return window.localStorage.getItem('tgInfo');
    });

    if (!tgInfo) {
      throw new Error('未檢測到登入狀態，請重新運行: node setup-browser-session.js');
    }

    this.isInitialized = true;
    console.log('✅ 瀏覽器已就緒，可以開始使用 API');
  }

  /**
   * 內部方法：執行 API 請求
   */
  async _apiCall(method, endpoint, body = null) {
    if (!this.isInitialized) {
      throw new Error('API 未初始化，請先調用 init()');
    }

    try {
      const result = await this.page.evaluate(
        async ({ method, endpoint, body }) => {
          try {
            // 從 localStorage 獲取 token
            const tgInfoStr = window.localStorage.getItem('tgInfo');
            let token = '';
            if (tgInfoStr) {
              try {
                const tgInfo = JSON.parse(tgInfoStr);
                token = 'Bearer ' + (tgInfo?.token?.access_token || '');
              } catch (e) {}
            }

            const options = {
              method,
              headers: {
                'accept': 'application/json, text/plain, */*',
                'content-type': 'application/json',
                'authorization': token
              },
              credentials: 'include'
            };

            if (body) {
              options.body = JSON.stringify(body);
            }

            const response = await fetch(endpoint, options);
            const data = await response.json();

            return {
              success: response.ok,
              status: response.status,
              data: data
            };
          } catch (error) {
            return {
              success: false,
              error: error.message
            };
          }
        },
        { method, endpoint, body }
      );

      return result;
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  /**
   * 查詢代幣信息
   * @param {string} tokenAddress - 代幣地址
   * @returns {Promise<Object>} 代幣統計信息
   */
  async getTokenInfo(tokenAddress) {
    const params = new URLSearchParams(getQueryParams());
    const endpoint = `https://gmgn.ai/api/v1/token_stat/bsc/${tokenAddress}?${params.toString()}`;

    const result = await this._apiCall('GET', endpoint);

    if (result.success && result.data && result.data.data) {
      return {
        success: true,
        data: result.data.data
      };
    }

    return {
      success: false,
      error: result.error || '查詢失敗'
    };
  }

  /**
   * 查詢 BNB 餘額
   * @param {string} walletAddress - 錢包地址（可選，預設使用配置中的地址）
   * @returns {Promise<Object>} BNB 餘額信息
   */
  async getBNBBalance(walletAddress = null) {
    const wallet = walletAddress || this.walletAddress;
    const queryParams = getQueryParams();
    const params = new URLSearchParams({
      chain: 'bsc',
      token_address: '0x0000000000000000000000000000000000000000',
      wallet_addresses: wallet,
      ...queryParams
    });
    const endpoint = `https://gmgn.ai/td/api/v1/wallets/balances?${params.toString()}`;

    const result = await this._apiCall('GET', endpoint);

    if (result.success && result.data && result.data.data) {
      const balances = result.data.data.balances;
      if (balances && balances.length > 0) {
        return {
          success: true,
          data: {
            balance: parseFloat(balances[0].balance),
            walletAddress: balances[0].wallet_address,
            height: balances[0].height,
            timestamp: balances[0].timestamp
          }
        };
      }
    }

    return {
      success: false,
      error: result.error || '查詢失敗'
    };
  }

  /**
   * 查詢代幣餘額
   * @param {string} tokenAddress - 代幣地址
   * @param {string} walletAddress - 錢包地址（可選，預設使用配置中的地址）
   * @returns {Promise<Object>} 代幣餘額信息
   */
  async getTokenBalance(tokenAddress, walletAddress = null) {
    const wallet = walletAddress || this.walletAddress;
    const queryParams = getQueryParams();
    const params = new URLSearchParams({
      chain: 'bsc',
      token_address: tokenAddress,
      wallet_addresses: wallet,
      ...queryParams
    });
    const endpoint = `https://gmgn.ai/td/api/v1/wallets/balances?${params.toString()}`;

    const result = await this._apiCall('GET', endpoint);

    if (result.success && result.data && result.data.data) {
      const balances = result.data.data.balances;
      if (balances && balances.length > 0) {
        return {
          success: true,
          data: {
            balance: parseFloat(balances[0].balance),
            tokenAddress: balances[0].token_address,
            walletAddress: balances[0].wallet_address,
            decimals: balances[0].decimals,
            timestamp: balances[0].timestamp
          }
        };
      }
    }

    return {
      success: false,
      error: result.error || '查詢失敗或餘額為 0'
    };
  }

  /**
   * 查詢持倉信息（包含買入均價、盈虧等）
   * @param {string} tokenAddress - 代幣地址
   * @param {string} walletAddress - 錢包地址（可選，預設使用配置中的地址）
   * @returns {Promise<Object>} 持倉詳情
   */
  async getHoldings(tokenAddress, walletAddress = null) {
    const wallet = walletAddress || this.walletAddress;
    const queryParams = getQueryParams();
    const params = new URLSearchParams({
      ...queryParams,
      limit: '100',
      orderby: 'last_active_timestamp',
      direction: 'desc',
      showsmall: 'true',
      sellout: 'true',
      hide_abnormal: 'false'
    });
    const endpoint = `https://gmgn.ai/api/v1/wallet_holdings/bsc/${wallet}?${params.toString()}`;

    const result = await this._apiCall('GET', endpoint);

    if (result.success && result.data && result.data.data && result.data.data.holdings) {
      const holdings = result.data.data.holdings;
      const targetHolding = holdings.find(h =>
        h && h.token && h.token.address && h.token.address.toLowerCase() === tokenAddress.toLowerCase()
      );

      if (targetHolding) {
        return {
          success: true,
          data: {
            symbol: targetHolding.token.symbol,
            tokenAddress: targetHolding.token.address,
            balance: targetHolding.balance,
            avgCost: targetHolding.avg_cost || targetHolding.cost,
            currentPrice: targetHolding.price || targetHolding.token.price,
            totalCost: targetHolding.total_cost || targetHolding.cost_usd,
            currentValue: targetHolding.value_usd || targetHolding.usd_value,
            realizedProfit: targetHolding.realized_profit,
            unrealizedProfit: targetHolding.unrealized_profit || targetHolding.profit_usd,
            profitPercent: targetHolding.profit_percent
          }
        };
      }
    }

    return {
      success: false,
      error: result.error || '未找到該代幣的持倉'
    };
  }

  /**
   * 計算錢包總 BNB 餘額（純 BNB + 所有代幣持倉換算 BNB）
   * @param {number} bnbPrice - 當前 BNB 價格（USD），由呼叫者傳入
   * @param {string} walletAddress - 錢包地址（可選，預設使用配置中的地址）
   * @returns {Promise<Object>} 總餘額信息
   */
  async getTotalWalletBnb(bnbPrice, walletAddress = null) {
    const wallet = walletAddress || this.walletAddress;

    // 1. 查詢所有持倉
    const queryParams = getQueryParams();
    const params = new URLSearchParams({
      ...queryParams,
      limit: '100',
      orderby: 'last_active_timestamp',
      direction: 'desc',
      showsmall: 'true',
      sellout: 'true',
      hide_abnormal: 'false'
    });
    const endpoint = `https://gmgn.ai/api/v1/wallet_holdings/bsc/${wallet}?${params.toString()}`;
    const result = await this._apiCall('GET', endpoint);

    if (!result.success || !result.data || !result.data.data || !result.data.data.holdings) {
      return {
        success: false,
        error: result.error || '查詢持倉失敗'
      };
    }

    // 2. 查詢純 BNB 餘額
    const bnbResult = await this.getBNBBalance(wallet);
    const bnbBalance = bnbResult.success ? bnbResult.data.balance : 0;

    // 3. 過濾並加總持倉
    const allHoldings = result.data.data.holdings;
    let totalTokensUsd = 0;
    const validHoldings = [];

    for (const h of allHoldings) {
      // 跳過成本為 0 的代幣（別人轉入的）
      if (parseFloat(h.history_bought_cost) === 0) continue;
      // 跳過 grok5
      if (h.token?.symbol?.toLowerCase() === 'grok5') continue;

      const usdValue = parseFloat(h.usd_value) || 0;
      totalTokensUsd += usdValue;
      validHoldings.push({
        symbol: h.token?.symbol || 'N/A',
        address: h.token?.address,
        balance: h.balance,
        usdValue,
        bnbValue: usdValue / bnbPrice
      });
    }

    // 4. 換算成 BNB
    const tokensValueBnb = totalTokensUsd / bnbPrice;
    const totalBnb = bnbBalance + tokensValueBnb;

    return {
      success: true,
      data: {
        bnbBalance,
        tokensValueUsd: totalTokensUsd,
        tokensValueBnb,
        totalBnb,
        holdingsCount: validHoldings.length,
        holdings: validHoldings
      }
    };
  }

  /**
   * 查詢代幣價格（包含歷史價格和交易統計）
   * @param {string} tokenAddress - 代幣地址
   * @returns {Promise<Object>} 代幣價格信息
   */
  async getTokenPrice(tokenAddress) {
    const queryParams = getQueryParams();
    const params = new URLSearchParams(queryParams);
    const endpoint = `https://gmgn.ai/api/v1/mutil_window_token_info?${params}`;

    const result = await this.page.evaluate(
      async ({ endpoint, tokenAddress }) => {
        try {
          // 從 localStorage 獲取 token
          const tgInfoStr = window.localStorage.getItem('tgInfo');
          let token = '';
          if (tgInfoStr) {
            try {
              const tgInfo = JSON.parse(tgInfoStr);
              token = 'Bearer ' + (tgInfo?.token?.access_token || '');
            } catch (e) {}
          }

          const response = await fetch(endpoint, {
            method: 'POST',
            headers: {
              'accept': 'application/json',
              'content-type': 'application/json',
              'authorization': token
            },
            body: JSON.stringify({
              chain: 'bsc',
              addresses: [tokenAddress]
            }),
            credentials: 'include'
          });

          const data = await response.json();

          return {
            success: response.ok,
            status: response.status,
            data: data
          };
        } catch (error) {
          return {
            success: false,
            error: error.message
          };
        }
      },
      { endpoint, tokenAddress }
    );

    if (result.success && result.data && result.data.data && result.data.data.length > 0) {
      const tokenData = result.data.data[0];
      const priceData = tokenData.price;

      return {
        success: true,
        data: {
          name: tokenData.name,
          symbol: tokenData.symbol,
          price: priceData.price,
          price1m: priceData.price_1m,
          price5m: priceData.price_5m,
          price1h: priceData.price_1h,
          price6h: priceData.price_6h,
          price24h: priceData.price_24h,
          volume24h: priceData.volume_24h,
          buys24h: priceData.buys_24h,
          sells24h: priceData.sells_24h,
          liquidity: tokenData.liquidity,
          holderCount: tokenData.holder_count
        }
      };
    }

    return {
      success: false,
      error: result.error || '查詢失敗'
    };
  }

  /**
   * 批量查詢多個代幣的價格
   * @param {string[]} tokenAddresses - 代幣地址陣列
   * @returns {Promise<Object>} 多個代幣的價格信息
   */
  async getMultiTokenPrices(tokenAddresses) {
    const queryParams = getQueryParams();
    const params = new URLSearchParams(queryParams);
    const endpoint = `https://gmgn.ai/api/v1/mutil_window_token_info?${params}`;

    const result = await this.page.evaluate(
      async ({ endpoint, tokenAddresses }) => {
        try {
          const tgInfoStr = window.localStorage.getItem('tgInfo');
          let token = '';
          if (tgInfoStr) {
            try {
              const tgInfo = JSON.parse(tgInfoStr);
              token = 'Bearer ' + (tgInfo?.token?.access_token || '');
            } catch (e) {}
          }

          const response = await fetch(endpoint, {
            method: 'POST',
            headers: {
              'accept': 'application/json',
              'content-type': 'application/json',
              'authorization': token
            },
            body: JSON.stringify({
              chain: 'bsc',
              addresses: tokenAddresses
            }),
            credentials: 'include'
          });

          const data = await response.json();

          return {
            success: response.ok,
            status: response.status,
            data: data
          };
        } catch (error) {
          return {
            success: false,
            error: error.message
          };
        }
      },
      { endpoint, tokenAddresses }
    );

    if (result.success && result.data && result.data.data) {
      const tokens = result.data.data.map(tokenData => {
        const priceData = tokenData.price;
        return {
          address: tokenData.address,
          name: tokenData.name,
          symbol: tokenData.symbol,
          price: priceData.price,
          price1m: priceData.price_1m,
          price5m: priceData.price_5m,
          price1h: priceData.price_1h,
          volume24h: priceData.volume_24h,
          liquidity: tokenData.liquidity
        };
      });

      return {
        success: true,
        data: tokens
      };
    }

    return {
      success: false,
      error: result.error || '查詢失敗'
    };
  }

  /**
   * 設定錢包地址
   * @param {string} walletAddress - 新的錢包地址
   */
  setWalletAddress(walletAddress) {
    this.walletAddress = walletAddress;
  }

  /**
   * 關閉瀏覽器（釋放資源）
   * 注意：關閉後需要重新調用 init() 才能繼續使用
   */
  async close() {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
      this.page = null;
      this.context = null;
      this.isInitialized = false;
      console.log('✅ 瀏覽器已關閉');
    }
  }

  /**
   * 檢查瀏覽器是否已初始化
   */
  isReady() {
    return this.isInitialized;
  }
}

export default GmgnBrowserAPI;
