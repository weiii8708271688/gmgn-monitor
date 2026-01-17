/**
 * 马丁格尔逻辑测试脚本
 *
 * 测试场景：
 * 1. 开仓 @ $0.10
 * 2. 跌到 $0.08 (-20%) → 第1次加仓
 * 3. 跌到 $0.06 (-40%) → 第2次加仓
 * 4. 涨回 $0.075 (均价附近) → 回本卖出
 * 5. 再跌到 $0.06 (-20% 相对新的 entryPrice) → 第1次加仓
 * 6. 涨到 +20% → 部分止盈
 */

import fs from 'fs';

// 简化的状态管理
class TestState {
  constructor() {
    this.hasPosition = false;
    this.entryPrice = 0;
    this.averagePrice = 0;
    this.totalTokens = 0;
    this.totalInvestedUSD = 0;
    this.addPositionCount = 0;
    this.purchases = [];
    this.sales = [];
  }

  recordPurchase(purchase) {
    this.purchases.push(purchase);

    if (purchase.type === 'entry') {
      this.hasPosition = true;
      this.entryPrice = purchase.priceUSD;
      this.totalTokens = purchase.tokensReceived;
      this.totalInvestedUSD = purchase.usdAmount;
      this.averagePrice = purchase.priceUSD;
      this.addPositionCount = 0;
    } else {
      this.totalTokens += purchase.tokensReceived;
      this.totalInvestedUSD += purchase.usdAmount;
      this.averagePrice = this.totalInvestedUSD / this.totalTokens;
      this.addPositionCount++;
    }
  }

  recordBreakEven(sale) {
    this.sales.push({ ...sale, type: 'break_even' });

    this.totalTokens = sale.keepTokens;
    this.totalInvestedUSD = sale.keepValue;
    this.averagePrice = sale.priceUSD;
    this.entryPrice = sale.priceUSD; // 重置为当前价格
    this.addPositionCount = 0;
    this.purchases = [];
  }

  recordPartialSale(sale) {
    this.sales.push({ ...sale, type: 'partial_take_profit' });

    this.totalTokens = sale.keepTokens;
    this.totalInvestedUSD = sale.keepValue;
    this.averagePrice = sale.priceUSD;
    this.entryPrice = sale.keepValue / sale.keepTokens; // 新的均价
  }

  print() {
    console.log(`\n📊 当前状态:`);
    console.log(`   持仓: ${this.hasPosition ? '✅' : '❌'}`);
    console.log(`   开仓价: $${this.entryPrice.toFixed(6)}`);
    console.log(`   均价: $${this.averagePrice.toFixed(6)}`);
    console.log(`   总持仓: ${this.totalTokens.toFixed(2)} tokens`);
    console.log(`   总投入: $${this.totalInvestedUSD.toFixed(2)}`);
    console.log(`   加仓次数: ${this.addPositionCount}`);
  }
}

// 配置
const CONFIG = {
  baseAmount: 10,
  multiplier: 2,
  dropPercentage: 20,
  maxAddPositions: 3,
  takeProfitPercentage: 20
};

// 策略逻辑
class TestStrategy {
  constructor(config) {
    this.config = config;
    this.state = new TestState();
  }

  shouldEntry() {
    return !this.state.hasPosition;
  }

  shouldAddPosition(currentPrice) {
    if (!this.state.hasPosition) return false;
    if (this.state.addPositionCount >= this.config.maxAddPositions) return false;

    const dropPercent = ((this.state.entryPrice - currentPrice) / this.state.entryPrice) * 100;
    const nextAddTrigger = this.config.dropPercentage * (this.state.addPositionCount + 1);

    return dropPercent >= nextAddTrigger;
  }

  shouldBreakEven(currentPrice) {
    if (!this.state.hasPosition) return false;
    if (this.state.addPositionCount === 0) return false;
    return currentPrice >= this.state.averagePrice;
  }

