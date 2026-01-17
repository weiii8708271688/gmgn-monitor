/**
 * 價格測試 - 只提供 token mint/address，測試能否正常添加並獲取價格
 * 用法: node test-prices.js
 *
 * 目的：測試功能是否正常（不使用快取，從零開始）
 */

import { ethers } from 'ethers';
import { Connection, PublicKey } from '@solana/web3.js';
import BasePriceMonitor from './src/services/priceMonitor/base.js';
import SolanaPriceMonitor from './src/services/priceMonitor/solana.js';
import BSCPriceMonitor from './src/services/priceMonitor/bsc.js';
import poolFinder from './src/services/poolFinder.js';
import config from './src/config/config.js';
import db from './src/database/db.js';
import logger from './src/utils/logger.js';

// 禁用 logger 輸出以獲得更清晰的測試結果
logger.level = 'error';

// 測試配置 - 只提供 mint/address
const TEST_TOKENS = {
  base: {
    address: '0x69c01c325e532e2eb10f6c202dca432c1b109365',
  },
  solana: {
    mint: '83kGGSggYGP2ZEEyvX54SkZR1kFn84RgGCDyptbDbonk',
  },
  bsc: {
    address: '0x4444536331bad0c0b9c1d7dc74b00632926de675',
  }
};

// ERC20 ABI for getting decimals and symbol
const ERC20_ABI = [
  'function decimals() external view returns (uint8)',
  'function symbol() external view returns (string)',
];

/**
 * 從合約獲取 ERC20 token 信息
 */
async function getERC20Info(provider, address) {
  try {
    const contract = new ethers.Contract(address, ERC20_ABI, provider);
    const [decimals, symbol] = await Promise.all([
      contract.decimals(),
      contract.symbol()
    ]);
    return { decimals: Number(decimals), symbol };
  } catch (error) {
    console.log(`   ⚠️  無法獲取代幣信息: ${error.message}`);
    // 使用預設值
    return { decimals: 18, symbol: 'UNKNOWN' };
  }
}

/**
 * 從 Solana 合約獲取 SPL token 信息
 */
async function getSPLTokenInfo(mintAddress) {
  try {
    const connection = new Connection(config.rpc.solana);
    const mintPubkey = new PublicKey(mintAddress);

    // 獲取 mint 信息
    const mintInfo = await connection.getParsedAccountInfo(mintPubkey);
    if (mintInfo.value && mintInfo.value.data.parsed) {
      const decimals = mintInfo.value.data.parsed.info.decimals;
      return { decimals, symbol: 'UNKNOWN' };
    }

    return { decimals: 9, symbol: 'UNKNOWN' }; // Solana 預設
  } catch (error) {
    console.log(`   ⚠️  無法獲取代幣信息: ${error.message}`);
    return { decimals: 9, symbol: 'UNKNOWN' };
  }
}

/**
 * 確保 token 存在於資料庫中
 */
function ensureTokenInDB(chain, address, symbol, decimals) {
  // 檢查是否已存在
  let token = db.prepare(`
    SELECT * FROM tokens
    WHERE chain = ? AND address = ?
  `).get(chain, address);

  if (token) {
    console.log(`   ✅ Token 已存在於資料庫 (ID: ${token.id})`);
    return token;
  }

  // 創建新 token
  console.log(`   📝 正在創建新 token...`);
  const stmt = db.prepare(`
    INSERT INTO tokens (chain, address, symbol, decimals)
    VALUES (?, ?, ?, ?)
  `);
  const result = stmt.run(chain, address, symbol, decimals);

  token = db.prepare('SELECT * FROM tokens WHERE id = ?').get(result.lastInsertRowid);
  console.log(`   ✅ Token 已創建 (ID: ${token.id})`);

  return token;
}

/**
 * 測試 Base 鏈價格
 */
