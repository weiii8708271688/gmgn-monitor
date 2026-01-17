import BasePriceMonitor from './src/services/priceMonitor/base.js';
import db from './src/database/db.js';
import logger from './src/utils/logger.js';

const monitor = new BasePriceMonitor();

async function testBasePrices() {
  try {
    console.log('\n=== 測試 Base 鏈價格更新 ===\n');

    // 1. 先檢查 ETH 價格
    console.log('1️⃣ 獲取 ETH/USD 價格...');
    const ethPrice1 = await monitor.getETHPrice();
    console.log(`   ETH 價格: $${ethPrice1.toFixed(2)}\n`);

    // 2. 獲取所有 Base token
    const tokens = db.prepare('SELECT * FROM tokens WHERE chain = ?').all('base');
    console.log(`2️⃣ 找到 ${tokens.length} 個 Base 代幣\n`);

    // 3. 測試每個 token 的價格
    for (const token of tokens) {
      console.log(`\n📊 ${token.symbol} (${token.address.slice(0, 8)}...)`);
      console.log(`   精度: ${token.decimals}`);
      console.log(`   快取池子: ${token.pool_address || '無'}`);
      if (token.symbol != '基地人生') {
        continue;
      }
      try {
        const startTime = Date.now();

        // 準備快取池子資訊
        const cachedPoolInfo = token.pool_address ? {
          poolAddress: token.pool_address,
          version: token.pool_version,
          protocol: token.pool_protocol,
          pairToken: token.pool_pair_token,
        } : null;

        // 獲取價格
        let priceUSD;
        if (cachedPoolInfo) {
          console.log(`   使用快取池子 (${cachedPoolInfo.version})...`);
          priceUSD = await monitor.getPriceWithCachedPool(token.address, token.decimals, cachedPoolInfo);
        } else {
          console.log(`   自動查找池子 (無快取)...`);
          priceUSD = await monitor.getPriceInUSD(token.address, token.decimals);
        }

        const endTime = Date.now();

        console.log(`   ✅ 價格: $${priceUSD.toFixed(10)}`);
        console.log(`   ⏱️  查詢時間: ${endTime - startTime}ms`);

        // 檢查資料庫中的歷史價格
        const lastPrice = db.prepare(`
          SELECT price, timestamp
          FROM price_history
          WHERE token_id = ?
          ORDER BY timestamp DESC
          LIMIT 1
        `).get(token.id);

        if (lastPrice) {
          console.log(`   📈 上次記錄: $${parseFloat(lastPrice.price).toFixed(10)} (${lastPrice.timestamp})`);
          const priceDiff = ((priceUSD - lastPrice.price) / lastPrice.price * 100);
          console.log(`   📉 變化: ${priceDiff >= 0 ? '+' : ''}${priceDiff.toFixed(2)}%`);
        }
      } catch (error) {
        console.error(`   ❌ 錯誤: ${error.message}`);
      }
    }

    // 4. 再次檢查 ETH 價格（看是否使用快取）
    console.log('\n\n3️⃣ 再次獲取 ETH/USD 價格（測試快取）...');
    const startTime = Date.now();
    const ethPrice2 = await monitor.getETHPrice();
    const endTime = Date.now();
    console.log(`   ETH 價格: $${ethPrice2.toFixed(2)}`);
    console.log(`   查詢時間: ${endTime - startTime}ms ${endTime - startTime < 10 ? '(使用快取)' : ''}`);
    console.log(`   價格相同: ${ethPrice1 === ethPrice2 ? '是' : '否'}`);

    // 5. 清除快取後再次查詢
    console.log('\n4️⃣ 清除快取後重新查詢 ETH 價格...');
    monitor.ethPriceCache = { price: null, timestamp: 0 };
    const startTime2 = Date.now();
    const ethPrice3 = await monitor.getETHPrice();
    const endTime2 = Date.now();
    console.log(`   ETH 價格: $${ethPrice3.toFixed(2)}`);
    console.log(`   查詢時間: ${endTime2 - startTime2}ms`);

    console.log('\n✅ 測試完成\n');
  } catch (error) {
    console.error('\n❌ 測試失敗:', error);
    console.error(error.stack);
  }
}

testBasePrices();
