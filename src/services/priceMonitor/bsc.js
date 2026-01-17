import { ethers } from 'ethers';
import config from '../../config/config.js';
import logger from '../../utils/logger.js';

// PancakeSwap V2 Router ABI
const ROUTER_ABI = [
  'function getAmountsOut(uint amountIn, address[] memory path) public view returns (uint[] memory amounts)',
  'function factory() external pure returns (address)',
];

// PancakeSwap V2 Pair ABI
const PAIR_ABI = [
  'function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)',
  'function token0() external view returns (address)',
  'function token1() external view returns (address)',
];

// Factory ABI
const FACTORY_ABI = [
  'function getPair(address tokenA, address tokenB) external view returns (address pair)',
];

// ERC20 ABI
const ERC20_ABI = [
  'function totalSupply() external view returns (uint256)',
  'function decimals() external view returns (uint8)',
  'function symbol() external view returns (string)',
  'function balanceOf(address) external view returns (uint256)',
];

class BSCPriceMonitor {
  constructor() {
    this.provider = new ethers.JsonRpcProvider(config.rpc.bsc);
    this.router = new ethers.Contract(
      config.dex.bsc.routerV2,
      ROUTER_ABI,
      this.provider
    );
    this.factory = new ethers.Contract(
      config.dex.bsc.factoryV2,
      FACTORY_ABI,
      this.provider
    );
    this.wbnb = config.dex.bsc.wbnb;
    this.usdt = config.dex.bsc.usdt;
    this.busd = config.dex.bsc.busd;
    this.bnbPriceCache = { price: null, timestamp: 0 };
    this.cacheDuration = 60000; // 1分钟缓存 BNB 价格
  }

  /**
   * 获取 BNB/USD 价格（使用 USDT）
   * @returns {Promise<number>} BNB 的 USD 价格
   */
  async getBNBPrice() {
    try {
      // 检查缓存
      const now = Date.now();
      if (this.bnbPriceCache.price && (now - this.bnbPriceCache.timestamp) < this.cacheDuration) {
        return this.bnbPriceCache.price;
      }

      // 先尝试 WBNB/USDT 交易对
      let pairAddress = await this.factory.getPair(this.wbnb, this.usdt);
      let stablecoin = this.usdt;

      // 如果 USDT 交易对不存在，尝试 BUSD
      if (pairAddress === ethers.ZeroAddress) {
        pairAddress = await this.factory.getPair(this.wbnb, this.busd);
        stablecoin = this.busd;
      }

      if (pairAddress === ethers.ZeroAddress) {
        throw new Error('BNB/稳定币 交易对不存在');
      }

      const pair = new ethers.Contract(pairAddress, PAIR_ABI, this.provider);
      const reserves = await pair.getReserves();
      const token0 = await pair.token0();

      let bnbReserve, stablecoinReserve;
      if (token0.toLowerCase() === this.wbnb.toLowerCase()) {
        bnbReserve = reserves.reserve0;
        stablecoinReserve = reserves.reserve1;
      } else {
        bnbReserve = reserves.reserve1;
        stablecoinReserve = reserves.reserve0;
      }

      // 计算 BNB 价格 (稳定币储备 / BNB 储备)
      const bnbPrice = Number(stablecoinReserve) / Number(bnbReserve);

      // 更新缓存
      this.bnbPriceCache = { price: bnbPrice, timestamp: now };

      logger.debug(`BNB 价格: $${bnbPrice.toFixed(2)}`);
      return bnbPrice;
    } catch (error) {
      logger.error(`获取 BNB 价格失败:`, error.message);
      throw error;
    }
  }

