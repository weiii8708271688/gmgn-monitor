import { ethers } from 'ethers';
import db from '../database/db.js';
import logger from '../utils/logger.js';
import SolanaPriceMonitor from './priceMonitor/solana.js';
import BasePriceMonitor from './priceMonitor/base.js';

class PoolFinder {
  constructor() {
    this.solanaMonitor = new SolanaPriceMonitor();
    this.baseMonitor = new BasePriceMonitor();
  }

  /**
   * 為 Solana 代幣查找並儲存池子信息
   * @param {number} tokenId - 代幣 ID
   * @param {string} tokenAddress - 代幣地址
   * @returns {Promise<Object>} 池子信息
   */
  async findAndSaveSolanaPool(tokenId, tokenAddress) {
    try {
      logger.info(`🔍 正在為 Solana 代幣查找最佳池子: ${tokenAddress}`);

      // 使用智能查找功能
      const poolInfo = await this.solanaMonitor.findBestPoolForToken(tokenAddress);

      if (!poolInfo) {
        logger.warn(`未找到池子: ${tokenAddress}`);
        return null;
      }

      // 提取池子信息
      const {
        poolAddress,
        type,
        pairMint,
        pairName,
        liquidity,
      } = poolInfo;

      // 儲存到資料庫
      const stmt = db.prepare(`
        UPDATE tokens
        SET pool_address = ?,
            pool_protocol = ?,
            pool_version = ?,
            pool_pair_token = ?
        WHERE id = ?
      `);

      stmt.run(
        poolAddress.toString(),
        'Raydium',
        type,
        pairName,
        tokenId
      );

      logger.success(`✅ 池子信息已儲存:`);
      logger.info(`   協議: Raydium`);
      logger.info(`   版本: ${type}`);
      logger.info(`   地址: ${poolAddress.toString()}`);
      logger.info(`   配對: ${pairName}`);
      logger.info(`   流動性: ${liquidity.toLocaleString()}`);

      return {
        poolAddress: poolAddress.toString(),
        protocol: 'Raydium',
        version: type,
        pairToken: pairName,
        liquidity,
      };
    } catch (error) {
      logger.error(`查找 Solana 池子失敗: ${error.message}`);
      throw error;
    }
  }

  /**
   * 為 Base 代幣查找並儲存池子信息
   * @param {number} tokenId - 代幣 ID
   * @param {string} tokenAddress - 代幣地址
   * @param {number} decimals - 代幣精度
   * @returns {Promise<Object>} 池子信息
   */
  async findAndSaveBasePool(tokenId, tokenAddress, decimals = 18) {
    try {
      logger.info(`🔍 正在為 Base 代幣查找最佳池子: ${tokenAddress}`);

      // 嘗試獲取價格，同時檢測使用的協議版本
      let protocol = 'Uniswap';
      let version = null;
      let poolAddress = null;
      let pairToken = 'WETH';

      // 嘗試 V4
      for (const config of this.baseMonitor.v4Configs) {
        try {
          const poolId = this.baseMonitor.getPoolId(
            tokenAddress,
            this.baseMonitor.weth,
            config.fee,
            config.tickSpacing
          );

          const slot0 = await this.baseMonitor.stateView.getSlot0(poolId);
          if (slot0[0] !== 0n) {
            version = 'V4';
            poolAddress = poolId;
            logger.success(`✅ 找到 Uniswap V4 池子 (fee: ${config.fee})`);
            break;
          }
        } catch (error) {
          continue;
        }
      }

      // 如果 V4 沒找到，嘗試 V3
      if (!version) {
        for (const fee of this.baseMonitor.v3Fees) {
          try {
            const amountIn = ethers.parseUnits('1', decimals);
            const params = {
              tokenIn: tokenAddress,
              tokenOut: this.baseMonitor.weth,
              amountIn: amountIn,
              fee: fee,
              sqrtPriceLimitX96: 0,
            };

            const result = await this.baseMonitor.quoterV2.quoteExactInputSingle.staticCall(params);
            if (result[0] > 0n) {
              version = 'V3';
              // V3 池子地址需要計算，這裡暫時用 fee 標識
              poolAddress = `V3-fee${fee}`;
              logger.success(`✅ 找到 Uniswap V3 池子 (fee: ${fee})`);
              break;
            }
          } catch (error) {
            continue;
          }
        }
      }

      // 如果 V3 沒找到，嘗試 V2
      if (!version) {
        try {
          const pairAddress = await this.baseMonitor.factoryV2.getPair(tokenAddress, this.baseMonitor.weth);
          if (pairAddress !== ethers.ZeroAddress) {
            version = 'V2';
            poolAddress = pairAddress;
            logger.success(`✅ 找到 Uniswap V2 池子`);
          }
        } catch (error) {
          logger.warn(`V2 查找失敗: ${error.message}`);
        }
      }

      if (!version) {
        logger.warn(`未找到任何 Uniswap 池子: ${tokenAddress}`);
        return null;
      }

      // 儲存到資料庫
      const stmt = db.prepare(`
        UPDATE tokens
        SET pool_address = ?,
            pool_protocol = ?,
            pool_version = ?,
            pool_pair_token = ?
        WHERE id = ?
      `);

      stmt.run(
        poolAddress,
        protocol,
        version,
        pairToken,
        tokenId
      );

      logger.success(`✅ 池子信息已儲存:`);
      logger.info(`   協議: ${protocol}`);
      logger.info(`   版本: ${version}`);
      logger.info(`   地址/ID: ${poolAddress}`);
      logger.info(`   配對: ${pairToken}`);

      return {
        poolAddress,
        protocol,
        version,
        pairToken,
      };
    } catch (error) {
      logger.error(`查找 Base 池子失敗: ${error.message}`);
      throw error;
    }
  }

