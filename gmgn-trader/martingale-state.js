/**
 * 马丁格尔策略状态管理器
 *
 * 负责追踪和持久化策略状态：
 * - 当前持仓信息
 * - 加仓历史记录
 * - 开仓价格和均价
 * - 交易历史
 */

import fs from 'fs';
import path from 'path';

class MartingaleState {
  constructor(stateFilePath = null) {
    // 使用自定義狀態文件路徑或默認路徑
    this.stateFile = stateFilePath || './martingale-state.json';

    this.state = {
      // 当前是否有持仓
      hasPosition: false,

      // 开仓价格（USD）
      entryPrice: 0,

      // 当前均价（USD）- 根据所有买入计算
      averagePrice: 0,

      // 当前持仓数量（代币）
      totalTokens: 0,

      // 总投入（USD）
      totalInvestedUSD: 0,

      // 总投入（BNB）
      totalInvestedBNB: 0,

      // 加仓次数（不包括开仓，0表示仅开仓）
      addPositionCount: 0,

      // 买入记录
      purchases: [
        // {
        //   timestamp: 1234567890,
        //   type: 'entry' | 'add_position',
        //   priceUSD: 0.00001,
        //   bnbAmount: 0.1,
        //   usdAmount: 100,
        //   tokensReceived: 10000000,
        //   txHash: '0x...'
        // }
      ],

      // 卖出记录
      sales: [
        // {
        //   timestamp: 1234567890,
        //   type: 'take_profit' | 'stop_loss',
        //   priceUSD: 0.00001,
        //   tokenAmount: 10000000,
        //   bnbReceived: 0.2,
        //   usdReceived: 200,
        //   profitUSD: 100,
        //   profitPercent: 100,
        //   txHash: '0x...'
        // }
      ],

      // 统计信息
      stats: {
        totalTrades: 0,
        totalProfit: 0,
        totalLoss: 0,
        winRate: 0,
        maxProfit: 0,
        maxLoss: 0,
        totalFees: 0
      },

      // 最后更新时间
      lastUpdated: null
    };

    this.load();
  }

  /**
   * 加载状态
   */
  load() {
    try {
      if (fs.existsSync(this.stateFile)) {
        const data = fs.readFileSync(this.stateFile, 'utf8');
        this.state = JSON.parse(data);
        console.log(`✅ 策略状态已加载: ${this.stateFile}`);
      } else {
        console.log(`ℹ️  未找到状态文件，使用默认状态: ${this.stateFile}`);
      }
    } catch (error) {
      console.error('❌ 加载状态失败:', error.message);
    }
  }

  /**
   * 保存状态
   */
  save() {
    try {
      this.state.lastUpdated = Date.now();
      fs.writeFileSync(this.stateFile, JSON.stringify(this.state, null, 2));
      console.log(`✅ 策略状态已保存: ${this.stateFile}`);
    } catch (error) {
      console.error('❌ 保存状态失败:', error.message);
    }
  }

  /**
   * 记录买入
   * @param {Object} purchase - 买入信息
   */
  recordPurchase(purchase) {
    const { priceUSD, bnbAmount, usdAmount, tokensReceived, txHash } = purchase;

    const purchaseRecord = {
      timestamp: Date.now(),
      type: this.state.hasPosition ? 'add_position' : 'entry',
      priceUSD,
      bnbAmount,
      usdAmount,
      tokensReceived,
      txHash: txHash || 'N/A'
    };

    this.state.purchases.push(purchaseRecord);

    // 更新持仓状态
    this.state.hasPosition = true;
    this.state.totalTokens += tokensReceived;
    this.state.totalInvestedUSD += usdAmount;
    this.state.totalInvestedBNB += bnbAmount;

    // 更新开仓价格（仅首次）
    if (purchaseRecord.type === 'entry') {
      this.state.entryPrice = this.recalculateAveragePrice();
      this.state.addPositionCount = 0;
    } else {
      this.state.addPositionCount++;
    }

    // 重新计算均价
    this.recalculateAveragePrice();

    this.save();

    console.log(`📊 买入已记录: ${tokensReceived.toFixed(2)} tokens @ $${priceUSD}`);
    console.log(`   累计持仓: ${this.state.totalTokens.toFixed(2)} tokens`);
    console.log(`   当前均价: $${this.state.averagePrice}`);
  }