  /**
   * 获取代币价格（以 BNB 计价）
   * @param {string} tokenAddress - 代币合约地址
   * @param {number} decimals - 代币精度
   * @returns {Promise<number>} 价格
   */
  async getPrice(tokenAddress, decimals = 18) {
    try {
      // 检查是否为 WBNB
      if (tokenAddress.toLowerCase() === this.wbnb.toLowerCase()) {
        return 1;
      }

      // 获取交易对地址
      const pairAddress = await this.factory.getPair(tokenAddress, this.wbnb);

      if (pairAddress === ethers.ZeroAddress) {
        throw new Error('交易对不存在');
      }

      // 建立交易对合约实例
      const pair = new ethers.Contract(pairAddress, PAIR_ABI, this.provider);

      // 获取储备量
      const reserves = await pair.getReserves();
      const token0 = await pair.token0();

      let tokenReserve, wbnbReserve;
      if (token0.toLowerCase() === tokenAddress.toLowerCase()) {
        tokenReserve = reserves.reserve0;
        wbnbReserve = reserves.reserve1;
      } else {
        tokenReserve = reserves.reserve1;
        wbnbReserve = reserves.reserve0;
      }

      // 计算价格 (WBNB 储备 / 代币储备)
      const price = Number(wbnbReserve) / Number(tokenReserve);

      logger.debug(`BSC 价格: ${tokenAddress} = ${price} BNB`);
      return price;
    } catch (error) {
      logger.error(`获取 BSC 价格失败 (${tokenAddress}):`, error.message);
      throw error;
    }
  }

  /**
   * 获取代币价格（以 USD 计价）
   * @param {string} tokenAddress - 代币合约地址
   * @param {number} decimals - 代币精度
   * @returns {Promise<number>} USD 价格
   */
  async getPriceInUSD(tokenAddress, decimals = 18) {
    try {
      // 如果是 WBNB，直接返回 BNB 价格
      if (tokenAddress.toLowerCase() === this.wbnb.toLowerCase()) {
        return await this.getBNBPrice();
      }

      // 先获取代币的 BNB 价格
      const priceInBNB = await this.getPrice(tokenAddress, decimals);

      // 获取 BNB 的 USD 价格
      const bnbPrice = await this.getBNBPrice();

      // 计算 USD 价格
      const priceInUSD = priceInBNB * bnbPrice;

      logger.debug(`BSC USD 价格: ${tokenAddress} = $${priceInUSD}`);
      return priceInUSD;
    } catch (error) {
      logger.error(`获取 BSC USD 价格失败:`, error.message);
      throw error;
    }
  }

  /**
   * 获取代币市值
   * @param {string} tokenAddress - 代币合约地址
   * @param {number} decimals - 代币精度
   * @returns {Promise<Object>} 返回 { priceUSD, marketCap, marketCapFormatted }
   */
  async getTokenInfo(tokenAddress, decimals = 18) {
    try {
      // 获取 USD 价格
      const priceUSD = await this.getPriceInUSD(tokenAddress, decimals);

      // 获取总供应量
      const tokenContract = new ethers.Contract(tokenAddress, ERC20_ABI, this.provider);
      const totalSupply = await tokenContract.totalSupply();
      const totalSupplyFormatted = Number(ethers.formatUnits(totalSupply, decimals));

      // 计算市值
      const marketCap = priceUSD * totalSupplyFormatted;

      // 格式化市值 (K/M)
      let marketCapFormatted;
      if (marketCap >= 1_000_000) {
        marketCapFormatted = `$${(marketCap / 1_000_000).toFixed(2)}M`;
      } else if (marketCap >= 1_000) {
        marketCapFormatted = `$${(marketCap / 1_000).toFixed(2)}K`;
      } else {
        marketCapFormatted = `$${marketCap.toFixed(2)}`;
      }

      logger.info(`BSC 代币信息: ${tokenAddress}`);
      logger.info(`  价格: $${priceUSD.toFixed(8)}`);
      logger.info(`  市值: ${marketCapFormatted}`);

      return {
        priceUSD,
        marketCap,
        marketCapFormatted,
        totalSupply: totalSupplyFormatted,
      };
    } catch (error) {
      logger.error(`获取 BSC 代币信息失败:`, error.message);
      throw error;
    }
  }

  /**
   * 获取交易对地址
   * @param {string} tokenAddress - 代币地址
   * @returns {Promise<string>} 交易对地址
   */
  async getPairAddress(tokenAddress) {
    try {
      const pairAddress = await this.factory.getPair(tokenAddress, this.wbnb);
      return pairAddress;
    } catch (error) {
      logger.error(`获取 BSC 交易对地址失败:`, error.message);
      throw error;
    }
  }
}

export default BSCPriceMonitor;
