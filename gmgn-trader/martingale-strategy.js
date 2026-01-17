/**
 * 马丁格尔策略核心逻辑
 *
 * 策略流程：
 * 1. 监控价格
 * 2. 判断是否需要开仓/加仓/止盈
 * 3. 执行交易
 * 4. 更新状态
 * 5. 循环
 */

import GmgnBrowserAPI from './gmgn-browser-api.js';
import PancakeSwapTrader from './pancakeswap-trader.js';
import GmgnTrader from './gmgn-trader.js';
import MartingaleState from './martingale-state.js';
import OnchainPriceFetcher from './onchain-price-fetcher.js';
import MARTINGALE_CONFIG, { getConfigSummary, validateConfig } from './martingale-config.js';

class MartingaleStrategy {
  constructor(config = null, stateFilePath = null, isFinalBreakeven = false, startCondition = null) {
    // 使用傳入的配置或默認配置
    this.config = config || MARTINGALE_CONFIG;

    // 使用自定義狀態文件路徑
    this.state = new MartingaleState(stateFilePath);
    this.trader = null;
    this.priceAPI = null;
    this.onchainPriceFetcher = null;
    this.isRunning = false;
    this.priceCheckTimer = null;

    // 交易狀態追蹤
    this.pendingTxHash = null; // 當前待確認的交易hash
    this.lastTxTimestamp = 0;   // 上次交易的時間戳
    this.txCooldown = 3000;     // 交易冷卻時間（3秒）

    // 最終回本標記
    this.isFinalBreakeven = isFinalBreakeven;

    // 開始條件
    this.startCondition = startCondition || { type: 'immediate' };
    this.isWaitingForStart = this.startCondition.type !== 'immediate';
    this.trackingHighPrice = this.startCondition.highPrice || 0;
  }

  /**
   * 初始化策略
   */
  async init() {
    console.log('\n' + '='.repeat(70));
    console.log('🚀 马丁格尔策略初始化');
    console.log('='.repeat(70));

    // 验证配置（使用当前实例的配置）
    const validation = this._validateConfig();
    if (!validation.valid) {
      console.error('❌ 配置验证失败:');
      validation.errors.forEach(err => console.error(`   - ${err}`));
      throw new Error('配置无效');
    }

    // 打印配置摘要（使用当前实例的配置）
    const summary = this._getConfigSummary();
    console.log('\n📋 策略配置:');
    console.log(`   代币地址: ${summary.tokenAddress}`);
    console.log(`   基础投入: $${summary.baseAmount}`);
    console.log(`   加仓倍数: ${summary.multiplier}x`);
    console.log(`   最大仓位数: ${summary.maxPositions}`);
    console.log(`   总投入（满仓）: $${summary.totalInvestmentUSD}`);
    console.log(`   加仓触发: ${summary.addPositionTriggers}`);
    console.log(`   止盈百分比: +${summary.takeProfitPercent}%`);
    console.log(`   交易方式: ${summary.tradeMethod.toUpperCase()}`);
    console.log(`   价格来源: ${summary.priceSource.toUpperCase()}`);
    console.log(`   滑点: ${summary.slippage}%`);
    console.log(`   自动交易: ${summary.autoTrade ? '✅ 已启用' : '❌ 未启用（仅监控）'}`);

    // 初始化交易器（传入配置）
    if (this.config.tradeMethod === 'pancakeswap') {
      this.trader = new PancakeSwapTrader(this.config);
    } else {
      this.trader = new GmgnTrader(this.config);
    }
    await this.trader.init();

    // 初始化价格查询
    if (this.config.priceSource === 'onchain') {
      this.onchainPriceFetcher = new OnchainPriceFetcher(
        this.config.pancakeswap.rpcUrl,
        this.config.pancakeswap.routerAddress,
        this.config.pancakeswap.wbnbAddress,
        this.config.pancakeswap.usdtAddress
      );
      console.log('✅ 使用链上价格查询（PancakeSwap流动性池）');
    } else {
      this.priceAPI = new GmgnBrowserAPI();
      await this.priceAPI.init();
      console.log('✅ 使用GMGN API价格查询');
    }

    // 打印当前状态
    this.state.printStatus();

    console.log('✅ 策略初始化完成\n');
  }

