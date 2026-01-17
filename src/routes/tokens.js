import express from 'express';
import db from '../database/db.js';
import logger from '../utils/logger.js';
import tokenMetadata from '../services/tokenMetadata.js';
import poolFinder from '../services/poolFinder.js';

const router = express.Router();

// 獲取所有代幣
router.get('/', (req, res) => {
  try {
    const tokens = db.prepare('SELECT * FROM tokens ORDER BY created_at DESC').all();
    res.json({ success: true, data: tokens });
  } catch (error) {
    logger.error('獲取代幣列表失敗:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// 獲取單個代幣
router.get('/:id', (req, res) => {
  try {
    const token = db.prepare('SELECT * FROM tokens WHERE id = ?').get(req.params.id);

    if (!token) {
      return res.status(404).json({ success: false, error: '代幣不存在' });
    }

    res.json({ success: true, data: token });
  } catch (error) {
    logger.error('獲取代幣失敗:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// 添加新代幣（支持自動獲取 metadata）
router.post('/', async (req, res) => {
  try {
    const { chain, address, symbol, decimals, pair_address } = req.body;

    // 驗證必填欄位
    if (!chain || !address) {
      return res.status(400).json({
        success: false,
        error: '缺少必填欄位: chain, address',
      });
    }

    let tokenSymbol = symbol;
    let tokenDecimals = decimals;
    let tokenPairAddress = pair_address;

    // 如果沒有提供 symbol 或 decimals，自動從鏈上獲取
    if (!symbol || !decimals) {
      logger.info('未提供完整 metadata，開始從鏈上自動獲取...');

      try {
        const metadata = await tokenMetadata.getMetadata(chain, address);

        tokenSymbol = symbol || metadata.symbol;
        tokenDecimals = decimals || metadata.decimals;
        tokenPairAddress = pair_address || metadata.pairAddress;

        logger.success(`成功獲取 metadata: ${metadata.name} (${metadata.symbol})`);

        // 如果仍然缺少必要資訊，提示用戶手動輸入
        if (!tokenSymbol || !tokenDecimals) {
          return res.status(400).json({
            success: false,
            error: '無法自動獲取完整的 token 資訊，請手動填寫 symbol 和 decimals',
            hint: '某些 token 可能沒有標準的 metadata，需要手動輸入',
          });
        }
      } catch (error) {
        logger.error('自動獲取 metadata 失敗:', error.message);
        return res.status(400).json({
          success: false,
          error: `無法獲取 token 資訊: ${error.message}`,
          hint: '請確認 token 地址是否正確，或手動填寫 symbol 和 decimals',
        });
      }
    }

    // 檢查是否已存在相同的 token
    const existing = db
      .prepare('SELECT id FROM tokens WHERE chain = ? AND address = ?')
      .get(chain, address);

    if (existing) {
      return res.status(400).json({
        success: false,
        error: '該代幣已存在',
      });
    }

    const stmt = db.prepare(`
      INSERT INTO tokens (chain, address, symbol, decimals, pair_address)
      VALUES (?, ?, ?, ?, ?)
    `);

    const result = stmt.run(chain, address, tokenSymbol, tokenDecimals, tokenPairAddress);
    const tokenId = result.lastInsertRowid;

    logger.success(`代幣已添加 (ID: ${tokenId}, Symbol: ${tokenSymbol})`);

    // 🔥 自動查找並儲存池子信息
    let poolInfo = null;
    try {
      logger.info('🔍 開始自動查找池子信息...');
      poolInfo = await poolFinder.findPoolForToken(
        tokenId,
        chain,
        address,
        tokenDecimals,
        tokenPairAddress
      );

      if (poolInfo) {
        logger.success('✅ 池子信息已自動儲存');
      } else {
        logger.warn('⚠️ 未找到池子信息（這不影響代幣添加）');
      }
    } catch (poolError) {
      logger.warn(`查找池子信息失敗: ${poolError.message}（這不影響代幣添加）`);
    }

    res.json({
      success: true,
      data: {
        id: tokenId,
        chain,
        address,
        symbol: tokenSymbol,
        decimals: tokenDecimals,
        pair_address: tokenPairAddress,
        pool_info: poolInfo, // 返回池子信息（如果有的話）
      },
    });
  } catch (error) {
    logger.error('添加代幣失敗:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// 更新代幣
router.put('/:id', (req, res) => {
  try {
    const { symbol, pair_address, pool_address, pool_protocol, pool_version, pool_pair_token } = req.body;
    const tokenId = req.params.id;

    const stmt = db.prepare(`
      UPDATE tokens
      SET symbol = COALESCE(?, symbol),
          pair_address = COALESCE(?, pair_address),
          pool_address = COALESCE(?, pool_address),
          pool_protocol = COALESCE(?, pool_protocol),
          pool_version = COALESCE(?, pool_version),
          pool_pair_token = COALESCE(?, pool_pair_token)
      WHERE id = ?
    `);

    const result = stmt.run(
      symbol,
      pair_address,
      pool_address,
      pool_protocol,
      pool_version,
      pool_pair_token,
      tokenId
    );

    if (result.changes === 0) {
      return res.status(404).json({ success: false, error: '代幣不存在' });
    }

    logger.info(`代幣已更新 (ID: ${tokenId})`);
    res.json({ success: true, message: '代幣已更新' });
  } catch (error) {
    logger.error('更新代幣失敗:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// 🔥 NEW: 重新查找池子信息
router.post('/:id/refresh-pool', async (req, res) => {
  try {
    const tokenId = req.params.id;

    // 獲取代幣信息
    const token = db.prepare('SELECT * FROM tokens WHERE id = ?').get(tokenId);

    if (!token) {
      return res.status(404).json({ success: false, error: '代幣不存在' });
    }

    logger.info(`重新查找池子信息: ${token.symbol} (${token.chain})`);

    // 查找池子
    const poolInfo = await poolFinder.findPoolForToken(
      tokenId,
      token.chain,
      token.address,
      token.decimals,
      token.pair_address
    );

    if (!poolInfo) {
      return res.json({
        success: false,
        message: '未找到池子信息',
      });
    }

    res.json({
      success: true,
      message: '池子信息已更新',
      data: poolInfo,
    });
  } catch (error) {
    logger.error('重新查找池子失敗:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// 刪除代幣
router.delete('/:id', (req, res) => {
  try {
    const tokenId = req.params.id;

    // 先檢查代幣是否存在
    const token = db.prepare('SELECT * FROM tokens WHERE id = ?').get(tokenId);
    if (!token) {
      return res.status(404).json({ success: false, error: '代幣不存在' });
    }

    // 使用事務確保資料一致性
    const deleteTransaction = db.transaction(() => {
      // 1. 刪除相關的訂單
      const deleteOrders = db.prepare('DELETE FROM orders WHERE token_id = ?');
      const ordersResult = deleteOrders.run(tokenId);
      logger.info(`刪除了 ${ordersResult.changes} 個相關訂單`);

      // 2. 刪除相關的價格提醒
      const deleteAlerts = db.prepare('DELETE FROM alerts WHERE token_id = ?');
      const alertsResult = deleteAlerts.run(tokenId);
      logger.info(`刪除了 ${alertsResult.changes} 個相關提醒`);

      // 3. 刪除價格歷史
      const deletePriceHistory = db.prepare('DELETE FROM price_history WHERE token_id = ?');
      const historyResult = deletePriceHistory.run(tokenId);
      logger.info(`刪除了 ${historyResult.changes} 條價格歷史`);

      // 4. 最後刪除代幣
      const deleteToken = db.prepare('DELETE FROM tokens WHERE id = ?');
      deleteToken.run(tokenId);
    });

    // 執行事務
    deleteTransaction();

    logger.success(`代幣已刪除 (ID: ${tokenId}, Symbol: ${token.symbol})`);
    res.json({
      success: true,
      message: '代幣及相關資料已刪除',
      deleted: {
        token: token.symbol,
        chain: token.chain
      }
    });
  } catch (error) {
    logger.error('刪除代幣失敗:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