  shouldTakeProfit(currentPrice) {
    if (!this.state.hasPosition) return false;
    const profitPercent = ((currentPrice - this.state.averagePrice) / this.state.averagePrice) * 100;
    return profitPercent >= this.config.takeProfitPercentage;
  }

  executeEntry(currentPrice) {
    console.log(`\n🎯 执行开仓 @ $${currentPrice.toFixed(6)}`);
    const usdAmount = this.config.baseAmount;
    const tokensReceived = usdAmount / currentPrice;

    this.state.recordPurchase({
      type: 'entry',
      priceUSD: currentPrice,
      usdAmount,
      tokensReceived
    });

    console.log(`   投入: $${usdAmount}`);
    console.log(`   获得: ${tokensReceived.toFixed(2)} tokens`);
  }

  executeAddPosition(currentPrice) {
    const addPositionIndex = this.state.addPositionCount;
    console.log(`\n📈 执行第${addPositionIndex + 1}次加仓 @ $${currentPrice.toFixed(6)}`);

    const usdAmount = this.config.baseAmount * Math.pow(this.config.multiplier, addPositionIndex + 1);
    const tokensReceived = usdAmount / currentPrice;

    this.state.recordPurchase({
      type: 'add_position',
      priceUSD: currentPrice,
      usdAmount,
      tokensReceived
    });

    console.log(`   投入: $${usdAmount.toFixed(2)}`);
    console.log(`   获得: ${tokensReceived.toFixed(2)} tokens`);
  }

  executeBreakEven(currentPrice) {
    console.log(`\n💵 执行回本卖出 @ $${currentPrice.toFixed(6)}`);

    const totalValue = this.state.totalTokens * currentPrice;
    const sellValue = this.state.totalInvestedUSD - this.config.baseAmount;
    const sellPercent = (sellValue / totalValue) * 100;
    const sellTokens = this.state.totalTokens * (sellPercent / 100);
    const keepTokens = this.state.totalTokens - sellTokens;
    const keepValue = this.config.baseAmount;

    console.log(`   卖出: ${sellTokens.toFixed(2)} tokens (${sellPercent.toFixed(2)}%)`);
    console.log(`   收回: $${sellValue.toFixed(2)}`);
    console.log(`   保留: ${keepTokens.toFixed(2)} tokens ($${keepValue.toFixed(2)})`);

    this.state.recordBreakEven({
      priceUSD: currentPrice,
      tokenAmount: sellTokens,
      usdReceived: sellValue,
      keepTokens,
      keepValue
    });

    console.log(`   ✅ 新的 entryPrice: $${this.state.entryPrice.toFixed(6)}`);
  }

  executeTakeProfit(currentPrice) {
    console.log(`\n💰 执行止盈 @ $${currentPrice.toFixed(6)}`);

    const totalValue = this.state.totalTokens * currentPrice;
    const profitPercent = this.config.takeProfitPercentage / 100;
    const profitValue = this.state.totalInvestedUSD * profitPercent;
    const sellPercent = (profitValue / totalValue) * 100;
    const sellTokens = this.state.totalTokens * (sellPercent / 100);
    const keepTokens = this.state.totalTokens - sellTokens;
    const keepValue = keepTokens * currentPrice;

    console.log(`   卖出: ${sellTokens.toFixed(2)} tokens (${sellPercent.toFixed(2)}%)`);
    console.log(`   收回: $${profitValue.toFixed(2)}`);
    console.log(`   保留: ${keepTokens.toFixed(2)} tokens ($${keepValue.toFixed(2)})`);

    this.state.recordPartialSale({
      priceUSD: currentPrice,
      tokenAmount: sellTokens,
      usdReceived: profitValue,
      keepTokens,
      keepValue
    });

    console.log(`   ✅ 新的 entryPrice: $${this.state.entryPrice.toFixed(6)}`);
  }

