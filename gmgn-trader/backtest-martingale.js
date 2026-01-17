/**
 * 马丁格尔策略回测引擎
 *
 * 使用历史价格数据模拟策略执行，验证交易逻辑
 */

import fs from 'fs';
import MARTINGALE_CONFIG from './martingale-config.js';

class BacktestEngine {
  constructor(config) {
    this.config = config;
    this.reset();
  }

  reset() {
    // 持仓状态
    this.hasPosition = false;
    this.entryPrice = 0;
    this.averagePrice = 0;
    this.totalTokens = 0;
    this.totalInvestedUSD = 0;
    this.totalInvestedBNB = 0;
    this.addPositionCount = 0;

    // 交易记录
    this.trades = [];
    this.purchases = [];
    this.sales = [];

    // 统计
    this.stats = {
      totalTrades: 0,
      totalProfit: 0,
      totalLoss: 0,
      winCount: 0,
      lossCount: 0,
      maxProfit: 0,
      maxLoss: 0,
      maxDrawdown: 0,
      peakBalance: 0
    };

    // 初始资金
    this.initialBalance = 1000; // 假设1000美金初始资金
    this.currentBalance = this.initialBalance;
    this.peakBalance = this.initialBalance;
  }

  /**
   * 计算下一次加仓需要的美金数量
   */
  calculateNextPositionUSD() {
    if (!this.hasPosition) {
      return this.config.baseAmount;
    } else {
      const lastPurchase = this.purchases[this.purchases.length - 1];
      return lastPurchase.usdAmount * this.config.multiplier;
    }
  }

  /**
   * 计算下一次加仓需要的BNB数量
   */
  calculateNextPositionBNB() {
    const usdAmount = this.calculateNextPositionUSD();
    return usdAmount / this.config.bnbPrice;
  }

  /**
   * 判断是否应该开仓
   */
  shouldEntry() {
    return !this.hasPosition;
  }

  /**
   * 判断是否应该加仓
   */
  shouldAddPosition(currentPrice) {
    if (!this.hasPosition) return false;
    if (this.addPositionCount >= this.config.maxAddPositions) return false;

    const dropPercent = ((this.entryPrice - currentPrice) / this.entryPrice) * 100;
    const nextAddTrigger = this.config.dropPercentage * (this.addPositionCount + 1);

    return dropPercent >= nextAddTrigger;
  }

  /**
   * 判断是否应该止盈
   */
  shouldTakeProfit(currentPrice) {
    if (!this.hasPosition) return false;

    const profitPercent = ((currentPrice - this.averagePrice) / this.averagePrice) * 100;
    return profitPercent >= this.config.takeProfitPercentage;
  }

  /**
   * 执行开仓
   */
  executeEntry(price, timestamp) {
    const usdAmount = this.config.baseAmount;
    const bnbAmount = usdAmount / this.config.bnbPrice;
    const tokensReceived = usdAmount / price;

    // 检查资金
    if (this.currentBalance < usdAmount) {
      console.log(`⚠️  资金不足，无法开仓 (需要: $${usdAmount}, 剩余: $${this.currentBalance.toFixed(2)})`);
      return false;
    }

    const purchase = {
      timestamp,
      type: 'entry',
      price,
      bnbAmount,
      usdAmount,
      tokensReceived,
      phase: '开仓'
    };

    this.purchases.push(purchase);
    this.trades.push({ ...purchase, action: 'BUY' });

    // 更新持仓
    this.hasPosition = true;
    this.entryPrice = price;
    this.totalTokens += tokensReceived;
    this.totalInvestedUSD += usdAmount;
    this.totalInvestedBNB += bnbAmount;
    this.currentBalance -= usdAmount;
    this.addPositionCount = 0;

    // 重新计算均价
    this.recalculateAveragePrice();

    console.log(`\n🎯 [开仓] @ $${price.toFixed(10)}`);
    console.log(`   投入: $${usdAmount} (${bnbAmount.toFixed(6)} BNB)`);
    console.log(`   得到: ${tokensReceived.toFixed(0)} tokens`);
    console.log(`   均价: $${this.averagePrice.toFixed(10)}`);
    console.log(`   剩余资金: $${this.currentBalance.toFixed(2)}`);

    return true;
  }

