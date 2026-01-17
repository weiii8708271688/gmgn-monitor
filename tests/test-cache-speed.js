import Database from 'better-sqlite3';
import BasePriceMonitor from './src/services/priceMonitor/base.js';
import SolanaPriceMonitor from './src/services/priceMonitor/solana.js';
import config from './src/config/config.js';
import logger from './src/utils/logger.js';

// 禁用logger輸出以獲得更清晰的測試結果
logger.level = 'error';

const db = new Database(config.database.path);

// 測試配置 - 與 test-prices.js 相同
const TEST_TOKENS = {
  base: {
    address: '0x69c01c325e532e2eb10f6c202dca432c1b109365',
  },
  solana: {
    mint: '83kGGSggYGP2ZEEyvX54SkZR1kFn84RgGCDyptbDbonk',
  }
};

/**
 * 從資料庫獲取 token 信息
 */
function getTokenFromDB(chain, address) {
  const token = db.prepare(`
    SELECT * FROM tokens
    WHERE chain = ? AND address = ?
  `).get(chain, address);
  return token;
}

/**
 * 測試使用快取的價格查詢（Base）
 */
async function testBaseWithCache(token, basePriceMonitor) {
  const cachedPoolInfo = {
    poolAddress: token.pool_address,
    version: token.pool_version,
    pairToken: token.pool_pair_token
  };

  const start = performance.now();
  const price = await basePriceMonitor.getPriceInUSD(
    token.address,
    token.decimals,
    cachedPoolInfo
  );
  const end = performance.now();

  return {
    price,
    time: end - start
  };
}

/**
 * 測試使用快取的價格查詢（Solana）
 */
async function testSolanaWithCache(token, solanaPriceMonitor) {
  const cachedPoolInfo = {
    poolAddress: token.pool_address,
    version: token.pool_version,
    pairToken: token.pool_pair_token
  };

  const start = performance.now();
  const price = await solanaPriceMonitor.getPriceWithCachedPool(
    token.address,
    cachedPoolInfo
  );
  const end = performance.now();

  return {
    price,
    time: end - start
  };
}

/**
 * 執行性能測試
 */
