/**
 * 顯示當前策略狀態
 */

import MartingaleState from './martingale-state.js';

const state = new MartingaleState();
state.printStatus();

const stateData = state.getState();

if (stateData.hasPosition) {
  console.log('\n📈 策略觸發點位:\n');

  // 回本價格
  console.log(`🔄 回本價格: $${stateData.averagePrice.toFixed(8)}`);
  console.log(`   (回到此價格會賣出加倉部分，保留 baseAmount)\n`);

  // 止盈價格（假設 10%）
  const takeProfitPrice = stateData.averagePrice * 1.1;
  console.log(`✅ 止盈價格 (10%): $${takeProfitPrice.toFixed(8)}`);
  console.log(`   (達到此價格會賣出盈利部分，保留本金)\n`);

  // 下次加倉價格
  const nextAddPrice = stateData.entryPrice * 0.8; // 假設 20% 加倉
  console.log(`⬇️  下次加倉價格: $${nextAddPrice.toFixed(8)}`);
  console.log(`   (開倉價 $${stateData.entryPrice.toFixed(8)} × 80%)\n`);

  console.log('='.repeat(60));
}