  /**
   * 获取当前价格（USD）
   */
  async getCurrentPrice() {
    if (this.config.priceSource === 'onchain') {
      // 使用链上查询
      try {
        const price = await this.onchainPriceFetcher.getTokenPriceInUSD(
          this.config.tokenAddress,
          this.config.customPoolAddress || null
        );
        return price;
      } catch (error) {
        console.error('链上价格查询失败:', error.message);
        return null;
      }
    } else {
      // 使用GMGN API
      const result = await this.priceAPI.getTokenPrice(this.config.tokenAddress);
      if (result.success) {
        return result.data.price;
      }
      return null;
    }
  }

  /**
   * 檢查是否可以執行交易
   * 防止在待確認期間重複送交易
   */
  canExecuteTrade() {
    const now = Date.now();

    // 如果有待確認的交易，且在冷卻期內，不允許新交易
    if (this.pendingTxHash && (now - this.lastTxTimestamp) < this.txCooldown) {
      const remainingTime = Math.ceil((this.txCooldown - (now - this.lastTxTimestamp)) / 1000);
      console.log(`⏳ 交易冷卻中... 剩餘 ${remainingTime} 秒（待確認交易: ${this.pendingTxHash.slice(0, 10)}...）`);
      return false;
    }

    // 冷卻期已過，清除待確認狀態
    if (this.pendingTxHash && (now - this.lastTxTimestamp) >= this.txCooldown) {
      console.log(`✅ 交易冷卻結束，可以執行新交易`);
      this.pendingTxHash = null;
    }

    return true;
  }

  /**
   * 記錄交易已送出
   */
  recordTxSent(txHash) {
    this.pendingTxHash = txHash;
    this.lastTxTimestamp = Date.now();
  }

  /**
   * 获取当前 BNB 价格
   */
  async getCurrentBNBPrice() {
    if (this.config.priceSource === 'onchain') {
      // 使用链上查询（每5分钟更新一次，有缓存）
      return await this.onchainPriceFetcher.getBNBPrice();
    } else {
      // 使用配置中的固定价格
      return this.config.bnbPrice;
    }
  }

  /**
   * 计算下一次加仓需要的BNB数量
   */
  async calculateNextPositionBNB() {
    const stateData = this.state.getState();
    const bnbPrice = await this.getCurrentBNBPrice();

    if (!stateData.hasPosition) {
      // 首次开仓
      return this.config.baseAmount / bnbPrice;
    } else {
      // 根據加倉次數計算應該投入的 USD
      // 第 1 次加倉 = baseAmount * multiplier^1
      // 第 2 次加倉 = baseAmount * multiplier^2
      const usdAmount = this.config.baseAmount * Math.pow(this.config.multiplier, stateData.addPositionCount + 1);

      // 轉換成 BNB
      return usdAmount / bnbPrice;
    }
  }

  /**
   * 判断是否应该开仓
   */
  shouldEntry() {
    return !this.state.getState().hasPosition;
  }

  /**
   * 判断是否应该加仓
   * @param {number} currentPrice - 当前价格
   */
  shouldAddPosition(currentPrice) {
    const stateData = this.state.getState();

    if (!stateData.hasPosition) {
      return false; // 没有持仓，不能加仓
    }

    if (stateData.addPositionCount >= this.config.maxAddPositions) {
      return false; // 已达最大加仓次数
    }

    // 计算当前价格相对于开仓价的跌幅
    const dropPercent = ((stateData.entryPrice - currentPrice) / stateData.entryPrice) * 100;

    // 计算应该在什么价格加仓
    const nextAddTrigger = this.config.dropPercentage * (stateData.addPositionCount + 1);

    return dropPercent >= nextAddTrigger;
  }