  checkPrice(currentPrice) {
    console.log(`\n${'='.repeat(70)}`);
    console.log(`💲 当前价格: $${currentPrice.toFixed(6)}`);

    if (this.state.hasPosition) {
      const dropPercent = ((this.state.entryPrice - currentPrice) / this.state.entryPrice) * 100;
      const changeFromAvg = ((currentPrice - this.state.averagePrice) / this.state.averagePrice) * 100;
      console.log(`   相对 entryPrice ($${this.state.entryPrice.toFixed(6)}): ${dropPercent >= 0 ? '-' : '+'}${Math.abs(dropPercent).toFixed(2)}%`);
      console.log(`   相对 averagePrice ($${this.state.averagePrice.toFixed(6)}): ${changeFromAvg >= 0 ? '+' : ''}${changeFromAvg.toFixed(2)}%`);
    }

    if (this.shouldEntry()) {
      this.executeEntry(currentPrice);
    } else if (this.shouldBreakEven(currentPrice)) {
      this.executeBreakEven(currentPrice);
    } else if (this.shouldTakeProfit(currentPrice)) {
      this.executeTakeProfit(currentPrice);
    } else if (this.shouldAddPosition(currentPrice)) {
      this.executeAddPosition(currentPrice);
    } else {
      console.log(`   ⏳ 持仓中，等待触发条件...`);
    }

    this.state.print();
  }
}

// 测试场景
console.log('\n' + '='.repeat(70));
console.log('🧪 马丁格尔策略逻辑测试');
console.log('='.repeat(70));
console.log('\n📋 配置:');
console.log(`   基础投入: $${CONFIG.baseAmount}`);
console.log(`   加仓倍数: ${CONFIG.multiplier}x`);
console.log(`   下跌触发: ${CONFIG.dropPercentage}%`);
console.log(`   最大加仓: ${CONFIG.maxAddPositions}次`);
console.log(`   止盈百分比: ${CONFIG.takeProfitPercentage}%`);

const strategy = new TestStrategy(CONFIG);

// 测试价格序列
const priceSequence = [
  { price: 0.10, desc: '开仓价' },
  { price: 0.095, desc: '小幅下跌' },
  { price: 0.08, desc: '下跌 -20%，触发第1次加仓' },
  { price: 0.075, desc: '继续下跌' },
  { price: 0.06, desc: '下跌 -40%，触发第2次加仓' },
  { price: 0.065, desc: '小幅反弹' },
  { price: 0.075, desc: '回到均价，触发回本卖出' },
  { price: 0.07, desc: '回本后小幅下跌' },
  { price: 0.06, desc: '相对新 entryPrice 下跌 -20%，触发第1次加仓' },
  { price: 0.08, desc: '上涨' },
  { price: 0.09, desc: '相对 entryPrice +20%，触发止盈' },
  { price: 0.095, desc: '继续上涨' },
];

console.log('\n📈 测试价格序列:');
priceSequence.forEach((item, i) => {
  console.log(`   ${i + 1}. $${item.price.toFixed(6)} - ${item.desc}`);
});

console.log('\n\n' + '='.repeat(70));
console.log('开始测试...');
console.log('='.repeat(70));

// 执行测试
priceSequence.forEach(item => {
  strategy.checkPrice(item.price);
});

// 最终总结
console.log('\n\n' + '='.repeat(70));
console.log('📊 测试完成 - 最终总结');
console.log('='.repeat(70));

strategy.state.print();

console.log(`\n📝 买入记录: ${strategy.state.purchases.length}笔`);
strategy.state.purchases.forEach((p, i) => {
  console.log(`   ${i + 1}. [${p.type}] $${p.priceUSD.toFixed(6)} - ${p.tokensReceived.toFixed(2)} tokens - $${p.usdAmount.toFixed(2)}`);
});

console.log(`\n💰 卖出记录: ${strategy.state.sales.length}笔`);
strategy.state.sales.forEach((s, i) => {
  console.log(`   ${i + 1}. [${s.type}] $${s.priceUSD.toFixed(6)} - ${s.tokenAmount.toFixed(2)} tokens - $${s.usdReceived.toFixed(2)}`);
});

console.log('\n✅ 测试结束\n');
