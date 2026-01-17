import express from 'express';
import BSCPriceMonitor from '../services/priceMonitor/bsc.js';
import SolanaPriceMonitor from '../services/priceMonitor/solana.js';
import BasePriceMonitor from '../services/priceMonitor/base.js';
import logger from '../utils/logger.js';
import db from '../database/db.js';

const router = express.Router();

const monitors = {
  bsc: new BSCPriceMonitor(),
  solana: new SolanaPriceMonitor(),
  base: new BasePriceMonitor(),
};

// 獲取代幣價格和市值信息
router.get('/:chain/:address', async (req, res) => {
  try {
    const { chain, address } = req.params;
    const { decimals, pairAddress } = req.query;

    if (!monitors[chain.toLowerCase()]) {
      return res.status(400).json({
        success: false,
        error: '不支援的鏈。支援的鏈: bsc, solana, base',
      });
    }

    // 🔥 查詢資料庫中的池子信息
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

    if (cachedPoolInfo) {
      logger.info(`✅ 使用緩存池子信息: ${cachedPoolInfo.protocol} ${cachedPoolInfo.version}`);
    }

    let tokenInfo;
    const monitor = monitors[chain.toLowerCase()];

    switch (chain.toLowerCase()) {
      case 'bsc':
        tokenInfo = await monitor.getTokenInfo(address, parseInt(decimals) || tokenFromDb?.decimals || 18);
        break;
      case 'solana':
        // 傳遞緩存的池子信息
        tokenInfo = await monitor.getTokenInfo(
          address,
          null,
          null,
          null,
          'raydium',
          cachedPoolInfo
        );
        break;
      case 'base':
        // 如果提供了 pairAddress，使用指定的 pair；否则使用緩存或自动查找
        if (pairAddress) {
          tokenInfo = await monitor.getTokenInfoWithPair(pairAddress, address, parseInt(decimals) || tokenFromDb?.decimals || 18);
        } else {
          // 使用緩存的池子信息獲取價格
          const tokenDecimals = parseInt(decimals) || tokenFromDb?.decimals || 18;
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
        }
        break;
      default:
        return res.status(400).json({ success: false, error: '不支援的鏈' });
    }

    res.json({
      success: true,
      data: {
        chain,
        address,
        priceUSD: tokenInfo.priceUSD,
        marketCap: tokenInfo.marketCap,
        marketCapFormatted: tokenInfo.marketCapFormatted,
        totalSupply: tokenInfo.totalSupply,
        usedCachedPool: !!cachedPoolInfo,
        poolInfo: cachedPoolInfo,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    logger.error('獲取價格失敗:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// 批量獲取代幣價格和市值信息（支援快取池子）
router.post('/batch', async (req, res) => {
  try {
    const { tokens } = req.body;

    if (!Array.isArray(tokens)) {
      return res.status(400).json({
        success: false,
        error: 'tokens 必須是陣列',
      });
    }

    const prices = await Promise.allSettled(
      tokens.map(async (token) => {
        const monitor = monitors[token.chain.toLowerCase()];

        // 🔥 查詢資料庫中的池子信息
        const tokenFromDb = db.prepare(`
          SELECT pool_address, pool_protocol, pool_version, pool_pair_token, decimals
          FROM tokens
          WHERE chain = ? AND address = ?
        `).get(token.chain.toLowerCase(), token.address);

        const cachedPoolInfo = tokenFromDb && tokenFromDb.pool_address ? {
          poolAddress: tokenFromDb.pool_address,
          protocol: tokenFromDb.pool_protocol,
          version: tokenFromDb.pool_version,
          pairToken: tokenFromDb.pool_pair_token,
        } : null;

        const tokenDecimals = token.decimals || tokenFromDb?.decimals || 18;

        let tokenInfo;

        switch (token.chain.toLowerCase()) {
          case 'bsc':
            tokenInfo = await monitor.getTokenInfo(token.address, tokenDecimals);
            break;

          case 'solana':
            // Solana 支援快取池子
            if (cachedPoolInfo) {
              tokenInfo = await monitor.getTokenInfo(token.address, null, null, null, 'raydium', cachedPoolInfo);
            } else {
              tokenInfo = await monitor.getTokenInfo(token.address);
            }
            break;

          case 'base':
            // Base 支援快取池子
            if (cachedPoolInfo) {
              const priceUSD = await monitor.getPriceInUSD(token.address, tokenDecimals, cachedPoolInfo);
              const { ethers } = await import('ethers');
              const ERC20_ABI = ['function totalSupply() external view returns (uint256)'];
              const tokenContract = new ethers.Contract(token.address, ERC20_ABI, monitor.provider);
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
            } else if (token.pairAddress) {
              tokenInfo = await monitor.getTokenInfoWithPair(token.pairAddress, token.address, tokenDecimals);
            } else {
              tokenInfo = await monitor.getTokenInfo(token.address, tokenDecimals);
            }
            break;
        }

        return {
          ...token,
          priceUSD: tokenInfo.priceUSD,
          marketCap: tokenInfo.marketCap,
          marketCapFormatted: tokenInfo.marketCapFormatted,
          totalSupply: tokenInfo.totalSupply,
          usedCachedPool: !!cachedPoolInfo,
          poolInfo: cachedPoolInfo,
          timestamp: new Date().toISOString(),
        };
      })
    );

    const results = prices.map((result, index) => {
      if (result.status === 'fulfilled') {
        return result.value;
      } else {
        return {
          ...tokens[index],
          error: result.reason.message,
        };
      }
    });

    res.json({ success: true, data: results });
  } catch (error) {
    logger.error('批量獲取價格失敗:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