  /**
   * 判断是否应该止盈
   * @param {number} currentPrice - 当前价格
   */
  shouldTakeProfit(currentPrice) {
    const stateData = this.state.getState();

    if (!stateData.hasPosition) {
      return false; // 没有持仓，不能止盈
    }

    // 计算当前价格相对于均价的涨幅
    const profitPercent = ((currentPrice - stateData.averagePrice) / stateData.averagePrice) * 100;

    return profitPercent >= this.config.takeProfitPercentage;
  }

  /**
   * 判断是否应该回本卖出（加倉後回到均價）
   * @param {number} currentPrice - 当前价格
   */
  shouldBreakEven(currentPrice) {
    const stateData = this.state.getState();

    if (!stateData.hasPosition) {
      return false;
    }

    // 只有加倉後才需要回本
    if (stateData.addPositionCount === 0) {
      return false;
    }

    // 檢查是否達到或超過均價（只要價格 >= 均價就觸發）
    // 這樣即使價格跳漲，也能確保執行回本賣出
    return currentPrice >= stateData.averagePrice;
  }

  /**
   * 执行开仓
   * @param {number} currentPrice - 当前价格
   */
  async executeEntry(currentPrice) {
    console.log('\n' + '🎯 执行开仓'.padEnd(70, '='));

    // 檢查是否可以執行交易
    if (!this.canExecuteTrade()) {
      return false;
    }

    const bnbPrice = await this.getCurrentBNBPrice();
    const bnbAmount = this.config.baseAmount / bnbPrice;
    const usdAmount = this.config.baseAmount;

    console.log(`   当前价格: $${currentPrice}`);
    console.log(`   BNB价格: $${bnbPrice.toFixed(2)}`);
    console.log(`   投入BNB: ${bnbAmount.toFixed(6)}`);
    console.log(`   投入USD: $${usdAmount}`);

    if (!this.config.autoTrade) {
      console.log('⚠️  自动交易未启用，跳过实际交易');
      return false;
    }

    // 执行买入
    const result = await this.trader.buyToken(bnbAmount, this.config.slippage);

    if (result.success) {
      // 記錄交易已送出
      this.recordTxSent(result.txHash);

      // 记录到状态
      this.state.recordPurchase({
        priceUSD: currentPrice,
        bnbAmount: bnbAmount,
        usdAmount: usdAmount,
        tokensReceived: result.tokensReceived,
        txHash: result.txHash
      });

      console.log('✅ 开仓成功');
      return true;
    } else {
      console.error('❌ 开仓失败:', result.error);
      return false;
    }
  }

  /**
   * 执行加仓
   * @param {number} currentPrice - 当前价格
   */
  async executeAddPosition(currentPrice) {
    const stateData = this.state.getState();

    console.log('\n' + `📈 执行加仓 (第${stateData.addPositionCount + 1}次)`.padEnd(70, '='));

    // 檢查是否可以執行交易
    if (!this.canExecuteTrade()) {
      return false;
    }

    const bnbPrice = await this.getCurrentBNBPrice();
    const bnbAmount = await this.calculateNextPositionBNB();
    const usdAmount = bnbAmount * bnbPrice;

    console.log(`   当前价格: $${currentPrice}`);
    console.log(`   开仓价格: $${stateData.entryPrice}`);
    console.log(`   下跌幅度: ${(((stateData.entryPrice - currentPrice) / stateData.entryPrice) * 100).toFixed(2)}%`);
    console.log(`   BNB价格: $${bnbPrice.toFixed(2)}`);
    console.log(`   投入BNB: ${bnbAmount.toFixed(6)}`);
    console.log(`   投入USD: $${usdAmount.toFixed(2)}`);

    if (!this.config.autoTrade) {
      console.log('⚠️  自动交易未启用，跳过实际交易');
      return false;
    }

    // 执行买入
    const result = await this.trader.buyToken(bnbAmount, this.config.slippage);

    if (result.success) {
      // 記錄交易已送出
      this.recordTxSent(result.txHash);

      // 记录到状态
      this.state.recordPurchase({
        priceUSD: currentPrice,
        bnbAmount: bnbAmount,
        usdAmount: usdAmount,
        tokensReceived: result.tokensReceived,
        txHash: result.txHash
      });

      console.log('✅ 加仓成功');
      return true;
    } else {
      console.error('❌ 加仓失败:', result.error);
      return false;
    }
  }