async function testBasePrices() {
  console.log('\n╔═══════════════════════════════════════════╗');
  console.log('║  測試 Base 鏈價格 (Uniswap V3/V4)        ║');
  console.log('╚═══════════════════════════════════════════╝\n');

  const basePriceMonitor = new BasePriceMonitor();
  const provider = basePriceMonitor.provider;

  try {
    const tokenAddress = TEST_TOKENS.base.address;
    console.log(`📊 Token 地址: ${tokenAddress}\n`);

    // 步驟 1: 獲取 token 信息
    console.log('==================================================');
    console.log('📊 步驟 1: 獲取代幣基本信息');
    console.log('==================================================\n');

    const tokenInfo = await getERC20Info(provider, tokenAddress);
    console.log(`   Symbol: ${tokenInfo.symbol}`);
    console.log(`   Decimals: ${tokenInfo.decimals}\n`);

    // 步驟 2: 確保在資料庫中
    console.log('==================================================');
    console.log('📊 步驟 2: 檢查/創建資料庫記錄');
    console.log('==================================================\n');

    const token = ensureTokenInDB('base', tokenAddress, tokenInfo.symbol, tokenInfo.decimals);

    // 步驟 3: 查找並儲存池子信息
    console.log('\n==================================================');
    console.log('📊 步驟 3: 查找並儲存最佳池子');
    console.log('==================================================\n');

    if (!token.pool_address) {
      console.log('⏳ 正在查找最佳池子...');
      const startTime = Date.now();

      const poolInfo = await poolFinder.findAndSaveBasePool(token.id, tokenAddress, tokenInfo.decimals);

      const duration = ((Date.now() - startTime) / 1000).toFixed(2);
      console.log(`⏱️  查找耗時: ${duration} 秒`);

      if (poolInfo) {
        console.log(`✅ 池子信息已儲存！`);
        console.log(`   協議: ${poolInfo.protocol}`);
        console.log(`   版本: ${poolInfo.version}`);
        console.log(`   配對: ${poolInfo.pairToken}\n`);
      }
    } else {
      console.log(`✅ 池子信息已存在:`);
      console.log(`   協議: ${token.pool_protocol}`);
      console.log(`   版本: ${token.pool_version}`);
      console.log(`   配對: ${token.pool_pair_token}\n`);
    }

    // 步驟 4: 測試無快取查詢（證明功能正常）
    console.log('==================================================');
    console.log('📊 步驟 4: 測試無快取查詢（自動搜尋）');
    console.log('==================================================\n');

    console.log('⏳ 正在查詢價格（不使用快取，自動搜尋池子）...');
    const startTime = Date.now();

    const price = await basePriceMonitor.getPriceInUSD(
      tokenAddress,
      tokenInfo.decimals,
      null // 不傳入快取，測試自動搜尋功能
    );

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`⏱️  查詢耗時: ${duration} 秒`);
    console.log(`💵 價格: $${price.toFixed(8)}\n`);

  } catch (error) {
    console.error('❌ Base 價格測試失敗:', error.message);
    console.error(error.stack);
  }
}

/**
 * 測試 Solana 鏈價格
 */
async function testSolanaPrices() {
  console.log('\n╔═══════════════════════════════════════════╗');
  console.log('║  測試 Solana 鏈價格 (Raydium)             ║');
  console.log('╚═══════════════════════════════════════════╝\n');

  const solanaPriceMonitor = new SolanaPriceMonitor();

  try {
    const tokenMint = TEST_TOKENS.solana.mint;
    console.log(`📊 Token Mint: ${tokenMint}\n`);

    // 步驟 1: 獲取 token 信息
    console.log('==================================================');
    console.log('📊 步驟 1: 獲取代幣基本信息');
    console.log('==================================================\n');

    const tokenInfo = await getSPLTokenInfo(tokenMint);
    console.log(`   Decimals: ${tokenInfo.decimals}\n`);

    // 步驟 2: 確保在資料庫中
    console.log('==================================================');
    console.log('📊 步驟 2: 檢查/創建資料庫記錄');
    console.log('==================================================\n');

    const token = ensureTokenInDB('solana', tokenMint, tokenInfo.symbol, tokenInfo.decimals);

    // 步驟 3: 查找並儲存池子信息
    console.log('\n==================================================');
    console.log('📊 步驟 3: 查找並儲存最佳池子');
    console.log('==================================================\n');

    if (!token.pool_address) {
      console.log('⏳ 正在查找最佳池子...');
      const startTime = Date.now();

      const poolInfo = await poolFinder.findAndSaveSolanaPool(token.id, tokenMint);

      const duration = ((Date.now() - startTime) / 1000).toFixed(2);
      console.log(`⏱️  查找耗時: ${duration} 秒`);

      if (poolInfo) {
        console.log(`✅ 池子信息已儲存！`);
        console.log(`   協議: ${poolInfo.protocol}`);
        console.log(`   版本: ${poolInfo.version}`);
        console.log(`   配對: ${poolInfo.pairToken}`);
        console.log(`   流動性: ${poolInfo.liquidity?.toLocaleString() || 'N/A'}\n`);
      }
    } else {
      console.log(`✅ 池子信息已存在:`);
      console.log(`   協議: ${token.pool_protocol}`);
      console.log(`   版本: ${token.pool_version}`);
      console.log(`   配對: ${token.pool_pair_token}\n`);
    }

    // 步驟 4: 測試無快取查詢（證明功能正常）
    console.log('==================================================');
    console.log('📊 步驟 4: 測試無快取查詢（自動搜尋）');
    console.log('==================================================\n');

    console.log('⏳ 正在查詢價格（不使用快取，自動搜尋池子）...');
    const startTime = Date.now();

    const result = await solanaPriceMonitor.getSmartPrice(tokenMint, 'onchain');

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`⏱️  查詢耗時: ${duration} 秒`);
    console.log(`💵 價格: $${result.price.toFixed(8)}`);
    console.log(`📡 來源: ${result.source}\n`);

  } catch (error) {
    console.error('❌ Solana 價格測試失敗:', error.message);
    console.error(error.stack);
  }
}

