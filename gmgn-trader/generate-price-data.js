/**
 * 价格数据生成器
 *
 * 生成模拟的价格波动数据用于回测
 */

import fs from 'fs';

/**
 * 生成价格数据
 * @param {Object} options - 配置选项
 * @returns {Array} 价格数据数组
 */
function generatePriceData(options = {}) {
  const {
    startPrice = 0.00001,      // 起始价格
    dataPoints = 1000,         // 数据点数量
    volatility = 0.02,         // 波动率（2%）
    trend = 0,                 // 趋势（0=震荡，正=上涨，负=下跌）
    minPrice = 0.000001,       // 最低价格
    maxPrice = 0.0001,         // 最高价格
    timeInterval = 1000,       // 时间间隔（毫秒）
    scenario = 'random'        // 场景：random, pump, dump, recovery, volatile
  } = options;

  const prices = [];
  let currentPrice = startPrice;
  let timestamp = Date.now();

  // 根据场景调整参数
  let actualVolatility = volatility;
  let actualTrend = trend;

  if (scenario === 'pump') {
    // 拉盘场景：先下跌后大幅上涨
    actualTrend = 0.001;
    actualVolatility = 0.03;
  } else if (scenario === 'dump') {
    // 砸盘场景：持续下跌
    actualTrend = -0.001;
    actualVolatility = 0.02;
  } else if (scenario === 'recovery') {
    // 恢复场景：下跌后慢慢恢复
    actualTrend = 0;
    actualVolatility = 0.025;
  } else if (scenario === 'volatile') {
    // 剧烈波动
    actualVolatility = 0.05;
  }

  for (let i = 0; i < dataPoints; i++) {
    // 随机波动
    const randomChange = (Math.random() - 0.5) * 2 * actualVolatility;

    // 趋势影响
    let trendEffect = actualTrend;

    // 特殊场景逻辑
    if (scenario === 'pump' && i > dataPoints * 0.3) {
      trendEffect = 0.003; // 70%后开始拉盘
    } else if (scenario === 'recovery') {
      if (i < dataPoints * 0.4) {
        trendEffect = -0.002; // 前40%下跌
      } else {
        trendEffect = 0.0015; // 后60%恢复
      }
    }

    // 计算新价格
    currentPrice = currentPrice * (1 + randomChange + trendEffect);

    // 限制价格范围
    currentPrice = Math.max(minPrice, Math.min(maxPrice, currentPrice));

    prices.push({
      timestamp: timestamp,
      price: currentPrice,
      index: i
    });

    timestamp += timeInterval;
  }

  return prices;
}

/**
 * 生成马丁格尔测试场景
 * 专门设计用于测试马丁格尔策略的价格走势
 */