  /**
   * 执行回本卖出（加倉後回到均價）
   * @param {number} currentPrice - 当前价格
   */
  async executeBreakEven(currentPrice) {
    const stateData = this.state.getState();

    console.log('\n' + '💵 执行回本卖出'.padEnd(70, '='));

    // 檢查是否可以執行交易
    if (!this.canExecuteTrade()) {
      return false;
    }

    const bnbPrice = await this.getCurrentBNBPrice();
    const totalTokens = stateData.totalTokens;
    const totalValue = totalTokens * currentPrice;

    // 檢查是否需要全部賣出並關閉策略
    // 條件1: 價格低於 $0.00003
    // 條件2: 已經是最後一次加倉
    // 條件3: 啟動時設定了 --final-breakeven 參數
    const isLastAddPosition = stateData.addPositionCount >= this.config.maxAddPositions;
    const isPriceTooLow = currentPrice < 0.00003;
    const shouldSellAll = isPriceTooLow || isLastAddPosition || this.isFinalBreakeven;

    if (shouldSellAll) {
      console.log('⚠️  觸發全部賣出條件:');
      if (isPriceTooLow) {
        console.log(`   - 價格過低: $${currentPrice} < $0.00003`);
      }
      if (isLastAddPosition) {
        console.log(`   - 已達最大加倉次數: ${stateData.addPositionCount}/${this.config.maxAddPositions}`);
      }
      if (this.isFinalBreakeven) {
        console.log(`   - 設定為最後一次回本 (--final-breakeven)`);
      }
      console.log('   🛑 將全部賣出並關閉策略...');

      const sellTokensAmount = totalTokens;
      console.log(`   当前价格: $${currentPrice}`);
      console.log(`   卖出数量: ${sellTokensAmount.toFixed(2)} tokens (全部)`);
      console.log(`   预估收回: $${(sellTokensAmount * currentPrice).toFixed(2)}`);

      if (!this.config.autoTrade) {
        console.log('⚠️  自动交易未启用，跳过实际交易');
        return false;
      }

      // 执行全部卖出
      const result = await this.trader.sellToken(sellTokensAmount, this.config.slippage);

      if (result.success) {
        this.recordTxSent(result.txHash);

        const bnbReceived = result.bnbReceived || 0;
        const usdReceived = bnbReceived * bnbPrice;

        // 清空持倉
        this.state.resetPosition();

        console.log('✅ 全部卖出成功');
        console.log(`   卖出: ${sellTokensAmount.toFixed(2)} tokens`);
        console.log(`   收到: $${usdReceived.toFixed(2)}`);
        console.log('🛑 策略即將關閉...');

        // 關閉策略
        await this.stop();
        return true;
      } else {
        console.error('❌ 卖出失败:', result.error);
        return false;
      }
    }

    // 正常回本賣出（保留 baseAmount）
    const sellValue = stateData.totalInvestedUSD - this.config.baseAmount;
    const sellPercent = (sellValue / totalValue) * 100;
    const sellTokensAmount = totalTokens * (sellPercent / 100);
    const keepTokensAmount = totalTokens - sellTokensAmount;
    const keepValue = keepTokensAmount * currentPrice;

    console.log(`   当前价格: $${currentPrice}`);
    console.log(`   均价: $${stateData.averagePrice}`);
    console.log(`   总持仓: ${totalTokens.toFixed(2)} tokens ($${totalValue.toFixed(2)})`);
    console.log(`   总投入: $${stateData.totalInvestedUSD.toFixed(2)}`);
    console.log(`   加仓次数: ${stateData.addPositionCount}`);
    console.log(`   卖出百分比: ${sellPercent.toFixed(2)}%`);
    console.log(`   卖出数量: ${sellTokensAmount.toFixed(2)} tokens`);
    console.log(`   预估收回: $${(sellTokensAmount * currentPrice).toFixed(2)}`);
    console.log(`   保留: ${keepTokensAmount.toFixed(2)} tokens ($${keepValue.toFixed(2)})`);

    if (!this.config.autoTrade) {
      console.log('⚠️  自动交易未启用，跳过实际交易');
      return false;
    }

    // 执行卖出
    const result = await this.trader.sellToken(sellTokensAmount, this.config.slippage);

    if (result.success) {
      // 記錄交易已送出
      this.recordTxSent(result.txHash);

      const bnbReceived = result.bnbReceived || 0;
      const usdReceived = bnbReceived * bnbPrice;

      // 重置持倉狀態為 baseAmount
      this.state.recordBreakEven({
        priceUSD: currentPrice,
        tokenAmount: sellTokensAmount,
        bnbReceived: bnbReceived,
        usdReceived: usdReceived,
        txHash: result.txHash,
        keepTokens: keepTokensAmount,
        keepValue: this.config.baseAmount
      });

      console.log('✅ 回本成功');
      console.log(`   卖出: ${sellTokensAmount.toFixed(2)} tokens`);
      console.log(`   收到: $${usdReceived.toFixed(2)}`);
      console.log(`   保留: ${keepTokensAmount.toFixed(2)} tokens ($${this.config.baseAmount})`);
      console.log('🔄 重置為 baseAmount，加倉點位重新計算...');
      return true;
    } else {
      console.error('❌ 回本失敗:', result.error);
      return false;
    }
  }

