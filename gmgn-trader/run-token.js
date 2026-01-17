/**
 * 多代幣實例啟動器
 *
 * 使用方法：
 * node run-token.js token1  # 運行第一個代幣
 * node run-token.js token2  # 運行第二個代幣
 * node run-token.js token2 --final-breakeven  # 下次回本時全部賣出
 *
 * 每個代幣實例會使用獨立的配置和狀態文件：
 * - configs/token1.config.js  → 代幣1的配置
 * - states/token1.state.json  → 代幣1的狀態
 *
 * 可選參數：
 * --final-breakeven  # 標記為最後一次回本，下次回本時全部賣出並關閉策略
 */

import MartingaleStrategy from './martingale-strategy.js';
import GmgnBrowserAPI from './gmgn-browser-api.js';
import fs from 'fs';
import path from 'path';
import readline from 'readline';

// 從命令行參數獲取代幣 ID 和選項
const tokenId = process.argv[2];
const isFinalBreakeven = process.argv.includes('--final-breakeven');

if (!tokenId || tokenId.startsWith('--')) {
  console.error('❌ 請提供代幣 ID');
  console.log('\n使用方法:');
  console.log('  node run-token.js token1');
  console.log('  node run-token.js token2');
  console.log('  node run-token.js token2 --final-breakeven  # 下次回本時全部賣出\n');
  console.log('範例:');
  console.log('  node run-token.js token1  # 運行代幣1');
  console.log('  node run-token.js token2  # 運行代幣2');
  console.log('  node run-token.js token2 --final-breakeven  # 標記為最後一次\n');
  process.exit(1);
}

// 確保目錄存在
const configDir = './configs';
const stateDir = './states';

if (!fs.existsSync(configDir)) {
  fs.mkdirSync(configDir);
  console.log('✅ 創建配置目錄: ./configs/');
}

if (!fs.existsSync(stateDir)) {
  fs.mkdirSync(stateDir);
  console.log('✅ 創建狀態目錄: ./states/');
}

// 配置文件路徑
const configFile = path.join(configDir, `${tokenId}.config.js`);
const stateFile = path.join(stateDir, `${tokenId}.state.json`);

// 檢查配置文件是否存在
if (!fs.existsSync(configFile)) {
  console.error(`❌ 配置文件不存在: ${configFile}`);
  console.log('\n請先創建配置文件，參考模板:');
  console.log(`  cp martingale-config.js ${configFile}`);
  console.log(`  然後編輯 ${configFile} 設置代幣地址和參數\n`);
  process.exit(1);
}

// 動態導入配置
const config = await import(`./${configFile}`);
const MARTINGALE_CONFIG = config.MARTINGALE_CONFIG || config.default;

console.log('\n' + '='.repeat(80));
console.log(`🔍 正在獲取代幣資訊...`);
console.log('='.repeat(80));

// 初始化 GMGN API 獲取代幣資訊
let tokenInfo = null;
let gmgnApi = null;

try {
  gmgnApi = new GmgnBrowserAPI();
  await gmgnApi.init();

  const result = await gmgnApi.getTokenPrice(MARTINGALE_CONFIG.tokenAddress);
  if (result.success) {
    tokenInfo = result.data;
  }
} catch (error) {
  console.log('⚠️  無法獲取代幣資訊，將繼續使用基本配置');
} finally {
  if (gmgnApi) {
    await gmgnApi.close();
  }
}

// 顯示配置摘要
console.log('\n' + '='.repeat(80));
console.log(`📋 策略配置確認 - ${tokenId.toUpperCase()}`);
console.log('='.repeat(80));