/**
 * 測試 BSC 鏈價格
 */
async function testBSCPrices() {
  console.log('\n╔═══════════════════════════════════════════╗');
  console.log('║  測試 BSC 鏈價格 (PancakeSwap)            ║');
  console.log('╚═══════════════════════════════════════════╝\n');

  const bscPriceMonitor = new BSCPriceMonitor();
  const provider = bscPriceMonitor.provider;

  try {
    const tokenAddress = TEST_TOKENS.bsc.address;
    console.log(`📊 Token 地址: ${tokenAddress}\n`);

    // 步驟 1: 獲取 token 信息
    console.log('==================================================');
    console.log('📊 步驟 1: 獲取代幣基本信息');
    console.log('==================================================\n');

    const tokenInfo = await getERC20Info(provider, tokenAddress);
    console.log(`   Symbol: ${tokenInfo.symbol}`);
    console.log(`   Decimals: ${tokenInfo.decimals}\n`);

    // 步驟 2: 確保在資料庫中
    console.log('==================================================');
    console.log('📊 步驟 2: 檢查/創建資料庫記錄');
    console.log('==================================================\n');

    const token = ensureTokenInDB('bsc', tokenAddress, tokenInfo.symbol, tokenInfo.decimals);

    // 步驟 3: 獲取 PancakeSwap pair address（BSC 不做快取）
    console.log('\n==================================================');
    console.log('📊 步驟 3: 查找 PancakeSwap LP 地址');
    console.log('==================================================\n');

    console.log('⏳ 正在查找 LP 地址...');
    let pairAddress = null;

    try {
      pairAddress = await bscPriceMonitor.factory.getPair(tokenAddress, bscPriceMonitor.wbnb);

      if (pairAddress !== ethers.ZeroAddress) {
        console.log(`✅ 找到 LP 地址: ${pairAddress}\n`);
      } else {
        console.log(`❌ 未找到 LP 地址\n`);
      }
    } catch (error) {
      console.log(`❌ 查找 LP 失敗: ${error.message}\n`);
    }

    // 步驟 4: 測試查詢價格（BSC 直接用 pair address，不做快取）
    console.log('==================================================');
    console.log('📊 步驟 4: 測試查詢價格');
    console.log('==================================================\n');

    if (pairAddress && pairAddress !== ethers.ZeroAddress) {
      console.log('⏳ 正在查詢價格（使用 LP 地址）...');
      const startTime = Date.now();

      const price = await bscPriceMonitor.getPriceInUSDWithPair(
        pairAddress,
        tokenAddress,
        tokenInfo.decimals
      );

      const duration = ((Date.now() - startTime) / 1000).toFixed(2);
      console.log(`⏱️  查詢耗時: ${duration} 秒`);
      console.log(`💵 價格: $${price.toFixed(8)}\n`);
    } else {
      console.log('❌ 未找到 LP，無法查詢價格\n');
    }

  } catch (error) {
    console.error('❌ BSC 價格測試失敗:', error.message);
    console.error(error.stack);
  }
}

async function main() {
  console.log('\n╔═══════════════════════════════════════════════════════╗');
  console.log('║          價格監控系統測試 - 功能測試                   ║');
  console.log('║  Base (Uniswap) | Solana (Raydium) | BSC (PancakeSwap) ║');
  console.log('║           測試能否正常添加新 token 並獲取價格           ║');
  console.log('╚═══════════════════════════════════════════════════════╝');

  const startTime = Date.now();

  // 測試 Base 鏈
  await testBasePrices();

  // 測試 Solana 鏈
  await testSolanaPrices();

  // 測試 BSC 鏈
  await testBSCPrices();

  const endTime = Date.now();
  const duration = ((endTime - startTime) / 1000).toFixed(2);

  console.log('\n╔═══════════════════════════════════════════╗');
  console.log('║  測試完成總結                              ║');
  console.log('╚═══════════════════════════════════════════╝\n');
  console.log(`⏱️  總耗時: ${duration} 秒`);
  console.log(`📊 測試項目:`);
  console.log(`   🔵 Base 價格測試 + 池子發現 + 無快取查詢`);
  console.log(`   🟣 Solana 價格測試 + 池子發現 + 無快取查詢`);
  console.log(`   🟡 BSC 價格測試 + LP 查找 + 查詢`);
  console.log('\n✅ 所有測試完成！');
  console.log('💡 Base 和 Solana 的池子信息已儲存到資料庫');
  console.log('💡 可使用 test-cache-speed.js 測試 Base 和 Solana 的快取速度\n');
}

// 執行測試
main().catch(console.error);