  /**
   * 执行止盈
   * @param {number} currentPrice - 当前价格
   */
  async executeTakeProfit(currentPrice) {
    const stateData = this.state.getState();

    console.log('\n' + '💰 执行止盈'.padEnd(70, '='));

    // 檢查是否可以執行交易
    if (!this.canExecuteTrade()) {
      return false;
    }

    const bnbPrice = await this.getCurrentBNBPrice();
    const totalTokens = stateData.totalTokens;
    const totalValue = totalTokens * currentPrice;

    // 計算止盈應該賣出的百分比
    // 盈利金額 = 總價值 * 止盈百分比
    // 賣出百分比 = 盈利金額 / (總價值 + 盈利金額)
    const profitPercent = this.config.takeProfitPercentage / 100;
    const profitValue = stateData.totalInvestedUSD * profitPercent;
    const sellPercent = (profitValue / totalValue) * 100;
    const sellTokensAmount = totalTokens * (sellPercent / 100);
    const keepTokensAmount = totalTokens - sellTokensAmount;
    const sellValue = sellTokensAmount * currentPrice;
    const keepValue = keepTokensAmount * currentPrice;

    console.log(`   当前价格: $${currentPrice}`);
    console.log(`   均价: $${stateData.averagePrice}`);
    console.log(`   总持仓: ${totalTokens.toFixed(2)} tokens ($${totalValue.toFixed(2)})`);
    console.log(`   总投入: $${stateData.totalInvestedUSD.toFixed(2)}`);
    console.log(`   目标盈利: $${profitValue.toFixed(2)} (${this.config.takeProfitPercentage}%)`);
    console.log(`   卖出百分比: ${sellPercent.toFixed(2)}%`);
    console.log(`   卖出数量: ${sellTokensAmount.toFixed(2)} tokens`);
    console.log(`   预估收回: $${sellValue.toFixed(2)}`);
    console.log(`   保留: ${keepTokensAmount.toFixed(2)} tokens ($${keepValue.toFixed(2)})`);

    if (!this.config.autoTrade) {
      console.log('⚠️  自动交易未启用，跳过实际交易');
      return false;
    }

    // 执行卖出
    const result = await this.trader.sellToken(sellTokensAmount, this.config.slippage);

    if (result.success) {
      // 記錄交易已送出
      this.recordTxSent(result.txHash);

      const bnbReceived = result.bnbReceived || 0;
      const usdReceived = bnbReceived * bnbPrice;

      // 记录部分卖出
      this.state.recordPartialSale({
        priceUSD: currentPrice,
        tokenAmount: sellTokensAmount,
        bnbReceived: bnbReceived,
        usdReceived: usdReceived,
        txHash: result.txHash,
        keepTokens: keepTokensAmount,
        keepValue: this.config.baseAmount
      });

      console.log('✅ 止盈成功');
      console.log(`   卖出: ${sellTokensAmount.toFixed(2)} tokens (${sellPercent.toFixed(2)}%)`);
      console.log(`   收到: $${usdReceived.toFixed(2)}`);
      console.log(`   保留: ${keepTokensAmount.toFixed(2)} tokens ($${keepValue.toFixed(2)})`);

      // 檢查是否達到最大止盈次數
      const currentStats = this.state.getState().stats;
      const takeProfitCount = currentStats.totalTrades || 0;
      const sellAllTokensAmount = currentStats.totalTokens || 0;

      if (this.config.maxTakeProfitCount > 0 && takeProfitCount >= this.config.maxTakeProfitCount) {
        console.log('\n⚠️  已達最大止盈次數限制:');
        console.log(`   止盈次數: ${takeProfitCount}/${this.config.maxTakeProfitCount}`);
        console.log('   🛑 將關閉策略...');
        // 要賣出剩下的所有代幣
        console.log(`   卖出剩余: ${sellAllTokensAmount.toFixed(2)} tokens (全部)`);

        // 執行全部賣出
        const finalSellResult = await this.trader.sellToken(sellAllTokensAmount, this.config.slippage);

        if (finalSellResult.success) {
          this.recordTxSent(finalSellResult.txHash);

          const finalBnbReceived = finalSellResult.bnbReceived || 0;
          const finalUsdReceived = finalBnbReceived * bnbPrice;

          // 清空持倉
          this.state.resetPosition();

          console.log('✅ 全部卖出成功');
          console.log(`   卖出: ${sellAllTokensAmount.toFixed(2)} tokens`);
          console.log(`   收到: $${finalUsdReceived.toFixed(2)}`);
        } else {
          console.error('❌ 最终卖出失败:', finalSellResult.error);
        }
        // 關閉策略
        await this.stop();
        return true;
      }

      console.log('🔄 保留持仓继续运行...');
      return true;
    } else {
      console.error('❌ 止盈失败:', result.error);
      return false;
    }
  }

