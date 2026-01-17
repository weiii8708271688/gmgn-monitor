/**
 * GMGN交易执行器
 *
 * 使用GMGN限价单模拟市价单交易
 * 原理：设置限价 = 当前价 * (1 ± 滑点%)，使订单立即成交
 */

import GmgnBrowserAPI from './gmgn-browser-api.js';
import MARTINGALE_CONFIG, { getQueryParams } from './gmgn-config.js';

class GmgnTrader {
  constructor(config = null) {
    // 使用传入的配置或默认配置
    this.config = config || MARTINGALE_CONFIG;
    this.api = new GmgnBrowserAPI();
    this.initialized = false;
  }

  /**
   * 初始化交易器
   */
  async init() {
    if (this.initialized) {
      return;
    }

    try {
      await this.api.init();
      this.initialized = true;
      console.log('✅ GMGN交易器初始化成功');
    } catch (error) {
      console.error('❌ GMGN交易器初始化失败:', error.message);
      throw error;
    }
  }

  /**
   * 获取BNB余额
   */
  async getBNBBalance() {
    if (!this.initialized) await this.init();

    const result = await this.api.getBNBBalance(this.config.walletAddress);
    if (result.success) {
      return result.data.balance;
    }
    return 0;
  }

  /**
   * 获取代币余额
   */
  async getTokenBalance() {
    if (!this.initialized) await this.init();

    const result = await this.api.getTokenBalance(
      this.config.tokenAddress,
      this.config.walletAddress
    );
    if (result.success) {
      return result.data.balance;
    }
    return 0;
  }

  /**
   * 获取代币当前价格（USD）
   */
  async getTokenPrice() {
    if (!this.initialized) await this.init();

    const result = await this.api.getTokenPrice(this.config.tokenAddress);
    if (result.success) {
      return result.data.price;
    }
    return 0;
  }