// 代幣資訊
if (tokenInfo) {
  console.log('\n🪙 代幣資訊:');
  console.log(`   名稱: ${tokenInfo.name || 'N/A'}`);
  console.log(`   符號: ${tokenInfo.symbol || 'N/A'}`);
  console.log(`   地址: ${MARTINGALE_CONFIG.tokenAddress}`);
  console.log(`   當前價格: $${tokenInfo.price || 'N/A'}`);

  // 計算 24h 漲跌幅
  if (tokenInfo.price && tokenInfo.price24h) {
    const priceChange = ((parseFloat(tokenInfo.price) - parseFloat(tokenInfo.price24h)) / parseFloat(tokenInfo.price24h)) * 100;
    const sign = priceChange >= 0 ? '+' : '';
    const emoji = priceChange >= 0 ? '📈' : '📉';
    console.log(`   24h漲跌: ${emoji} ${sign}${priceChange.toFixed(2)}%`);
  }

  if (tokenInfo.liquidity) {
    console.log(`   流動性: $${parseFloat(tokenInfo.liquidity).toLocaleString()}`);
  }
  if (tokenInfo.volume24h) {
    console.log(`   24h交易量: $${parseFloat(tokenInfo.volume24h).toLocaleString()}`);
  }
  if (tokenInfo.holderCount) {
    console.log(`   持有人數: ${tokenInfo.holderCount.toLocaleString()}`);
  }
  if (tokenInfo.buys24h && tokenInfo.sells24h) {
    console.log(`   24h買賣: ${tokenInfo.buys24h} 買 / ${tokenInfo.sells24h} 賣`);
  }
} else {
  console.log('\n🪙 代幣資訊:');
  console.log(`   地址: ${MARTINGALE_CONFIG.tokenAddress}`);
  console.log(`   ⚠️  無法從 GMGN 獲取詳細資訊`);
}

// 策略配置
console.log('\n⚙️  策略配置:');
console.log(`   配置文件: ${configFile}`);
console.log(`   狀態文件: ${stateFile}`);
console.log(`   基礎投入: $${MARTINGALE_CONFIG.baseAmount}`);
console.log(`   加倉倍數: ${MARTINGALE_CONFIG.multiplier}x`);
console.log(`   加倉次數: 最多 ${MARTINGALE_CONFIG.maxAddPositions} 次`);
console.log(`   下跌觸發: 每跌 ${MARTINGALE_CONFIG.dropPercentage}% 加倉`);
console.log(`   止盈百分比: +${MARTINGALE_CONFIG.takeProfitPercentage}%`);
console.log(`   最大止盈次數: ${MARTINGALE_CONFIG.maxTakeProfitCount > 0 ? MARTINGALE_CONFIG.maxTakeProfitCount + ' 次' : '無限制'}`);

// 計算總投入
let totalInvestment = MARTINGALE_CONFIG.baseAmount;
let currentAmount = MARTINGALE_CONFIG.baseAmount;
for (let i = 0; i < MARTINGALE_CONFIG.maxAddPositions; i++) {
  currentAmount *= MARTINGALE_CONFIG.multiplier;
  totalInvestment += currentAmount;
}
console.log(`   最大總投入: $${totalInvestment} (滿倉時)`);

// 交易設置
console.log('\n🔧 交易設置:');
console.log(`   交易方式: ${MARTINGALE_CONFIG.tradeMethod.toUpperCase()}`);
console.log(`   價格來源: ${MARTINGALE_CONFIG.priceSource.toUpperCase()}`);
console.log(`   滑點容忍: ${MARTINGALE_CONFIG.slippage}%`);
console.log(`   自動交易: ${MARTINGALE_CONFIG.autoTrade ? '✅ 啟用 (實際下單)' : '❌ 關閉 (僅監控模式)'}`);

// 顯示最終回本標記
if (isFinalBreakeven) {
  console.log('\n🔴 特殊模式: 最後一次回本');
  console.log('   下次回本時將全部賣出並關閉策略');
  console.log('   不會保留 baseAmount');
}

if (MARTINGALE_CONFIG.autoTrade) {
  console.log('\n⚠️  警告: 自動交易已啟用，系統將會實際執行交易！');
  console.log('   請確保:');
  console.log('   1. 錢包有足夠的 BNB 餘額');
  console.log('   2. 私鑰配置正確');
  console.log('   3. 已充分理解策略風險');
}

console.log('\n' + '='.repeat(80));

// 開始條件選單
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

const question = (prompt) => new Promise(resolve => rl.question(prompt, resolve));

console.log('\n📌 選擇開始條件:');
console.log('   1. 直接開始');
console.log('   2. 低於指定價格時開始');
console.log('   3. 從最高點回落指定百分比時開始');
console.log('   4. 退出');

const choice = await question('\n請選擇 (1-4): ');

let startCondition = null;