  /**
   * 检查开始条件是否满足
   * @param {number} currentPrice - 当前价格
   * @returns {boolean} - 是否满足开始条件
   */
  checkStartCondition(currentPrice) {
    if (!this.isWaitingForStart) {
      return true;
    }

    const condition = this.startCondition;

    switch (condition.type) {
      case 'below_price':
        // 低於指定價格開始
        if (currentPrice <= condition.targetPrice) {
          console.log(`\n🎉 開始條件達成！價格 $${currentPrice} <= $${condition.targetPrice}`);
          this.isWaitingForStart = false;
          return true;
        }
        console.log(`   ⏳ 等待價格低於 $${condition.targetPrice}...`);
        return false;

      case 'drop_from_high':
        // 更新最高點追蹤
        if (currentPrice > this.trackingHighPrice) {
          console.log(`   📈 新高點: $${currentPrice} (原: $${this.trackingHighPrice})`);
          this.trackingHighPrice = currentPrice;
          // 重新計算觸發價格
          this.startCondition.triggerPrice = this.trackingHighPrice * (1 - condition.dropPercent / 100);
          console.log(`   🎯 新觸發價格: $${this.startCondition.triggerPrice.toFixed(8)}`);
        }

        // 檢查是否達到回落條件
        if (currentPrice <= this.startCondition.triggerPrice) {
          const actualDrop = ((this.trackingHighPrice - currentPrice) / this.trackingHighPrice) * 100;
          console.log(`\n🎉 開始條件達成！從高點 $${this.trackingHighPrice} 回落 ${actualDrop.toFixed(2)}%`);
          console.log(`   當前價格: $${currentPrice} <= 觸發價格: $${this.startCondition.triggerPrice.toFixed(8)}`);
          this.isWaitingForStart = false;
          return true;
        }

        const currentDrop = ((this.trackingHighPrice - currentPrice) / this.trackingHighPrice) * 100;
        console.log(`   ⏳ 等待從高點 $${this.trackingHighPrice} 回落 ${condition.dropPercent}%...`);
        console.log(`      當前回落: ${currentDrop.toFixed(2)}%，觸發價格: $${this.startCondition.triggerPrice.toFixed(8)}`);
        return false;

      default:
        return true;
    }
  }