  /**
   * 记录卖出
   * @param {Object} sale - 卖出信息
   */
  recordSale(sale) {
    const { priceUSD, tokenAmount, bnbReceived, usdReceived, txHash } = sale;

    // 计算盈亏
    const costUSD = this.state.averagePrice * tokenAmount;
    const profitUSD = usdReceived - costUSD;
    const profitPercent = (profitUSD / costUSD) * 100;

    const saleRecord = {
      timestamp: Date.now(),
      type: profitUSD > 0 ? 'take_profit' : 'stop_loss',
      priceUSD,
      tokenAmount,
      bnbReceived,
      usdReceived,
      profitUSD,
      profitPercent,
      txHash: txHash || 'N/A'
    };

    this.state.sales.push(saleRecord);

    // 更新持仓状态
    this.state.totalTokens -= tokenAmount;

    // 如果清仓，重置状态
    if (this.state.totalTokens <= 0) {
      this.resetPosition();
    }

    // 更新统计
    this.updateStats(profitUSD, profitPercent);

    this.save();

    console.log(`📊 卖出已记录: ${tokenAmount.toFixed(2)} tokens @ $${priceUSD}`);
    console.log(`   盈亏: $${profitUSD.toFixed(2)} (${profitPercent.toFixed(2)}%)`);
  }

  /**
   * 记录部分卖出（保留 baseAmount）
   * @param {Object} sale - 卖出信息
   */
  recordPartialSale(sale) {
    const { priceUSD, tokenAmount, bnbReceived, usdReceived, txHash, keepTokens, keepValue } = sale;

    // 计算卖出部分的成本
    const sellCostUSD = this.state.averagePrice * tokenAmount;
    const profitUSD = usdReceived - sellCostUSD;
    const profitPercent = sellCostUSD > 0 ? (profitUSD / sellCostUSD) * 100 : 0;

    const saleRecord = {
      timestamp: Date.now(),
      type: 'partial_take_profit',
      priceUSD,
      tokenAmount,
      bnbReceived,
      usdReceived,
      profitUSD,
      profitPercent,
      txHash: txHash || 'N/A',
      keepTokens,
      keepValue
    };

    this.state.sales.push(saleRecord);

    // 更新持仓状态
    this.state.totalTokens -= tokenAmount;
    this.state.totalInvestedUSD = keepValue;

    // 更新均價和開倉價
    
    // 止盈後，entryPrice 應該是 baseAmount / 剩餘持倉量
    // 這樣下次加倉的參考點就是當前的持倉均價
    this.state.entryPrice = keepValue / keepTokens; // 新的開倉價 = 保留價值 / 保留代幣數量


    this.state.averagePrice = this.state.entryPrice;

    // 更新统计
    this.updateStats(profitUSD, profitPercent);

    this.save();

    console.log(`📊 部分卖出已记录: ${tokenAmount.toFixed(2)} tokens @ $${priceUSD}`);
    console.log(`   盈亏: $${profitUSD.toFixed(2)} (${profitPercent.toFixed(2)}%)`);
    console.log(`   保留: ${keepTokens.toFixed(2)} tokens ($${keepValue.toFixed(2)})`);
  }

  /**
   * 记录回本卖出（加倉後回到均價）
   * @param {Object} sale - 卖出信息
   */
  recordBreakEven(sale) {
    const { priceUSD, tokenAmount, bnbReceived, usdReceived, txHash, keepTokens, keepValue } = sale;

    const saleRecord = {
      timestamp: Date.now(),
      type: 'break_even',
      priceUSD,
      tokenAmount,
      bnbReceived,
      usdReceived,
      profitUSD: 0, // 回本不算盈利
      profitPercent: 0,
      txHash: txHash || 'N/A',
      keepTokens,
      keepValue
    };

    this.state.sales.push(saleRecord);

    // 重置持倉狀態為 baseAmount
    this.state.totalTokens = keepTokens;
    this.state.totalInvestedUSD = keepValue;
    // 回本後，entryPrice 設為當前均價（重新開始計算加倉點位）
    this.state.entryPrice = this.state.averagePrice;
    this.state.addPositionCount = 0; // 重置加倉次數

    // 清空買入記錄（重新開始）
    this.state.purchases = [];

    this.save();

    console.log(`📊 回本卖出已记录: ${tokenAmount.toFixed(2)} tokens @ $${priceUSD}`);
    console.log(`   收回: $${usdReceived.toFixed(2)}`);
    console.log(`   保留: ${keepTokens.toFixed(2)} tokens ($${keepValue.toFixed(2)})`);
    console.log(`   狀態已重置，加倉點位重新計算`);
  }