  /**
   * 执行加仓
   */
  executeAddPosition(price, timestamp) {
    const usdAmount = this.calculateNextPositionUSD();
    const bnbAmount = usdAmount / this.config.bnbPrice;
    const tokensReceived = usdAmount / price;

    // 检查资金
    if (this.currentBalance < usdAmount) {
      console.log(`⚠️  资金不足，无法加仓 (需要: $${usdAmount}, 剩余: $${this.currentBalance.toFixed(2)})`);
      return false;
    }

    const dropPercent = ((this.entryPrice - price) / this.entryPrice) * 100;

    const purchase = {
      timestamp,
      type: 'add_position',
      price,
      bnbAmount,
      usdAmount,
      tokensReceived,
      dropPercent,
      phase: `加仓${this.addPositionCount + 1}`
    };

    this.purchases.push(purchase);
    this.trades.push({ ...purchase, action: 'BUY' });

    // 更新持仓
    this.totalTokens += tokensReceived;
    this.totalInvestedUSD += usdAmount;
    this.totalInvestedBNB += bnbAmount;
    this.currentBalance -= usdAmount;
    this.addPositionCount++;

    // 重新计算均价
    this.recalculateAveragePrice();

    console.log(`\n📈 [加仓${this.addPositionCount}] @ $${price.toFixed(10)} (${dropPercent.toFixed(1)}% 下跌)`);
    console.log(`   投入: $${usdAmount} (${bnbAmount.toFixed(6)} BNB)`);
    console.log(`   得到: ${tokensReceived.toFixed(0)} tokens`);
    console.log(`   累计持仓: ${this.totalTokens.toFixed(0)} tokens`);
    console.log(`   新均价: $${this.averagePrice.toFixed(10)}`);
    console.log(`   剩余资金: $${this.currentBalance.toFixed(2)}`);

    return true;
  }

  /**
   * 执行止盈
   */
  executeTakeProfit(price, timestamp) {
    const tokenAmount = this.totalTokens;
    const saleValue = tokenAmount * price;
    const profit = saleValue - this.totalInvestedUSD;
    const profitPercent = (profit / this.totalInvestedUSD) * 100;

    const sale = {
      timestamp,
      type: 'take_profit',
      price,
      tokenAmount,
      saleValue,
      profit,
      profitPercent,
      phase: '止盈'
    };

    this.sales.push(sale);
    this.trades.push({ ...sale, action: 'SELL' });

    // 更新资金
    this.currentBalance += saleValue;

    // 更新统计
    this.stats.totalTrades++;
    if (profit > 0) {
      this.stats.totalProfit += profit;
      this.stats.winCount++;
      this.stats.maxProfit = Math.max(this.stats.maxProfit, profit);
    } else {
      this.stats.totalLoss += Math.abs(profit);
      this.stats.lossCount++;
      this.stats.maxLoss = Math.max(this.stats.maxLoss, Math.abs(profit));
    }

    // 更新峰值和回撤
    if (this.currentBalance > this.peakBalance) {
      this.peakBalance = this.currentBalance;
    }
    const drawdown = ((this.peakBalance - this.currentBalance) / this.peakBalance) * 100;
    this.stats.maxDrawdown = Math.max(this.stats.maxDrawdown, drawdown);

    console.log(`\n💰 [止盈] @ $${price.toFixed(10)}`);
    console.log(`   卖出: ${tokenAmount.toFixed(0)} tokens`);
    console.log(`   收入: $${saleValue.toFixed(2)}`);
    console.log(`   成本: $${this.totalInvestedUSD.toFixed(2)}`);
    console.log(`   盈利: $${profit.toFixed(2)} (${profitPercent.toFixed(2)}%)`);
    console.log(`   当前资金: $${this.currentBalance.toFixed(2)}`);
    console.log(`   总盈亏: $${(this.currentBalance - this.initialBalance).toFixed(2)}`);

    // 重置持仓
    this.resetPosition();

    return true;
  }