  /**
   * 价格检查循环
   */
  async checkPrice() {
    try {
      const currentPrice = await this.getCurrentPrice();

      if (!currentPrice) {
        console.error('❌ 无法获取价格');
        return;
      }

      const now = new Date().toLocaleString('zh-TW');
      console.log(`[${now}] 💲 当前价格: $${currentPrice}`);

      // 檢查開始條件
      if (!this.checkStartCondition(currentPrice)) {
        return; // 還沒達到開始條件，繼續等待
      }

      // 判断操作（优先级顺序）
      if (this.shouldEntry()) {
        console.log('   ➡️  无持仓，准备开仓...');
        await this.executeEntry(currentPrice);
      } else if (this.shouldBreakEven(currentPrice)) {
        const stateData = this.state.getState();
        console.log(`   🔄 已回到均价！准备卖出加仓部分，保留 baseAmount...`);
        await this.executeBreakEven(currentPrice);
      } else if (this.shouldTakeProfit(currentPrice)) {
        const stateData = this.state.getState();
        const profitPercent = ((currentPrice - stateData.averagePrice) / stateData.averagePrice) * 100;
        console.log(`   ✅ 达到止盈条件！(+${profitPercent.toFixed(2)}%)`);
        await this.executeTakeProfit(currentPrice);
      } else if (this.shouldAddPosition(currentPrice)) {
        const stateData = this.state.getState();
        const dropPercent = ((stateData.entryPrice - currentPrice) / stateData.entryPrice) * 100;
        console.log(`   ⬇️  价格下跌 ${dropPercent.toFixed(2)}%，准备加仓...`);
        await this.executeAddPosition(currentPrice);
      } else {
        const stateData = this.state.getState();
        if (stateData.hasPosition) {
          const changeFromAvg = ((currentPrice - stateData.averagePrice) / stateData.averagePrice) * 100;
          const changeFromEntry = ((currentPrice - stateData.entryPrice) / stateData.entryPrice) * 100;
          console.log(`   ⏳ 持仓中`);
          console.log(`      相对开仓价 ($${stateData.entryPrice.toFixed(8)}): ${changeFromEntry >= 0 ? '+' : ''}${changeFromEntry.toFixed(2)}%`);
          console.log(`      相对均价 ($${stateData.averagePrice.toFixed(8)}): ${changeFromAvg >= 0 ? '+' : ''}${changeFromAvg.toFixed(2)}%`);
        }
      }
    } catch (error) {
      console.error('❌ 价格检查出错:', error.message);
    }
  }

  /**
   * 启动策略
   */
  async start() {
    if (this.isRunning) {
      console.log('⚠️  策略已在运行中');
      return;
    }

    console.log('\n' + '='.repeat(70));
    console.log('▶️  启动马丁格尔策略');
    console.log('='.repeat(70));
    console.log(`价格检查间隔: ${this.config.priceCheckInterval / 1000}秒`);

    // 顯示開始條件資訊
    if (this.isWaitingForStart) {
      console.log('\n📌 開始條件:');
      switch (this.startCondition.type) {
        case 'below_price':
          console.log(`   類型: 低於指定價格`);
          console.log(`   目標價格: $${this.startCondition.targetPrice}`);
          break;
        case 'drop_from_high':
          console.log(`   類型: 從最高點回落`);
          console.log(`   初始最高點: $${this.trackingHighPrice}`);
          console.log(`   回落百分比: ${this.startCondition.dropPercent}%`);
          console.log(`   當前觸發價格: $${this.startCondition.triggerPrice.toFixed(8)}`);
          console.log(`   📈 會持續追蹤更高價格`);
          break;
      }
      console.log('\n⏳ 等待開始條件達成...');
    }

    console.log('');
    this.isRunning = true;

    console.log('✅ 策略已启动，按 Ctrl+C 停止\n');

    // 使用同步循環：每次交易完成後才進行下一次價格檢查
    while (this.isRunning) {
      try {
        // 執行價格檢查（會等待交易完成）
        await this.checkPrice();
      } catch (error) {
        console.error('❌ 價格檢查出錯:', error.message);
      }

      // 等待指定間隔後再進行下一次檢查
      if (this.isRunning) {
        await new Promise(resolve => setTimeout(resolve, this.config.priceCheckInterval));
      }
    }

    console.log('✅ 策略循環已結束');
  }