switch (choice.trim()) {
  case '1':
    // 直接開始
    startCondition = { type: 'immediate' };
    console.log('\n✅ 選擇: 直接開始');
    break;

  case '2':
    // 低於指定價格開始
    const currentPrice = tokenInfo?.price ? parseFloat(tokenInfo.price) : null;
    if (currentPrice) {
      console.log(`\n當前價格: $${currentPrice}`);
    }
    const targetPriceInput = await question('請輸入目標價格 (低於此價格時開始): $');
    const targetPrice = parseFloat(targetPriceInput);

    if (isNaN(targetPrice) || targetPrice <= 0) {
      console.log('\n❌ 無效的價格，已取消\n');
      rl.close();
      process.exit(0);
    }

    startCondition = {
      type: 'below_price',
      targetPrice: targetPrice
    };
    console.log(`\n✅ 選擇: 價格低於 $${targetPrice} 時開始`);
    break;

  case '3':
    // 從最高點回落百分比開始
    const currentPriceForHigh = tokenInfo?.price ? parseFloat(tokenInfo.price) : null;
    let initialHighPrice = currentPriceForHigh;

    if (currentPriceForHigh) {
      console.log(`\n💰 當前價格: $${currentPriceForHigh}`);
      console.log(`   預設將使用當前價格作為初始最高點`);
      const useCurrentAsHigh = await question(`\n按 Enter 使用當前價格，或輸入自定義最高點價格: $`);

      // 如果用戶輸入了內容，嘗試解析為自定義價格
      if (useCurrentAsHigh.trim() !== '') {
        const customHigh = parseFloat(useCurrentAsHigh);
        if (!isNaN(customHigh) && customHigh > 0) {
          initialHighPrice = customHigh;
          console.log(`✅ 使用自定義最高點: $${customHigh}`);
        } else {
          console.log('\n❌ 無效的價格，已取消\n');
          rl.close();
          process.exit(0);
        }
      } else {
        // 用戶直接按 Enter，使用當前價格
        console.log(`✅ 使用當前價格作為最高點: $${currentPriceForHigh}`);
      }
    } else {
      const highPriceInput = await question('❌ 無法獲取當前價格，請手動輸入初始最高點價格: $');
      initialHighPrice = parseFloat(highPriceInput);

      if (isNaN(initialHighPrice) || initialHighPrice <= 0) {
        console.log('\n❌ 無效的價格，已取消\n');
        rl.close();
        process.exit(0);
      }
    }

    const dropPercentInput = await question('請輸入回落百分比 (例如: 10 表示跌10%時開始): ');
    const dropPercent = parseFloat(dropPercentInput);

    if (isNaN(dropPercent) || dropPercent <= 0 || dropPercent >= 100) {
      console.log('\n❌ 無效的百分比 (需要 0-100)，已取消\n');
      rl.close();
      process.exit(0);
    }

    const triggerPrice = initialHighPrice * (1 - dropPercent / 100);

    startCondition = {
      type: 'drop_from_high',
      highPrice: initialHighPrice,
      dropPercent: dropPercent,
      triggerPrice: triggerPrice
    };
    console.log(`\n✅ 選擇: 從最高點 $${initialHighPrice} 回落 ${dropPercent}% 時開始`);
    console.log(`   觸發價格: $${triggerPrice.toFixed(8)}`);
    console.log(`   📈 會持續追蹤更高價格並更新觸發條件`);
    break;

  case '4':
    console.log('\n❌ 已取消啟動\n');
    rl.close();
    process.exit(0);

  default:
    console.log('\n❌ 無效選擇，已取消\n');
    rl.close();
    process.exit(0);
}

rl.close();
console.log('\n✅ 確認啟動，正在初始化...\n');

// 創建策略實例（傳入自定義狀態文件路徑、最終回本標記和開始條件）
const strategy = new MartingaleStrategy(MARTINGALE_CONFIG, stateFile, isFinalBreakeven, startCondition);

// 初始化策略
await strategy.init();

// 啟動策略
await strategy.start();

// 處理退出信號
process.on('SIGINT', async () => {
  console.log('\n\n⚠️  收到退出信號...');
  await strategy.stop();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('\n\n⚠️  收到終止信號...');
  await strategy.stop();
  process.exit(0);
});