function generateMartingaleTestScenario() {
  const prices = [];
  let currentPrice = 0.00001;
  let timestamp = Date.now();
  const timeInterval = 1000; // 1秒

  // 场景1: 下跌触发加仓，然后反弹止盈 (400个点)
  console.log('生成场景1: 下跌-反弹-止盈');

  // 初始价格稳定 (50个点)
  for (let i = 0; i < 50; i++) {
    const noise = (Math.random() - 0.5) * 0.01; // 1%噪音
    currentPrice = currentPrice * (1 + noise);
    prices.push({ timestamp, price: currentPrice, index: i, phase: '初始稳定' });
    timestamp += timeInterval;
  }

  const entryPrice = currentPrice;
  console.log(`开仓价格: $${entryPrice}`);

  // 下跌20% 触发第一次加仓 (100个点)
  for (let i = 0; i < 100; i++) {
    currentPrice = currentPrice * 0.998; // 每次下跌0.2%
    const noise = (Math.random() - 0.5) * 0.005;
    currentPrice = currentPrice * (1 + noise);
    prices.push({ timestamp, price: currentPrice, index: prices.length, phase: '下跌20%' });
    timestamp += timeInterval;
  }
  console.log(`第1次加仓价格: $${currentPrice} (-${((1 - currentPrice/entryPrice) * 100).toFixed(1)}%)`);

  // 继续下跌到-40% 触发第二次加仓 (100个点)
  for (let i = 0; i < 100; i++) {
    currentPrice = currentPrice * 0.998;
    const noise = (Math.random() - 0.5) * 0.005;
    currentPrice = currentPrice * (1 + noise);
    prices.push({ timestamp, price: currentPrice, index: prices.length, phase: '下跌40%' });
    timestamp += timeInterval;
  }
  console.log(`第2次加仓价格: $${currentPrice} (-${((1 - currentPrice/entryPrice) * 100).toFixed(1)}%)`);

  // 反弹回均价并触发止盈 (150个点)
  const targetPrice = entryPrice * 0.75; // 假设均价大约在-25%位置
  const takeProfitPrice = targetPrice * 1.2; // 均价+20%

  for (let i = 0; i < 150; i++) {
    const progress = i / 150;
    currentPrice = currentPrice + (takeProfitPrice - currentPrice) * 0.015;
    const noise = (Math.random() - 0.5) * 0.01;
    currentPrice = currentPrice * (1 + noise);
    prices.push({ timestamp, price: currentPrice, index: prices.length, phase: '反弹止盈' });
    timestamp += timeInterval;
  }
  console.log(`止盈价格: $${currentPrice} (+${((currentPrice/targetPrice - 1) * 100).toFixed(1)}%相对均价)`);

  // 场景2: 持续下跌触发所有加仓，然后大幅反弹 (400个点)
  console.log('\n生成场景2: 持续下跌-满仓-大反弹');

  // 小幅震荡 (50个点)
  for (let i = 0; i < 50; i++) {
    const noise = (Math.random() - 0.5) * 0.02;
    currentPrice = currentPrice * (1 + noise);
    prices.push({ timestamp, price: currentPrice, index: prices.length, phase: '震荡整理' });
    timestamp += timeInterval;
  }

  const entryPrice2 = currentPrice;
  console.log(`\n第2轮开仓价格: $${entryPrice2}`);

  // 持续下跌到-20%, -40%, -60% 触发所有加仓 (200个点)
  for (let i = 0; i < 200; i++) {
    currentPrice = currentPrice * 0.997; // 持续下跌
    const noise = (Math.random() - 0.5) * 0.003;
    currentPrice = currentPrice * (1 + noise);

    const dropPercent = (1 - currentPrice/entryPrice2) * 100;
    let phase = '持续下跌';
    if (Math.abs(dropPercent - 20) < 2) phase = '第1次加仓';
    else if (Math.abs(dropPercent - 40) < 2) phase = '第2次加仓';
    else if (Math.abs(dropPercent - 60) < 2) phase = '第3次加仓';

    prices.push({ timestamp, price: currentPrice, index: prices.length, phase });
    timestamp += timeInterval;
  }
  console.log(`第3次加仓价格: $${currentPrice} (-${((1 - currentPrice/entryPrice2) * 100).toFixed(1)}%)`);

  // 触底反弹 (150个点)
  const targetPrice2 = entryPrice2 * 0.5; // 均价约在-50%
  const takeProfitPrice2 = targetPrice2 * 1.2;

  for (let i = 0; i < 150; i++) {
    currentPrice = currentPrice + (takeProfitPrice2 - currentPrice) * 0.02;
    const noise = (Math.random() - 0.5) * 0.01;
    currentPrice = currentPrice * (1 + noise);
    prices.push({ timestamp, price: currentPrice, index: prices.length, phase: '大幅反弹' });
    timestamp += timeInterval;
  }
  console.log(`止盈价格: $${currentPrice} (+${((currentPrice/targetPrice2 - 1) * 100).toFixed(1)}%相对均价)`);

  // 场景3: 震荡行情 (200个点)
  console.log('\n生成场景3: 震荡行情');
  for (let i = 0; i < 200; i++) {
    const wave = Math.sin(i / 20) * 0.05; // 5%的波浪
    const noise = (Math.random() - 0.5) * 0.02;
    currentPrice = currentPrice * (1 + wave + noise);
    prices.push({ timestamp, price: currentPrice, index: prices.length, phase: '震荡整理' });
    timestamp += timeInterval;
  }

  return prices;
}

/**
 * 保存价格数据到JSON文件
 */
function savePriceData(prices, filename = 'backtest-price-data.json') {
  const data = {
    generated_at: new Date().toISOString(),
    total_points: prices.length,
    duration_seconds: prices.length,
    start_price: prices[0].price,
    end_price: prices[prices.length - 1].price,
    min_price: Math.min(...prices.map(p => p.price)),
    max_price: Math.max(...prices.map(p => p.price)),
    price_change_percent: ((prices[prices.length - 1].price / prices[0].price - 1) * 100).toFixed(2),
    data: prices
  };

  fs.writeFileSync(filename, JSON.stringify(data, null, 2));
  console.log(`\n✅ 价格数据已保存到: ${filename}`);
  console.log(`   总数据点: ${data.total_points}`);
  console.log(`   时间跨度: ${(data.duration_seconds / 60).toFixed(1)} 分钟`);
  console.log(`   起始价格: $${data.start_price}`);
  console.log(`   结束价格: $${data.end_price}`);
  console.log(`   最低价格: $${data.min_price}`);
  console.log(`   最高价格: $${data.max_price}`);
  console.log(`   价格变化: ${data.price_change_percent}%`);
}

// 主程序
console.log('🎲 价格数据生成器');
console.log('='.repeat(70));

// 生成马丁格尔测试场景
console.log('\n生成专门的马丁格尔测试数据...\n');
const prices = generateMartingaleTestScenario();

// 保存数据
savePriceData(prices, 'backtest-price-data.json');

console.log('\n📊 数据统计:');
const phases = {};
prices.forEach(p => {
  phases[p.phase] = (phases[p.phase] || 0) + 1;
});
console.log('\n各阶段数据点分布:');
Object.entries(phases).forEach(([phase, count]) => {
  console.log(`  ${phase}: ${count} 个点`);
});

console.log('\n💡 使用方法:');
console.log('   node backtest-martingale.js');