  /**
   * 停止策略
   */
  async stop() {
    if (!this.isRunning) {
      return;
    }

    console.log('\n⏸️  停止策略...');

    this.isRunning = false;

    // 打印最终状态
    this.state.printStatus();

    console.log('✅ 策略已停止');
  }

  /**
   * 清理资源
   */
  async cleanup() {
    await this.stop();

    if (this.priceAPI && this.priceAPI.close) {
      await this.priceAPI.close();
    }

    if (this.trader && this.trader.close) {
      await this.trader.close();
    }
  }

  /**
   * 验证配置（使用实例的config）
   */
  _validateConfig() {
    const config = this.config;
    const errors = [];

    if (!config.tokenAddress || config.tokenAddress.length !== 42) {
      errors.push('无效的代币地址');
    }

    if (config.baseAmount <= 0) {
      errors.push('baseAmount必须大于0');
    }

    if (config.bnbPrice <= 0) {
      errors.push('bnbPrice必须大于0');
    }

    if (config.multiplier < 1) {
      errors.push('multiplier必须大于1');
    }

    if (config.dropPercentage <= 0 || config.dropPercentage >= 100) {
      errors.push('dropPercentage必须在0-100之间');
    }

    if (config.maxAddPositions < 0) {
      errors.push('maxAddPositions必须大于等于0');
    }

    if (config.takeProfitPercentage <= 0) {
      errors.push('takeProfitPercentage必须大于0');
    }

    if (!['pancakeswap', 'gmgn'].includes(config.tradeMethod)) {
      errors.push('tradeMethod必须是pancakeswap或gmgn');
    }

    if (config.tradeMethod === 'pancakeswap' && !config.privateKey) {
      errors.push('使用PancakeSwap交易需要设置BSC_PRIVATE_KEY环境变量');
    }

    if (config.slippage < 0 || config.slippage > 100) {
      errors.push('slippage必须在0-100之间');
    }

    if (!['gmgn', 'onchain'].includes(config.priceSource)) {
      errors.push('priceSource必须是gmgn或onchain');
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }

  /**
   * 获取配置摘要（使用实例的config）
   */
  _getConfigSummary() {
    const config = this.config;

    // 计算所有加仓的总投入
    let totalInvestment = config.baseAmount;
    let currentAmount = config.baseAmount;

    for (let i = 0; i < config.maxAddPositions; i++) {
      currentAmount *= config.multiplier;
      totalInvestment += currentAmount;
    }

    // 计算加仓触发价格（相对于开仓价的百分比）
    const triggers = [];
    for (let i = 1; i <= config.maxAddPositions; i++) {
      triggers.push(`-${config.dropPercentage * i}%`);
    }

    return {
      tokenAddress: config.tokenAddress,
      baseAmount: config.baseAmount,
      maxPositions: config.maxAddPositions + 1,
      totalInvestmentUSD: totalInvestment,
      multiplier: config.multiplier,
      addPositionTriggers: triggers.join(', '),
      takeProfitPercent: config.takeProfitPercentage,
      tradeMethod: config.tradeMethod,
      priceSource: config.priceSource,
      slippage: config.slippage,
      autoTrade: config.autoTrade
    };
  }
}

export default MartingaleStrategy;