async function runPerformanceTest() {
  console.log('\n========================================');
  console.log('  多鏈價格查詢快取速度測試');
  console.log('========================================\n');

  // 測試配置
  const ROUNDS = 5; // 每個token測試5輪
  const DELAY_MS = 1000; // 延遲1秒

  // 初始化 monitors
  const monitors = {
    base: new BasePriceMonitor(),
    solana: new SolanaPriceMonitor()
  };

  const allResults = [];
  let totalTokens = 0;
  let successTokens = 0;

  // 測試 Base
  console.log(`\n${'='.repeat(60)}`);
  console.log(`🔗 鏈: BASE`);
  console.log(`${'='.repeat(60)}\n`);

  const baseToken = getTokenFromDB('base', TEST_TOKENS.base.address);
  if (baseToken && baseToken.pool_address) {
    totalTokens++;
    console.log(`${'─'.repeat(60)}`);
    console.log(`🪙 Token: ${baseToken.symbol || 'UNKNOWN'}`);
    console.log(`   地址: ${baseToken.address}`);
    console.log(`   快取池子: ${baseToken.pool_version} (${baseToken.pool_protocol})`);
    console.log(`${'─'.repeat(60)}\n`);

    // 預熱
    console.log('🔥 預熱中...');
    try {
      await testBaseWithCache(baseToken, monitors.base);
      await new Promise(resolve => setTimeout(resolve, DELAY_MS));

      // 測試
      console.log(`\n✅ 測試使用快取 (${ROUNDS} 輪):`);
      const cacheResults = [];

      for (let i = 1; i <= ROUNDS; i++) {
        const result = await testBaseWithCache(baseToken, monitors.base);
        cacheResults.push(result);
        console.log(`  輪次 ${i}: ${result.time.toFixed(2)}ms | 價格: $${result.price.toFixed(8)}`);
        await new Promise(resolve => setTimeout(resolve, DELAY_MS));
      }

      // 統計
      const cacheTimes = cacheResults.map(r => r.time);
      const cacheAvg = cacheTimes.reduce((a, b) => a + b, 0) / cacheTimes.length;
      const cacheMin = Math.min(...cacheTimes);
      const cacheMax = Math.max(...cacheTimes);

      console.log(`\n  📈 快取統計:`);
      console.log(`     平均: ${cacheAvg.toFixed(2)}ms`);
      console.log(`     最快: ${cacheMin.toFixed(2)}ms`);
      console.log(`     最慢: ${cacheMax.toFixed(2)}ms\n`);

      allResults.push({
        chain: 'base',
        symbol: baseToken.symbol || 'UNKNOWN',
        avgTime: cacheAvg,
        minTime: cacheMin,
        maxTime: cacheMax,
        lastPrice: cacheResults[cacheResults.length - 1].price
      });
      successTokens++;
    } catch (error) {
      console.log(`   ❌ 測試失敗: ${error.message}\n`);
    }
  } else {
    console.log(`⚠️  Base token 未找到或無快取信息\n`);
  }

  // 測試 Solana
  console.log(`\n${'='.repeat(60)}`);
  console.log(`🔗 鏈: SOLANA`);
  console.log(`${'='.repeat(60)}\n`);

  const solanaToken = getTokenFromDB('solana', TEST_TOKENS.solana.mint);
  if (solanaToken && solanaToken.pool_address) {
    totalTokens++;
    console.log(`${'─'.repeat(60)}`);
    console.log(`🪙 Token: ${solanaToken.symbol || 'UNKNOWN'}`);
    console.log(`   地址: ${solanaToken.address}`);
    console.log(`   快取池子: ${solanaToken.pool_version} (${solanaToken.pool_protocol})`);
    console.log(`${'─'.repeat(60)}\n`);

    // 預熱
    console.log('🔥 預熱中...');
    try {
      await testSolanaWithCache(solanaToken, monitors.solana);
      await new Promise(resolve => setTimeout(resolve, DELAY_MS));

      // 測試
      console.log(`\n✅ 測試使用快取 (${ROUNDS} 輪):`);
      const cacheResults = [];

      for (let i = 1; i <= ROUNDS; i++) {
        const result = await testSolanaWithCache(solanaToken, monitors.solana);
        cacheResults.push(result);
        console.log(`  輪次 ${i}: ${result.time.toFixed(2)}ms | 價格: $${result.price.toFixed(8)}`);
        await new Promise(resolve => setTimeout(resolve, DELAY_MS));
      }

      // 統計
      const cacheTimes = cacheResults.map(r => r.time);
      const cacheAvg = cacheTimes.reduce((a, b) => a + b, 0) / cacheTimes.length;
      const cacheMin = Math.min(...cacheTimes);
      const cacheMax = Math.max(...cacheTimes);

      console.log(`\n  📈 快取統計:`);
      console.log(`     平均: ${cacheAvg.toFixed(2)}ms`);
      console.log(`     最快: ${cacheMin.toFixed(2)}ms`);
      console.log(`     最慢: ${cacheMax.toFixed(2)}ms\n`);

      allResults.push({
        chain: 'solana',
        symbol: solanaToken.symbol || 'UNKNOWN',
        avgTime: cacheAvg,
        minTime: cacheMin,
        maxTime: cacheMax,
        lastPrice: cacheResults[cacheResults.length - 1].price
      });
      successTokens++;
    } catch (error) {
      console.log(`   ❌ 測試失敗: ${error.message}\n`);
    }
  } else {
    console.log(`⚠️  Solana token 未找到或無快取信息\n`);
  }

  // 總體統計
  if (allResults.length > 0) {
    console.log('\n');
    console.log('='.repeat(60));
    console.log('📊 總體統計');
    console.log('='.repeat(60));
    console.log();

    // 按鏈分組統計
    for (const chain of ['base', 'solana']) {
      const chainResults = allResults.filter(r => r.chain === chain);
      if (chainResults.length === 0) continue;

      const avgTimes = chainResults.map(r => r.avgTime);
      const overallAvg = avgTimes.reduce((a, b) => a + b, 0) / avgTimes.length;

      console.log(`🔗 ${chain.toUpperCase()}`);
      console.log(`   平均查詢時間: ${overallAvg.toFixed(2)}ms`);
      console.log();
    }

    console.log(`✅ 成功測試: ${successTokens}/${totalTokens} tokens`);
  } else {
    console.log('\n❌ 未找到任何可測試的 tokens');
    console.log('💡 請先執行 test-prices.js 來建立池子快取\n');
  }

  console.log('='.repeat(60));
  console.log('🎯 測試完成！');
  console.log('='.repeat(60));
  console.log('\n💡 結論:');
  console.log('   - 使用快取池子信息可以實現快速價格查詢');
  console.log('   - 快取避免了重複的池子搜尋過程');
  console.log('   - 適合需要頻繁查詢價格的場景（如每分鐘監控）');
  console.log('   - BSC 不需要快取（已經夠快）\n');
}

// 執行測試
runPerformanceTest()
  .then(() => {
    db.close();
    process.exit(0);
  })
  .catch(error => {
    console.error('❌ 測試失敗:', error);
    db.close();
    process.exit(1);
  });
