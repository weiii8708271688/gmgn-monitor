/**
 * 消息推送測試 - Telegram Webhook 通知
 * 用法: node test-notifications.js
 */

import TelegramWebhookNotification from './src/services/notification/telegramWebhook.js';

async function testWebhook() {
  console.log('\n╔═══════════════════════════════════════════╗');
  console.log('║  測試消息推送功能                          ║');
  console.log('║  Telegram Webhook 通知系統                ║');
  console.log('╚═══════════════════════════════════════════╝\n');
  console.log('🧪 開始測試 Telegram Webhook...\n');

  // 創建通知服務
  const webhook = new TelegramWebhookNotification();

  // 測試 1: 檢查連接
  console.log('1️⃣ 測試服務器連接...');
  const connectionResult = await webhook.testConnection();
  console.log(`   結果: ${connectionResult.success ? '✅ 成功' : '❌ 失敗'}`);
  console.log(`   訊息: ${connectionResult.message}\n`);

  if (!connectionResult.success) {
    console.log('❌ 無法連接到服務器，請確保 Flask 服務器正在運行');
    return;
  }

  // 測試 2: 發送價格警報
  console.log('2️⃣ 測試價格警報...');
  const alertData = {
    symbol: 'SOL',
    address: 'So11111111111111111111111111111111111111112',
    condition: 'above',
    target_price: 150,
  };
  await webhook.sendPriceAlert(alertData, 155.5);
  console.log('   ✅ 價格警報已發送\n');

  // 等待 2 秒
  await new Promise(resolve => setTimeout(resolve, 2000));

  // 測試 3: 發送訂單執行通知
  console.log('3️⃣ 測試訂單執行通知...');
  const orderData = {
    symbol: 'BNB',
    address: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c',
    type: 'limit_buy',
    target_price: 300,
    current_price: 298.5,
  };
  await webhook.sendOrderExecuted(orderData);
  console.log('   ✅ 訂單執行通知已發送\n');

  // 等待 2 秒
  await new Promise(resolve => setTimeout(resolve, 2000));

  // 測試 4: 發送價格更新
  console.log('4️⃣ 測試價格更新通知...');
  const priceUpdateData = {
    tokenName: 'SOL',
    tokenAddress: 'So11111111111111111111111111111111111111112',
    currentPrice: '$155.50',
    priceChange: '+5.2%',
    priceType: 'up',
  };
  await webhook.sendPriceUpdate(priceUpdateData);
  console.log('   ✅ 價格更新通知已發送\n');

  // 等待 2 秒
  await new Promise(resolve => setTimeout(resolve, 2000));

  // 測試 5: 發送錯誤通知
  console.log('5️⃣ 測試錯誤通知...');
  await webhook.sendError('這是一個測試錯誤訊息');
  console.log('   ✅ 錯誤通知已發送\n');

  console.log('\n╔═══════════════════════════════════════════╗');
  console.log('║  測試完成總結                              ║');
  console.log('╚═══════════════════════════════════════════╝\n');
  console.log('✅ 所有測試完成！請檢查您的 Telegram 手機是否收到 5 條訊息');
  console.log('\n📊 測試項目:');
  console.log('   1️⃣ 服務器連接測試');
  console.log('   2️⃣ 價格警報推送');
  console.log('   3️⃣ 訂單執行通知');
  console.log('   4️⃣ 價格更新推送');
  console.log('   5️⃣ 錯誤通知推送\n');
}

// 執行測試
testWebhook().catch(error => {
  console.error('\n❌ 測試失敗:', error.message);
  process.exit(1);
});
