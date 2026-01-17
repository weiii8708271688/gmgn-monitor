/**
 * PancakeSwap交易执行器
 *
 * 使用ethers.js直接调用PancakeSwap合约进行市价交易
 */

import { ethers } from 'ethers';
import MARTINGALE_CONFIG from './martingale-config.js';

// PancakeSwap Router ABI（仅包含需要的函数）
const PANCAKESWAP_ROUTER_ABI = [
  'function swapExactETHForTokens(uint amountOutMin, address[] calldata path, address to, uint deadline) external payable returns (uint[] memory amounts)',
  'function swapExactTokensForETH(uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline) external returns (uint[] memory amounts)',
  'function getAmountsOut(uint amountIn, address[] calldata path) external view returns (uint[] memory amounts)'
];

// ERC20 Token ABI（仅包含需要的函数）
const ERC20_ABI = [
  'function approve(address spender, uint256 amount) external returns (bool)',
  'function allowance(address owner, address spender) external view returns (uint256)',
  'function balanceOf(address account) external view returns (uint256)',
  'function decimals() external view returns (uint8)'
];

class PancakeSwapTrader {
  constructor(config = null) {
    // 使用传入的配置或默认配置
    this.config = config || MARTINGALE_CONFIG;
    this.provider = null;
    this.wallet = null;
    this.routerContract = null;
    this.tokenContract = null;
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
      // 连接到BSC网络
      this.provider = new ethers.JsonRpcProvider(this.config.pancakeswap.rpcUrl);

      // 创建钱包
      if (!this.config.privateKey) {
        throw new Error('未设置私钥，请在.env中设置BSC_PRIVATE_KEY');
      }
      this.wallet = new ethers.Wallet(this.config.privateKey, this.provider);

      // 创建Router合约实例
      this.routerContract = new ethers.Contract(
        this.config.pancakeswap.routerAddress,
        PANCAKESWAP_ROUTER_ABI,
        this.wallet
      );

      // 创建Token合约实例
      this.tokenContract = new ethers.Contract(
        this.config.tokenAddress,
        ERC20_ABI,
        this.wallet
      );

      this.initialized = true;
      console.log('✅ PancakeSwap交易器初始化成功');
      console.log(`   钱包地址: ${this.wallet.address}`);
    } catch (error) {
      console.error('❌ PancakeSwap交易器初始化失败:', error.message);
      throw error;
    }
  }

  /**
   * 获取BNB余额
   */
  async getBNBBalance() {
    if (!this.initialized) await this.init();

    try {
      const balance = await this.provider.getBalance(this.wallet.address);
      return parseFloat(ethers.formatEther(balance));
    } catch (error) {
      console.error('获取BNB余额失败:', error.message);
      return 0;
    }
  }

  /**
   * 获取代币余额
   */
  async getTokenBalance() {
    if (!this.initialized) await this.init();

    try {
      const balance = await this.tokenContract.balanceOf(this.wallet.address);
      const decimals = Number(await this.tokenContract.decimals());
      return parseFloat(ethers.formatUnits(balance, decimals));
    } catch (error) {
      console.error('获取代币余额失败:', error.message);
      return 0;
    }
  }

  /**
   * 获取预估输出数量
   * @param {number} bnbAmount - BNB数量
   * @returns {Promise<number>} 预估可以得到的代币数量
   */
  async getEstimatedTokenAmount(bnbAmount) {
    if (!this.initialized) await this.init();

    try {
      // 限制小數位數避免精度溢出
      const bnbAmountFixed = bnbAmount.toFixed(18);
      const amountIn = ethers.parseEther(bnbAmountFixed);
      const path = [this.config.pancakeswap.wbnbAddress, this.config.tokenAddress];

      const amounts = await this.routerContract.getAmountsOut(amountIn, path);
      const decimals = Number(await this.tokenContract.decimals());

      return parseFloat(ethers.formatUnits(amounts[1], decimals));
    } catch (error) {
      console.error('获取预估输出失败:', error.message);
      return 0;
    }
  }

  /**
   * 获取预估输出BNB数量
   * @param {number} tokenAmount - 代币数量
   * @returns {Promise<number>} 预估可以得到的BNB数量
   */
  async getEstimatedBNBAmount(tokenAmount) {
    if (!this.initialized) await this.init();

    try {
      const decimals = Number(await this.tokenContract.decimals());
      // 限制小數位數避免精度溢出
      const tokenAmountFixed = tokenAmount.toFixed(decimals > 18 ? 18 : decimals);
      const amountIn = ethers.parseUnits(tokenAmountFixed, decimals);
      const path = [this.config.tokenAddress, this.config.pancakeswap.wbnbAddress];

      const amounts = await this.routerContract.getAmountsOut(amountIn, path);
      return parseFloat(ethers.formatEther(amounts[1]));
    } catch (error) {
      console.error('获取预估BNB输出失败:', error.message);
      return 0;
    }
  }

  /**
   * 买入代币（使用BNB）
   * @param {number} bnbAmount - 要花费的BNB数量
   * @param {number} slippage - 滑点容忍度（百分比）
   * @returns {Promise<Object>} 交易结果
   */
  async buyToken(bnbAmount, slippage = null) {
    slippage = slippage ?? this.config.slippage;
    if (!this.initialized) await this.init();

    try {
      console.log(`\n💰 开始买入...`);
      console.log(`   投入BNB: ${bnbAmount}`);

      // 检查BNB余额
      const bnbBalance = await this.getBNBBalance();
      if (bnbBalance < bnbAmount) {
        throw new Error(`BNB余额不足: ${bnbBalance} < ${bnbAmount}`);
      }

      // 记录交易前的代币余额
      const balanceBefore = await this.getTokenBalance();
      console.log(`   交易前余额: ${balanceBefore.toFixed(2)} tokens`);

      // 获取预估输出
      const estimatedTokens = await this.getEstimatedTokenAmount(bnbAmount);
      console.log(`   预估得到代币: ${estimatedTokens.toFixed(2)}`);

      // 计算最小输出（考虑滑点）
      const minTokens = estimatedTokens * (1 - slippage / 100);
      const decimals = Number(await this.tokenContract.decimals());
      // 限制小數位數，避免精度溢出
      const minTokensFixed = minTokens.toFixed(decimals > 18 ? 18 : decimals);
      const amountOutMin = ethers.parseUnits(minTokensFixed, decimals);

      // 构建交易路径
      const path = [this.config.pancakeswap.wbnbAddress, this.config.tokenAddress];

      // 设置截止时间（当前时间+20分钟）
      const deadline = Math.floor(Date.now() / 1000) + 1200;

      // 准备交易参数
      // 限制 BNB 數量的小數位數為 18 位
      const bnbAmountFixed = bnbAmount.toFixed(18);
      const amountIn = ethers.parseEther(bnbAmountFixed);
      const gasPrice = ethers.parseUnits(this.config.gasPrice.toString(), 'gwei');

      // 执行交易
      console.log(`   发送交易...`);
      const tx = await this.routerContract.swapExactETHForTokens(
        amountOutMin,
        path,
        this.wallet.address,
        deadline,
        {
          value: amountIn,
          gasLimit: this.config.gasLimit,
          gasPrice: gasPrice
        }
      );

      console.log(`   交易已发送，hash: ${tx.hash}`);
      console.log(`   ⏳ 等待交易确认...`);

      // 等待交易确认
      const receipt = await tx.wait();
      console.log(`   ✅ 交易已确认！区块: ${receipt.blockNumber}`);

      // 查询交易后的实际余额
      const balanceAfter = await this.getTokenBalance();
      const actualTokensReceived = balanceAfter - balanceBefore;

      console.log(`   交易后余额: ${balanceAfter.toFixed(2)} tokens`);
      console.log(`   实际获得: ${actualTokensReceived.toFixed(2)} tokens`);
      console.log(`   预估获得: ${estimatedTokens.toFixed(2)} tokens`);

      const difference = Math.abs(actualTokensReceived - estimatedTokens);
      const diffPercent = (difference / estimatedTokens) * 100;
      if (diffPercent > 1) {
        console.log(`   ⚠️  差异: ${difference.toFixed(2)} tokens (${diffPercent.toFixed(2)}%)`);
      }

      console.log(`   🔗 查看交易: https://bscscan.com/tx/${tx.hash}`);

      return {
        success: true,
        txHash: tx.hash,
        bnbSpent: bnbAmount,
        tokensReceived: actualTokensReceived,
        estimatedTokens: estimatedTokens,
        gasUsed: receipt.gasUsed.toString(),
        timestamp: Date.now()
      };
    } catch (error) {
      console.error('❌ 买入失败:', error.message);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * 卖出代币（换成BNB）
   * @param {number} tokenAmount - 要卖出的代币数量
   * @param {number} slippage - 滑点容忍度（百分比）
   * @returns {Promise<Object>} 交易结果
   */
  async sellToken(tokenAmount, slippage = null) {
    slippage = slippage ?? this.config.slippage;
    if (!this.initialized) await this.init();

    try {
      console.log(`\n💸 开始卖出...`);
      console.log(`   卖出代币数量: ${tokenAmount}`);

      // 检查代币余额
      const tokenBalance = await this.getTokenBalance();
      if (tokenBalance < tokenAmount) {
        throw new Error(`代币余额不足: ${tokenBalance} < ${tokenAmount}`);
      }

      // 记录交易前的BNB余额
      const bnbBalanceBefore = await this.getBNBBalance();
      console.log(`   交易前BNB余额: ${bnbBalanceBefore.toFixed(6)} BNB`);

      // 获取预估BNB输出
      const estimatedBNB = await this.getEstimatedBNBAmount(tokenAmount);
      console.log(`   预估得到BNB: ${estimatedBNB.toFixed(6)}`);

      // 检查并授权
      const decimals = Number(await this.tokenContract.decimals());
      // 限制小數位數，避免精度溢出
      const tokenAmountFixed = tokenAmount.toFixed(decimals > 18 ? 18 : decimals);
      const amountIn = ethers.parseUnits(tokenAmountFixed, decimals);

      const allowance = await this.tokenContract.allowance(
        this.wallet.address,
        this.config.pancakeswap.routerAddress
      );

      if (allowance < amountIn) {
        console.log(`   授权Router使用代币...`);
        const approveTx = await this.tokenContract.approve(
          this.config.pancakeswap.routerAddress,
          ethers.MaxUint256
        );
        await approveTx.wait();
        console.log(`   授权成功`);
      }

      // 计算最小输出（考虑滑点）
      const minBNB = estimatedBNB * (1 - slippage / 100);
      // 限制小數位數為 18 位（BNB 的最大精度）
      const minBNBFixed = minBNB.toFixed(18);
      const amountOutMin = ethers.parseEther(minBNBFixed);

      // 构建交易路径
      const path = [this.config.tokenAddress, this.config.pancakeswap.wbnbAddress];

      // 设置截止时间
      const deadline = Math.floor(Date.now() / 1000) + 1200;

      // 执行交易
      console.log(`   发送交易...`);
      const gasPrice = ethers.parseUnits(this.config.gasPrice.toString(), 'gwei');

      const tx = await this.routerContract.swapExactTokensForETH(
        amountIn,
        amountOutMin,
        path,
        this.wallet.address,
        deadline,
        {
          gasLimit: this.config.gasLimit,
          gasPrice: gasPrice
        }
      );

      console.log(`   交易已发送，hash: ${tx.hash}`);
      console.log(`   ⏳ 等待交易确认...`);

      // 等待交易确认
      const receipt = await tx.wait();
      console.log(`   ✅ 交易已确认！区块: ${receipt.blockNumber}`);

      // 查询交易后的实际BNB余额（扣除gas费）
      const bnbBalanceAfter = await this.getBNBBalance();
      const bnbDiff = bnbBalanceAfter - bnbBalanceBefore;

      // 计算实际收到的BNB（余额差 + gas费）
      const gasUsedBNB = parseFloat(ethers.formatEther(receipt.gasUsed * receipt.gasPrice));
      const actualBNBReceived = bnbDiff + gasUsedBNB;

      console.log(`   交易后BNB余额: ${bnbBalanceAfter.toFixed(6)} BNB`);
      console.log(`   Gas费用: ${gasUsedBNB.toFixed(6)} BNB`);
      console.log(`   实际获得: ${actualBNBReceived.toFixed(6)} BNB`);
      console.log(`   预估获得: ${estimatedBNB.toFixed(6)} BNB`);

      const difference = Math.abs(actualBNBReceived - estimatedBNB);
      const diffPercent = (difference / estimatedBNB) * 100;
      if (diffPercent > 1) {
        console.log(`   ⚠️  差异: ${difference.toFixed(6)} BNB (${diffPercent.toFixed(2)}%)`);
      }

      console.log(`   🔗 查看交易: https://bscscan.com/tx/${tx.hash}`);

      return {
        success: true,
        txHash: tx.hash,
        tokensSold: tokenAmount,
        bnbReceived: actualBNBReceived,
        estimatedBNB: estimatedBNB,
        gasUsed: receipt.gasUsed.toString(),
        timestamp: Date.now()
      };
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
}

export default PancakeSwapTrader;