  /**
   * 重新计算均价
   */
  recalculateAveragePrice() {
    if (this.totalTokens > 0) {
      this.averagePrice = this.totalInvestedUSD / this.totalTokens;
    } else {
      this.averagePrice = 0;
    }
  }

  /**
   * 重置持仓
   */
  resetPosition() {
    this.hasPosition = false;
    this.entryPrice = 0;
    this.averagePrice = 0;
    this.totalTokens = 0;
    this.totalInvestedUSD = 0;
    this.totalInvestedBNB = 0;
    this.addPositionCount = 0;
    this.purchases = [];
  }

  /**
   * 运行回测
   */
  runBacktest(priceData) {
    console.log('\n' + '='.repeat(70));
    console.log('🔬 开始回测');
    console.log('='.repeat(70));
    console.log(`初始资金: $${this.initialBalance}`);
    console.log(`数据点数: ${priceData.length}`);
    console.log(`时间跨度: ${(priceData.length / 60).toFixed(1)} 分钟`);
    console.log('='.repeat(70));

    for (let i = 0; i < priceData.length; i++) {
      const dataPoint = priceData[i];
      const price = dataPoint.price;
      const timestamp = dataPoint.timestamp;

      // 判断操作
      if (this.shouldEntry()) {
        this.executeEntry(price, timestamp);
      } else if (this.shouldTakeProfit(price)) {
        this.executeTakeProfit(price, timestamp);
      } else if (this.shouldAddPosition(price)) {
        this.executeAddPosition(price, timestamp);
      }

      // 定期显示进度
      if (i % 200 === 0 && i > 0) {
        const progress = ((i / priceData.length) * 100).toFixed(1);
        console.log(`\n⏳ 进度: ${progress}% (${i}/${priceData.length})`);
        console.log(`   当前价格: $${price.toFixed(10)}`);
        console.log(`   当前资金: $${this.currentBalance.toFixed(2)}`);
        if (this.hasPosition) {
          console.log(`   持仓状态: ✅ (${this.totalTokens.toFixed(0)} tokens @ $${this.averagePrice.toFixed(10)})`);
        }
      }
    }

    // 如果最后还有持仓，按最后价格清仓
    if (this.hasPosition) {
      const lastPrice = priceData[priceData.length - 1].price;
      console.log('\n⚠️  回测结束时仍有持仓，强制清仓');
      this.executeTakeProfit(lastPrice, priceData[priceData.length - 1].timestamp);
    }

    this.generateReport(priceData);
  }

