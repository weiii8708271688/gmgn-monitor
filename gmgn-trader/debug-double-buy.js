/**
 * 调试双重买入问题
 */

// 模拟场景
console.log('🐛 调试场景：快速双重买入');
console.log('='.repeat(70));

const CONFIG = {
  baseAmount: 10,
  multiplier: 2,
  dropPercentage: 20
};

let state = {
  entryPrice: 0.0001,
  averagePrice: 0.0001,
  totalInvestedUSD: 10,
  addPositionCount: 0
};

console.log('\n1️⃣ 开仓 @ $0.0001');
console.log(`   entryPrice: $${state.entryPrice}`);
console.log(`   averagePrice: $${state.averagePrice}`);
console.log(`   totalInvestedUSD: $${state.totalInvestedUSD}`);
console.log(`   addPositionCount: ${state.addPositionCount}`);

// 检查第1次加仓条件
const price1 = 0.00008;
const dropPercent1 = ((state.entryPrice - price1) / state.entryPrice) * 100;
const nextTrigger1 = CONFIG.dropPercentage * (state.addPositionCount + 1);

console.log(`\n2️⃣ 价格跌到 $${price1}`);
console.log(`   跌幅: ${dropPercent1.toFixed(2)}%`);
console.log(`   第${state.addPositionCount + 1}次加仓触发点: ${nextTrigger1}%`);
console.log(`   是否触发: ${dropPercent1 >= nextTrigger1 ? '✅' : '❌'}`);

if (dropPercent1 >= nextTrigger1) {
  console.log('\n   执行第1次加仓...');

  // 加仓前的状态
  console.log(`   加仓前 averagePrice: $${state.averagePrice}`);

  // 计算新的投入
  const addAmount = CONFIG.baseAmount * Math.pow(CONFIG.multiplier, state.addPositionCount + 1);
  state.totalInvestedUSD += addAmount;

  // 计算新的均价（简化）
  // 假设: totalTokens = totalInvestedUSD / averagePrice
  // 新均价 = totalInvestedUSD / totalTokens
  // 实际应该根据每次买入价格计算
  const totalTokensBefore = state.totalInvestedUSD / state.averagePrice;
  const newTokens = addAmount / price1;
  const totalTokensAfter = totalTokensBefore + newTokens;
  state.averagePrice = state.totalInvestedUSD / totalTokensAfter;
  state.addPositionCount++;

  console.log(`   投入: $${addAmount}`);
  console.log(`   加仓后 averagePrice: $${state.averagePrice.toFixed(8)}`);
  console.log(`   加仓后 totalInvestedUSD: $${state.totalInvestedUSD}`);
  console.log(`   加仓后 addPositionCount: ${state.addPositionCount}`);
}

// 立即检查回本条件
console.log(`\n3️⃣ 立即检查回本条件（价格还是 $${price1}）`);
console.log(`   addPositionCount: ${state.addPositionCount}`);
console.log(`   currentPrice: $${price1}`);
console.log(`   averagePrice: $${state.averagePrice.toFixed(8)}`);
console.log(`   currentPrice >= averagePrice: ${price1 >= state.averagePrice ? '✅' : '❌'}`);

const shouldBreakEven = state.addPositionCount > 0 && price1 >= state.averagePrice;
console.log(`   是否触发回本: ${shouldBreakEven ? '✅ 会卖出！' : '❌'}`);

// 如果还没触发回本，继续检查第2次加仓
if (!shouldBreakEven) {
  const dropPercent2 = ((state.entryPrice - price1) / state.entryPrice) * 100;
  const nextTrigger2 = CONFIG.dropPercentage * (state.addPositionCount + 1);

  console.log(`\n4️⃣ 检查第2次加仓条件（价格还是 $${price1}）`);
  console.log(`   跌幅: ${dropPercent2.toFixed(2)}%`);
  console.log(`   第${state.addPositionCount + 1}次加仓触发点: ${nextTrigger2}%`);
  console.log(`   是否触发: ${dropPercent2 >= nextTrigger2 ? '✅ 会再次买入！' : '❌'}`);

  if (dropPercent2 >= nextTrigger2) {
    console.log('\n   ⚠️  问题：在同一个价格会触发第2次加仓！');
    console.log(`   原因：跌幅 ${dropPercent2.toFixed(2)}% 已经达到第2次加仓的触发点 ${nextTrigger2}%`);
  }
}

console.log('\n' + '='.repeat(70));
console.log('💡 结论：');
console.log('   如果价格从 $0.0001 直接跌到 $0.00008（-20%）');
console.log('   在这个价格会触发第1次加仓');
console.log('   但是 -20% 的跌幅不足以触发第2次加仓（需要 -40%）');
console.log('   所以不应该出现"在同一价格快速买两笔"的情况');
console.log('\n   除非：');
console.log('   1. 价格继续跌到 $0.00006（-40%）才会第2次加仓');
console.log('   2. 或者冷却机制失效，导致重复触发');
console.log('='.repeat(70));
