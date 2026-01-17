import express from 'express';
import db from '../database/db.js';
import logger from '../utils/logger.js';
import marketDataService from '../services/marketDataService.js';

const router = express.Router();

/**
 * 获取代币的市场数据（价格和市值）
 * GET /api/market/:tokenId
 */
router.get('/:tokenId', async (req, res) => {
  try {
    const tokenId = req.params.tokenId;

    // 获取代币信息
    const token = db.prepare('SELECT * FROM tokens WHERE id = ?').get(tokenId);

    if (!token) {
      return res.status(404).json({
        success: false,
        error: '代幣不存在',
      });
    }

    logger.info(`獲取市場數據: ${token.symbol} (${token.chain})`);

    // 获取市场数据
    const marketData = await marketDataService.getMarketData(token.chain, token.address);

    res.json({
      success: true,
      data: {
        tokenId: token.id,
        symbol: token.symbol,
        chain: token.chain,
        address: token.address,
        price: marketData.price,
        marketCap: marketData.marketCap,
        marketCapK: marketData.marketCapK,
        marketCapM: marketData.marketCapM,
        formattedPrice: `$${marketData.price.toFixed(6)}`,
        formattedMarketCap: marketDataService.formatMarketCap(marketData.marketCap),
      },
    });
  } catch (error) {
    logger.error('獲取市場數據失敗:', error.message);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

export default router;