  /**
   * 重新计算均价
   */
  recalculateAveragePrice() {
    if (this.state.totalTokens > 0) {
      // 均价 = 总投入 / 总持仓
      this.state.averagePrice = this.state.totalInvestedUSD / this.state.totalTokens;
    } else {
      this.state.averagePrice = 0;
    }
    return this.state.averagePrice;
  }

  /**
   * 重置持仓状态
   */
  resetPosition() {
    this.state.hasPosition = false;
    this.state.entryPrice = 0;
    this.state.averagePrice = 0;
    this.state.totalTokens = 0;
    this.state.totalInvestedUSD = 0;
    this.state.totalInvestedBNB = 0;
    this.state.addPositionCount = 0;
    this.state.purchases = [];

    console.log('✅ 持仓已重置');
  }

  /**
   * 更新统计
   */
  updateStats(profitUSD, profitPercent) {
    this.state.stats.totalTrades++;

    if (profitUSD > 0) {
      this.state.stats.totalProfit += profitUSD;
      this.state.stats.maxProfit = Math.max(this.state.stats.maxProfit, profitUSD);
    } else {
      this.state.stats.totalLoss += Math.abs(profitUSD);
      this.state.stats.maxLoss = Math.max(this.state.stats.maxLoss, Math.abs(profitUSD));
    }

    // 计算胜率
    const profitableTrades = this.state.sales.filter(s => s.profitUSD > 0).length;
    this.state.stats.winRate = (profitableTrades / this.state.stats.totalTrades) * 100;
  }

  /**
   * 获取当前状态摘要
   */
  getSummary() {
    return {
      hasPosition: this.state.hasPosition,
      entryPrice: this.state.entryPrice,
      averagePrice: this.state.averagePrice,
      totalTokens: this.state.totalTokens,
      totalInvestedUSD: this.state.totalInvestedUSD,
      totalInvestedBNB: this.state.totalInvestedBNB,
      addPositionCount: this.state.addPositionCount,
      purchaseCount: this.state.purchases.length,
      saleCount: this.state.sales.length,
      stats: this.state.stats
    };
  }

  /**
   * 打印当前状态
   */
  printStatus() {
    const summary = this.getSummary();

    console.log('\n' + '='.repeat(60));
    console.log('📊 当前策略状态');
    console.log('='.repeat(60));

    if (summary.hasPosition) {
      console.log(`持仓状态: ✅ 有持仓`);
      console.log(`开仓价格: $${summary.entryPrice}`);
      console.log(`当前均价: $${summary.averagePrice}`);
      console.log(`持仓数量: ${summary.totalTokens.toFixed(2)} tokens`);
      console.log(`总投入USD: $${summary.totalInvestedUSD.toFixed(2)}`);
      console.log(`总投入BNB: ${summary.totalInvestedBNB.toFixed(6)} BNB`);
      console.log(`加仓次数: ${summary.addPositionCount}`);
      console.log(`买入记录: ${summary.purchaseCount} 次`);
    } else {
      console.log(`持仓状态: ❌ 无持仓`);
    }

    console.log('─'.repeat(60));
    console.log(`总交易次数: ${summary.stats.totalTrades}`);
    console.log(`总盈利: $${summary.stats.totalProfit.toFixed(2)}`);
    console.log(`总亏损: $${summary.stats.totalLoss.toFixed(2)}`);
    console.log(`胜率: ${summary.stats.winRate.toFixed(2)}%`);
    console.log(`最大盈利: $${summary.stats.maxProfit.toFixed(2)}`);
    console.log(`最大亏损: $${summary.stats.maxLoss.toFixed(2)}`);
    console.log('='.repeat(60) + '\n');
  }

  /**
   * 获取完整状态
   */
  getState() {
    return this.state;
  }

  /**
   * 清空所有数据
   */
  reset() {
    this.state = {
      hasPosition: false,
      entryPrice: 0,
      averagePrice: 0,
      totalTokens: 0,
      totalInvestedUSD: 0,
      totalInvestedBNB: 0,
      addPositionCount: 0,
      purchases: [],
      sales: [],
      stats: {
        totalTrades: 0,
        totalProfit: 0,
        totalLoss: 0,
        winRate: 0,
        maxProfit: 0,
        maxLoss: 0,
        totalFees: 0
      },
      lastUpdated: null
    };

    this.save();
    console.log('✅ 状态已完全重置');
  }
}

export default MartingaleState;
