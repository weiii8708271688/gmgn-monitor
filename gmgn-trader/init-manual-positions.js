/**
 * 手动初始化持仓数据
 * 用于导入已有的买入记录
 */

import MartingaleState from './martingale-state.js';
import readline from 'readline';

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

// 获取代币ID
const tokenId = process.argv[2];

if (!tokenId) {
  console.error('❌ 請提供代幣 ID');
  console.log('\n使用方法:');
  console.log('  node init-manual-positions.js token1');
  console.log('  node init-manual-positions.js token2\n');
  process.exit(1);
}

const stateFile = `./states/${tokenId}.state.json`;

console.log('\n' + '='.repeat(80));
console.log(`📝 手動初始化持倉 - ${tokenId.toUpperCase()}`);
console.log('='.repeat(80));

// 手动输入的买入记录
const purchases = [
  {
    price: 0.000090588,
    tokens: 439500,
    usdAmount: 39.81,
    bnbAmount: 0.016,
    timeAgo: '1m',
    note: '第1次买入'
  },
  {
    price: 0.00011091,
    tokens: 179900,
    usdAmount: 19.94,
    bnbAmount: 0.205,
    timeAgo: '10m',
    note: '第2次买入'
  },
  {
    price: 0.00011071,
    tokens: 180200,
    usdAmount: 19.94,
    bnbAmount: 0.205,
    timeAgo: '10m',
    note: '第3次买入'
  },
  {
    price: 0.00013890,
    tokens: 71990,
    usdAmount: 10,
    bnbAmount: 0.238,
    timeAgo: '41m',
    note: '第4次买入（开仓）'
  }
];

// 显示买入记录
console.log('\n📊 買入記錄:');
purchases.forEach((p, i) => {
  console.log(`\n${i + 1}. ${p.note} (${p.timeAgo}前)`);
  console.log(`   價格: $${p.price}`);
  console.log(`   數量: ${p.tokens.toLocaleString()} tokens`);
  console.log(`   投入: $${p.usdAmount} (${p.bnbAmount} BNB)`);
});

// 计算汇总数据
const totalTokens = purchases.reduce((sum, p) => sum + p.tokens, 0);
const totalInvestedUSD = purchases.reduce((sum, p) => sum + p.usdAmount, 0);
const totalInvestedBNB = purchases.reduce((sum, p) => sum + p.bnbAmount, 0);
const averagePrice = totalInvestedUSD / totalTokens;

// 开仓价 = 第4笔（最早的那笔，41m前）
const entryPrice = purchases[3].price;

// 加仓次数 = 总买入次数 - 1
const addPositionCount = purchases.length - 1;

console.log('\n' + '='.repeat(80));
console.log('📈 匯總數據:');
console.log(`   總持倉: ${totalTokens.toLocaleString()} tokens`);
console.log(`   總投入: $${totalInvestedUSD.toFixed(2)} (${totalInvestedBNB.toFixed(4)} BNB)`);
console.log(`   均價: $${averagePrice.toFixed(10)}`);
console.log(`   開倉價: $${entryPrice.toFixed(10)}`);
console.log(`   加倉次數: ${addPositionCount}`);
console.log('='.repeat(80));

const answer = await new Promise(resolve => {
  rl.question('\n是否確認初始化這些數據？(yes/y 確認，其他任意鍵取消): ', resolve);
});
rl.close();

if (answer.toLowerCase() !== 'yes' && answer.toLowerCase() !== 'y') {
  console.log('\n❌ 已取消初始化\n');
  process.exit(0);
}

console.log('\n✅ 開始初始化...\n');

// 创建状态管理器
const state = new MartingaleState(stateFile);

// 清空现有状态
state.resetPosition();

// 设置基本状态
state.state.hasPosition = true;
state.state.entryPrice = entryPrice;
state.state.averagePrice = averagePrice;
state.state.totalTokens = totalTokens;
state.state.totalInvestedUSD = totalInvestedUSD;
state.state.totalInvestedBNB = totalInvestedBNB;
state.state.addPositionCount = addPositionCount;

// 添加买入记录（从最早到最新）
// 第4笔是开仓（41m前）
state.state.purchases.push({
  timestamp: Date.now() - 41 * 60 * 1000,
  type: 'entry',
  priceUSD: purchases[3].price,
  bnbAmount: purchases[3].bnbAmount,
  usdAmount: purchases[3].usdAmount,
  tokensReceived: purchases[3].tokens,
  txHash: 'manual_import_1'
});

// 第2笔是加仓（10m前）
state.state.purchases.push({
  timestamp: Date.now() - 10 * 60 * 1000,
  type: 'add_position',
  priceUSD: purchases[1].price,
  bnbAmount: purchases[1].bnbAmount,
  usdAmount: purchases[1].usdAmount,
  tokensReceived: purchases[1].tokens,
  txHash: 'manual_import_2'
});

// 第3笔是加仓（10m前）
state.state.purchases.push({
  timestamp: Date.now() - 10 * 60 * 1000,
  type: 'add_position',
  priceUSD: purchases[2].price,
  bnbAmount: purchases[2].bnbAmount,
  usdAmount: purchases[2].usdAmount,
  tokensReceived: purchases[2].tokens,
  txHash: 'manual_import_3'
});

// 第1笔是加仓（1m前）
state.state.purchases.push({
  timestamp: Date.now() - 1 * 60 * 1000,
  type: 'add_position',
  priceUSD: purchases[0].price,
  bnbAmount: purchases[0].bnbAmount,
  usdAmount: purchases[0].usdAmount,
  tokensReceived: purchases[0].tokens,
  txHash: 'manual_import_4'
});

// 保存状态
state.save();

console.log('✅ 初始化完成！\n');
console.log(`📁 狀態文件: ${stateFile}\n`);

// 打印最终状态
state.printStatus();

console.log('\n💡 提示：');
console.log('   現在可以運行 node run-token.js ' + tokenId + ' 來啟動策略\n');