  /**
   * 為 BSC 代幣儲存池子信息（BSC 使用 pair_address）
   * @param {number} tokenId - 代幣 ID
   * @param {string} pairAddress - PancakeSwap 池子地址
   */
  async saveBSCPool(tokenId, pairAddress) {
    try {
      const stmt = db.prepare(`
        UPDATE tokens
        SET pool_address = ?,
            pool_protocol = ?,
            pool_version = ?,
            pool_pair_token = ?
        WHERE id = ?
      `);

      stmt.run(
        pairAddress,
        'PancakeSwap',
        'V2',
        'WBNB',
        tokenId
      );

      logger.success(`✅ BSC 池子信息已儲存 (PancakeSwap V2)`);
    } catch (error) {
      logger.error(`儲存 BSC 池子信息失敗: ${error.message}`);
      throw error;
    }
  }

  /**
   * 自動為代幣查找並儲存池子信息
   * @param {number} tokenId - 代幣 ID
   * @param {string} chain - 鏈名稱
   * @param {string} address - 代幣地址
   * @param {number} decimals - 代幣精度
   * @param {string} pairAddress - 已知的 pair 地址（可選，用於 BSC）
   * @returns {Promise<Object>} 池子信息
   */
  async findPoolForToken(tokenId, chain, address, decimals, pairAddress = null) {
    try {
      logger.info(`🔍 開始為 ${chain} 代幣查找池子: ${address}`);

      switch (chain.toLowerCase()) {
        case 'solana':
          return await this.findAndSaveSolanaPool(tokenId, address);

        case 'base':
          return await this.findAndSaveBasePool(tokenId, address, decimals);

        case 'bsc':
          if (pairAddress) {
            await this.saveBSCPool(tokenId, pairAddress);
            return {
              poolAddress: pairAddress,
              protocol: 'PancakeSwap',
              version: 'V2',
              pairToken: 'WBNB',
            };
          } else {
            logger.warn('BSC 需要提供 pair_address');
            return null;
          }

        default:
          logger.warn(`不支援的鏈: ${chain}`);
          return null;
      }
    } catch (error) {
      logger.error(`查找池子失敗 (${chain}): ${error.message}`);
      return null;
    }
  }

  /**
   * 獲取代幣的池子信息（從資料庫）
   * @param {number} tokenId - 代幣 ID
   * @returns {Object|null} 池子信息
   */
  getPoolInfo(tokenId) {
    try {
      const token = db.prepare(`
        SELECT pool_address, pool_protocol, pool_version, pool_pair_token
        FROM tokens
        WHERE id = ?
      `).get(tokenId);

      if (!token || !token.pool_address) {
        return null;
      }

      return {
        poolAddress: token.pool_address,
        protocol: token.pool_protocol,
        version: token.pool_version,
        pairToken: token.pool_pair_token,
      };
    } catch (error) {
      logger.error(`獲取池子信息失敗: ${error.message}`);
      return null;
    }
  }

  /**
   * 清除代幣的池子信息
   * @param {number} tokenId - 代幣 ID
   */
  clearPoolInfo(tokenId) {
    try {
      const stmt = db.prepare(`
        UPDATE tokens
        SET pool_address = NULL,
            pool_protocol = NULL,
            pool_version = NULL,
            pool_pair_token = NULL
        WHERE id = ?
      `);

      stmt.run(tokenId);
      logger.info(`池子信息已清除 (Token ID: ${tokenId})`);
    } catch (error) {
      logger.error(`清除池子信息失敗: ${error.message}`);
      throw error;
    }
  }
}

export default new PoolFinder();