  /**
   * 生成回测报告
   */
  generateReport(priceData) {
    console.log('\n\n' + '='.repeat(70));
    console.log('📊 回测报告');
    console.log('='.repeat(70));

    const totalReturn = this.currentBalance - this.initialBalance;
    const totalReturnPercent = (totalReturn / this.initialBalance) * 100;

    console.log('\n💰 资金情况:');
    console.log(`   初始资金: $${this.initialBalance.toFixed(2)}`);
    console.log(`   最终资金: $${this.currentBalance.toFixed(2)}`);
    console.log(`   总盈亏: $${totalReturn.toFixed(2)} (${totalReturnPercent.toFixed(2)}%)`);
    console.log(`   峰值资金: $${this.peakBalance.toFixed(2)}`);
    console.log(`   最大回撤: ${this.stats.maxDrawdown.toFixed(2)}%`);

    console.log('\n📈 交易统计:');
    console.log(`   总交易次数: ${this.stats.totalTrades}`);
    console.log(`   盈利次数: ${this.stats.winCount}`);
    console.log(`   亏损次数: ${this.stats.lossCount}`);
    console.log(`   胜率: ${this.stats.totalTrades > 0 ? ((this.stats.winCount / this.stats.totalTrades) * 100).toFixed(2) : 0}%`);

    console.log('\n💵 盈亏详情:');
    console.log(`   总盈利: $${this.stats.totalProfit.toFixed(2)}`);
    console.log(`   总亏损: $${this.stats.totalLoss.toFixed(2)}`);
    console.log(`   最大单笔盈利: $${this.stats.maxProfit.toFixed(2)}`);
    console.log(`   最大单笔亏损: $${this.stats.maxLoss.toFixed(2)}`);
    console.log(`   盈亏比: ${this.stats.totalLoss > 0 ? (this.stats.totalProfit / this.stats.totalLoss).toFixed(2) : 'N/A'}`);

    console.log('\n📋 买入记录:');
    this.trades.filter(t => t.action === 'BUY').forEach((trade, i) => {
      console.log(`   ${i + 1}. [${trade.phase}] @ $${trade.price.toFixed(10)} | 投入: $${trade.usdAmount.toFixed(2)} | 得到: ${trade.tokensReceived.toFixed(0)} tokens`);
    });

    console.log('\n📋 卖出记录:');
    this.trades.filter(t => t.action === 'SELL').forEach((trade, i) => {
      const profitSign = trade.profit >= 0 ? '+' : '';
      console.log(`   ${i + 1}. [${trade.phase}] @ $${trade.price.toFixed(10)} | 收入: $${trade.saleValue.toFixed(2)} | 盈亏: ${profitSign}$${trade.profit.toFixed(2)} (${profitSign}${trade.profitPercent.toFixed(2)}%)`);
    });

    console.log('\n' + '='.repeat(70));

    // 保存详细报告
    this.saveReport(priceData);
  }

  /**
   * 保存报告到文件
   */
  saveReport(priceData) {
    const report = {
      timestamp: new Date().toISOString(),
      config: {
        baseAmount: this.config.baseAmount,
        bnbPrice: this.config.bnbPrice,
        multiplier: this.config.multiplier,
        dropPercentage: this.config.dropPercentage,
        maxAddPositions: this.config.maxAddPositions,
        takeProfitPercentage: this.config.takeProfitPercentage
      },
      results: {
        initialBalance: this.initialBalance,
        finalBalance: this.currentBalance,
        totalReturn: this.currentBalance - this.initialBalance,
        totalReturnPercent: ((this.currentBalance - this.initialBalance) / this.initialBalance) * 100,
        peakBalance: this.peakBalance,
        maxDrawdown: this.stats.maxDrawdown
      },
      stats: this.stats,
      trades: this.trades
    };

    fs.writeFileSync('backtest-report.json', JSON.stringify(report, null, 2));
    console.log('✅ 详细报告已保存到: backtest-report.json');
  }
}

// 主程序
async function main() {
  // 读取价格数据
  if (!fs.existsSync('backtest-price-data.json')) {
    console.log('❌ 未找到价格数据文件: backtest-price-data.json');
    console.log('💡 请先运行: node generate-price-data.js');
    return;
  }

  const priceDataFile = JSON.parse(fs.readFileSync('backtest-price-data.json', 'utf8'));
  const priceData = priceDataFile.data;

  console.log('📊 加载价格数据:');
  console.log(`   数据点数: ${priceData.length}`);
  console.log(`   起始价格: $${priceDataFile.start_price}`);
  console.log(`   结束价格: $${priceDataFile.end_price}`);
  console.log(`   价格变化: ${priceDataFile.price_change_percent}%`);

  // 创建回测引擎
  const engine = new BacktestEngine(MARTINGALE_CONFIG);

  // 运行回测
  engine.runBacktest(priceData);
}

main().catch(error => {
  console.error('❌ 回测失败:', error);
});