  /**
   * 买入代币（使用限价单模拟市价单）
   * @param {number} bnbAmount - 要花费的BNB数量
   * @param {number} slippage - 滑点容忍度（百分比）
   * @returns {Promise<Object>} 交易结果
   */
  async buyToken(bnbAmount, slippage = null) {
    slippage = slippage ?? this.config.slippage;
    if (!this.initialized) await this.init();

    try {
      console.log(`\n💰 开始买入（GMGN限价单）...`);
      console.log(`   投入BNB: ${bnbAmount}`);

      // 获取当前价格
      const currentPrice = await this.getTokenPrice();
      if (!currentPrice) {
        throw new Error('无法获取当前价格');
      }
      console.log(`   当前价格: $${currentPrice}`);

      // 计算限价（当前价 * (1 + 滑点%)）
      // 买入时，设置更高的限价以确保成交
      const limitPrice = currentPrice * (1 + slippage / 100);
      console.log(`   设置限价: $${limitPrice.toFixed(10)} (${slippage}% 滑点)`);

      // 转换BNB数量为wei
      const amountWei = (bnbAmount * 1e18).toString();

      // 构建订单参数
      const body = {
        from_address: this.config.walletAddress,
        wallet_address: this.config.walletAddress,
        token_in_address: '0x0000000000000000000000000000000000000000', // BNB
        token_out_address: this.config.tokenAddress,
        base_token: this.config.tokenAddress,
        quote_token: '0x0000000000000000000000000000000000000000',
        token_in_amount: amountWei,
        amount_in: amountWei,
        limit_price_usd: limitPrice.toString(),
        check_price: limitPrice.toString(),
        open_price: currentPrice.toString(),
        sub_order_type: 'buy_low',
        chain: 'bsc',
        expires_interval: 259200,
        expire_in: 259200000,
        gas_price: '120000000',
        max_priority_fee_per_gas: '120000000',
        max_fee_per_gas: '120000000',
        slippage: Math.floor(slippage * 10), // GMGN使用10倍值，例如5% = 50
        auto_slippage: true,
        is_anti_mev: true,
        prio_fee: '0.0002',
        fee: '0.0002',
        tip_fee: '0.0001',
        priority_fee: '0.0001',
        approved: true,
        source: 'limit_web'
      };

      // 发送订单
      const params = new URLSearchParams(getQueryParams());
      const endpoint = `https://gmgn.ai/tapi/v1/trading_bot/limit_order/create?${params.toString()}`;

      console.log(`   发送限价单...`);
      const result = await this.api._apiCall('POST', endpoint, body);

      if (result.success && result.data && result.data.data) {
        const orderId = result.data.data.id || result.data.data.strategy_id;
        console.log(`✅ 限价单已创建！`);
        console.log(`   订单ID: ${orderId}`);
        console.log(`   注意：订单会在几秒内成交，请稍后查看余额`);

        // 等待几秒让订单成交
        console.log(`   等待5秒...`);
        await new Promise(resolve => setTimeout(resolve, 5000));

        // 获取实际收到的代币数量
        const tokenBalance = await this.getTokenBalance();

        return {
          success: true,
          orderId: orderId,
          bnbSpent: bnbAmount,
          tokensReceived: tokenBalance,
          limitPrice: limitPrice,
          currentPrice: currentPrice,
          timestamp: Date.now()
        };
      } else {
        throw new Error(result.error || result.data?.message || '订单创建失败');
      }
    } catch (error) {
      console.error('❌ 买入失败:', error.message);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * 卖出代币（使用限价单模拟市价单）
   * @param {number} tokenAmount - 要卖出的代币数量
   * @param {number} slippage - 滑点容忍度（百分比）
   * @returns {Promise<Object>} 交易结果
   */
  async sellToken(tokenAmount, slippage = null) {
    slippage = slippage ?? this.config.slippage;
    if (!this.initialized) await this.init();

    try {
      console.log(`\n💸 开始卖出（GMGN限价单）...`);
      console.log(`   卖出代币数量: ${tokenAmount}`);

      // 获取当前价格
      const currentPrice = await this.getTokenPrice();
      if (!currentPrice) {
        throw new Error('无法获取当前价格');
      }
      console.log(`   当前价格: $${currentPrice}`);

      // 计算限价（当前价 * (1 - 滑点%)）
      // 卖出时，设置更低的限价以确保成交
      const limitPrice = currentPrice * (1 - slippage / 100);
      console.log(`   设置限价: $${limitPrice.toFixed(10)} (${slippage}% 滑点)`);

      // 构建订单参数
      const body = {
        from_address: this.config.walletAddress,
        wallet_address: this.config.walletAddress,
        token_in_address: this.config.tokenAddress,
        token_out_address: '0x0000000000000000000000000000000000000000', // BNB
        base_token: this.config.tokenAddress,
        quote_token: '0x0000000000000000000000000000000000000000',
        token_in_amount: tokenAmount.toString(),
        amount_in: tokenAmount.toString(),
        limit_price_usd: limitPrice.toString(),
        check_price: limitPrice.toString(),
        open_price: currentPrice.toString(),
        sub_order_type: 'take_profit',
        chain: 'bsc',
        expires_interval: 259200,
        expire_in: 259200000,
        gas_price: '120000000',
        max_priority_fee_per_gas: '120000000',
        max_fee_per_gas: '120000000',
        slippage: Math.floor(slippage * 10),
        auto_slippage: true,
        is_anti_mev: true,
        prio_fee: '0.0002',
        fee: '0.0002',
        tip_fee: '0.0001',
        priority_fee: '0.0001',
        approved: true,
        token_in_ratio: '100',
        amount_in_percent: '100',
        source: 'limit_web'
      };

      // 发送订单
      const params = new URLSearchParams(getQueryParams());
      const endpoint = `https://gmgn.ai/tapi/v1/trading_bot/limit_order/create?${params.toString()}`;

      console.log(`   发送限价单...`);
      const result = await this.api._apiCall('POST', endpoint, body);

      if (result.success && result.data && result.data.data) {
        const orderId = result.data.data.id || result.data.data.strategy_id;
        console.log(`✅ 限价单已创建！`);
        console.log(`   订单ID: ${orderId}`);
        console.log(`   注意：订单会在几秒内成交，请稍后查看余额`);

        // 等待几秒让订单成交
        console.log(`   等待5秒...`);
        await new Promise(resolve => setTimeout(resolve, 5000));

        // 获取实际BNB余额
        const bnbBalance = await this.getBNBBalance();

        return {
          success: true,
          orderId: orderId,
          tokensSold: tokenAmount,
          bnbReceived: 0, // GMGN无法准确获取，需要对比前后余额
          limitPrice: limitPrice,
          currentPrice: currentPrice,
          timestamp: Date.now()
        };
      } else {
        throw new Error(result.error || result.data?.message || '订单创建失败');
      }
    } catch (error) {
      console.error('❌ 卖出失败:', error.message);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * 卖出所有代币
   */
  async sellAllTokens(slippage = null) {
    slippage = slippage ?? this.config.slippage;
    const tokenBalance = await this.getTokenBalance();
    if (tokenBalance > 0) {
      return await this.sellToken(tokenBalance, slippage);
    } else {
      return {
        success: false,
        error: '没有代币可以卖出'
      };
    }
  }

  /**
   * 关闭交易器
   */
  async close() {
    if (this.api) {
      await this.api.close();
    }
  }
}

export default GmgnTrader;
