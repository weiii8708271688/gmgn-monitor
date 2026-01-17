import logger from '../utils/logger.js';
import db from '../database/db.js';
import BSCPriceMonitor from './priceMonitor/bsc.js';
import SolanaPriceMonitor from './priceMonitor/solana.js';
import BasePriceMonitor from './priceMonitor/base.js';

class MarketDataService {
  constructor() {
    this.priceMonitors = {
      bsc: new BSCPriceMonitor(),
      solana: new SolanaPriceMonitor(),
      base: new BasePriceMonitor(),
    };
  }

  /**
   * 🔥 獲取代幣的價格和市值信息（使用快取池子，不使用外部 API）
   * @param {string} chain - 鏈名稱
   * @param {string} address - 代幣地址
   * @param {number} decimals - 代幣精度（可選，優先從資料庫讀取）
   * @returns {Promise<Object>} 包含價格和市值的對象
   */
  async getMarketData(chain, address, decimals = null) {
    try {
      const monitor = this.priceMonitors[chain.toLowerCase()];
      if (!monitor) {
        throw new Error(`不支援的鏈: ${chain}`);
      }

      // 🔥 從資料庫獲取快取的池子信息
      const tokenFromDb = db.prepare(`
        SELECT pool_address, pool_protocol, pool_version, pool_pair_token, decimals
        FROM tokens
        WHERE chain = ? AND address = ?
      `).get(chain.toLowerCase(), address);

      const cachedPoolInfo = tokenFromDb && tokenFromDb.pool_address ? {
        poolAddress: tokenFromDb.pool_address,
        protocol: tokenFromDb.pool_protocol,
        version: tokenFromDb.pool_version,
        pairToken: tokenFromDb.pool_pair_token,
      } : null;

      const tokenDecimals = decimals || tokenFromDb?.decimals || 18;

      if (cachedPoolInfo) {
        logger.info(`✅ 使用快取池子獲取市場數據: ${cachedPoolInfo.protocol} ${cachedPoolInfo.version}`);
      }

      // 獲取代幣完整信息（價格 + 市值）
      let tokenInfo;

      switch (chain.toLowerCase()) {
        case 'bsc':
          tokenInfo = await monitor.getTokenInfo(address, tokenDecimals);
          break;

        case 'solana':
          // Solana 支援快取池子
          if (cachedPoolInfo) {
            tokenInfo = await monitor.getTokenInfo(address, null, null, null, 'raydium', cachedPoolInfo);
          } else {
            tokenInfo = await monitor.getTokenInfo(address);
          }
          break;

        case 'base':
          // Base 支援快取池子
          if (cachedPoolInfo) {
            const priceUSD = await monitor.getPriceInUSD(address, tokenDecimals, cachedPoolInfo);
            const { ethers } = await import('ethers');
            const ERC20_ABI = ['function totalSupply() external view returns (uint256)'];
            const tokenContract = new ethers.Contract(address, ERC20_ABI, monitor.provider);
            const totalSupply = await tokenContract.totalSupply();
            const totalSupplyFormatted = Number(ethers.formatUnits(totalSupply, tokenDecimals));
            const marketCap = priceUSD * totalSupplyFormatted;

            let marketCapFormatted;
            if (marketCap >= 1_000_000) {
              marketCapFormatted = `$${(marketCap / 1_000_000).toFixed(2)}M`;
            } else if (marketCap >= 1_000) {
              marketCapFormatted = `$${(marketCap / 1_000).toFixed(2)}K`;
            } else {
              marketCapFormatted = `$${marketCap.toFixed(2)}`;
            }

            tokenInfo = { priceUSD, marketCap, marketCapFormatted, totalSupply: totalSupplyFormatted };
          } else {
            tokenInfo = await monitor.getTokenInfo(address, tokenDecimals);
          }
          break;

        default:
          throw new Error(`不支援的鏈: ${chain}`);
      }

      if (!tokenInfo || !tokenInfo.priceUSD || tokenInfo.priceUSD === 0) {
        return {
          price: 0,
          marketCap: null,
          marketCapFormatted: 'N/A',
          error: '無法獲取價格',
          usedCachedPool: !!cachedPoolInfo,
        };
      }

      return {
        price: tokenInfo.priceUSD,
        marketCap: tokenInfo.marketCap,
        marketCapK: tokenInfo.marketCap ? (tokenInfo.marketCap / 1000).toFixed(2) : null,
        marketCapM: tokenInfo.marketCap ? (tokenInfo.marketCap / 1000000).toFixed(2) : null,
        marketCapFormatted: tokenInfo.marketCapFormatted,
        totalSupply: tokenInfo.totalSupply,
        usedCachedPool: !!cachedPoolInfo,
        poolInfo: cachedPoolInfo,
      };
    } catch (error) {
      logger.error(`獲取市場數據失敗 (${chain} - ${address}):`, error.message);
      throw error;
    }
  }

  /**
   * 格式化市值显示
   * @param {number} marketCap - 市值（美元）
   * @param {string} unit - 单位 ('K' 或 'M')
   * @returns {string} 格式化的市值
   */
  formatMarketCap(marketCap, unit = 'auto') {
    if (!marketCap) return 'N/A';

    if (unit === 'K') {
      return `${(marketCap / 1000).toFixed(2)}K`;
    } else if (unit === 'M') {
      return `${(marketCap / 1000000).toFixed(2)}M`;
    } else {
      // 自动选择单位
      if (marketCap >= 1000000) {
        return `${(marketCap / 1000000).toFixed(2)}M`;
      } else if (marketCap >= 1000) {
        return `${(marketCap / 1000).toFixed(2)}K`;
      } else {
        return `$${marketCap.toFixed(2)}`;
      }
    }
  }
}

export default new MarketDataService();
