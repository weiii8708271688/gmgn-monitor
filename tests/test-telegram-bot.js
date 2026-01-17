/**
 * Telegram Bot 測試腳本
 * 用法: node test-telegram-bot.js
 *
 * 此腳本會測試 Telegram Bot 的基本功能：
 * 1. 連接測試
 * 2. 發送基本訊息
 * 3. 發送價格提醒
 * 4. 發送訂單執行通知
 * 5. 發送錯誤通知
 */

import TelegramNotification from './src/services/notification/telegram.js';

async function testTelegramBot() {
  console.log('\n╔═══════════════════════════════════════════╗');
  console.log('║  Telegram Bot 測試工具                    ║');
  console.log('╚═══════════════════════════════════════════╝\n');

  // 創建 Telegram 通知服務實例
  const telegram = new TelegramNotification();

  // 檢查是否啟用
  if (!telegram.enabled) {
    console.log('❌ Telegram Bot 未啟用');
    console.log('   請檢查 .env 文件中的 TELEGRAM_BOT_TOKEN 和 TELEGRAM_CHAT_ID');
    process.exit(1);
  }

  console.log('✅ Telegram Bot 已初始化');
  console.log(`   Bot Token: ${telegram.bot ? '已設定' : '未設定'}`);
  console.log(`   Chat ID: ${telegram.chatId || '未設定'}\n`);

  // 測試 1: 發送基本測試訊息
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('1️⃣ 測試發送基本訊息...');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  await telegram.sendMessage(
    '🧪 *Telegram Bot 測試訊息*\n\n' +
    '這是一條測試訊息，用於驗證 Telegram Bot 是否正常運作。\n\n' +
    '如果您收到這條訊息，表示您的 Bot 設定正確！✅'
  );

  console.log('✅ 基本訊息已發送\n');
  await sleep(2000);

  // 測試 2: 發送價格提醒
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('2️⃣ 測試價格提醒通知...');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  const mockAlert = {
    symbol: 'SOL',
    condition: '高於',
    target_price: 150,
  };

  await telegram.sendPriceAlert(mockAlert, 155.5);
  console.log('✅ 價格提醒已發送\n');
  await sleep(2000);

  // 測試 3: 發送限價買入訂單執行通知
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('3️⃣ 測試訂單執行通知 (限價買入)...');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  const mockBuyOrder = {
    symbol: 'BNB',
    type: 'limit_buy',
    target_price: 300,
    current_price: 298.5,
  };

  await telegram.sendOrderExecuted(mockBuyOrder);
  console.log('✅ 買入訂單通知已發送\n');
  await sleep(2000);

  // 測試 4: 發送限價賣出訂單執行通知
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('4️⃣ 測試訂單執行通知 (限價賣出)...');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  const mockSellOrder = {
    symbol: 'ETH',
    type: 'limit_sell',
    target_price: 2500,
    current_price: 2510,
  };

  await telegram.sendOrderExecuted(mockSellOrder);
  console.log('✅ 賣出訂單通知已發送\n');
  await sleep(2000);

  // 測試 5: 發送止損訂單執行通知
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('5️⃣ 測試訂單執行通知 (止損)...');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  const mockStopLossOrder = {
    symbol: 'BTC',
    type: 'stop_loss',
    target_price: 40000,
    current_price: 39500,
  };

  await telegram.sendOrderExecuted(mockStopLossOrder);
  console.log('✅ 止損訂單通知已發送\n');
  await sleep(2000);

  // 測試 6: 發送錯誤通知
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('6️⃣ 測試錯誤通知...');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  await telegram.sendError('這是一個測試錯誤訊息\n用於驗證錯誤通知功能是否正常');
  console.log('✅ 錯誤通知已發送\n');
  await sleep(2000);

  // 測試總結
  console.log('\n╔═══════════════════════════════════════════╗');
  console.log('║  測試完成總結                              ║');
  console.log('╚═══════════════════════════════════════════╝\n');
  console.log('✅ 所有測試完成！\n');
  console.log('📱 請檢查您的 Telegram 是否收到 6 條訊息：\n');
  console.log('   1️⃣ 基本測試訊息');
  console.log('   2️⃣ 價格提醒通知 (SOL)');
  console.log('   3️⃣ 限價買入執行通知 (BNB)');
  console.log('   4️⃣ 限價賣出執行通知 (ETH)');
  console.log('   5️⃣ 止損執行通知 (BTC)');
  console.log('   6️⃣ 錯誤通知\n');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  console.log('💡 提示：');
  console.log('   - 如果沒收到訊息，請檢查 TELEGRAM_BOT_TOKEN');
  console.log('   - 確認 TELEGRAM_CHAT_ID 是否正確');
  console.log('   - 確保已經先與 Bot 開啟對話 (/start)\n');

  // 結束進程
  process.exit(0);
}

// 輔助函數：延遲
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// 執行測試
testTelegramBot().catch(error => {
  console.error('\n❌ 測試失敗:', error.message);
  console.error('   錯誤詳情:', error);
  process.exit(1);
});
