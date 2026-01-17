/**
 * 马丁格尔策略配置文件
 *
 * 策略说明：
 * 1. 首次开仓投入baseAmount美金
 * 2. 每次下跌dropPercentage%时加仓，加仓金额为上次的multiplier倍
 * 3. 最多加仓maxAddPositions次（不包括开仓）
 * 4. 每次加仓后重新计算均价
 * 5. 达到均价+takeProfitPercentage%时全部卖出，重新开仓
 */

import dotenv from 'dotenv';
dotenv.config();

export const MARTINGALE_CONFIG = {
  // ==================== 基础配置 ====================

  // 代币地址（BSC链）
  tokenAddress: '0x08352620afa34ad8c82492661481d7ab62634444',

  // 钱包地址（从.env读取）
  walletAddress: process.env.GMGN_WALLET_ADDRESS || '0xe074e46aaa9d3588bed825881c9185a16f9a8555',

  // 钱包私钥（仅PancakeSwap交易需要）
  privateKey: process.env.BSC_PRIVATE_KEY || '',

  // 价格数据来源
  // 'gmgn' - 使用 GMGN API（可能有延迟）
  // 'onchain' - 使用链上流动性池查询（实时，推荐）
  priceSource: 'onchain',

  // ==================== 策略参数 ====================

  // 每次投入金额（美金）
  baseAmount: 10,

  // BNB价格（美金）- 僅在 priceSource='gmgn' 時使用
  // 注意：如果 priceSource='onchain'，會每5分鐘自動從鏈上更新BNB價格，此值會被忽略
  bnbPrice: 980,

  // 加仓倍数（每次加仓是上次的几倍）
  multiplier: 2,

  // 下跌多少百分比加仓（例如：20 表示下跌20%）
  dropPercentage: 20,

  // 最多加仓几次（不包括开仓，例如：3 表示总共4次买入）
  maxAddPositions: 3,

  // 止盈百分比（相对于均价，例如：20 表示均价+20%）
  takeProfitPercentage: 10,

  // ==================== 交易设置 ====================

  // 交易方式选择
  // 'pancakeswap' - 使用PancakeSwap直接交易（真正的市价单，速度快）
  // 'gmgn' - 使用GMGN限价单模拟市价单（会有延迟）
  tradeMethod: 'pancakeswap',

  // 滑点容忍度（百分比，例如：5 表示5%）
  slippage: 40,

  // Gas价格（Gwei）- 仅PancakeSwap交易需要
  gasPrice: 2,

  // Gas限制 - 仅PancakeSwap交易需要
  gasLimit: 500000,

  // GMGN订单过期时间（秒，3天 = 259200）
  gmgnOrderExpiry: 259200,

  // ==================== PancakeSwap配置 ====================

  pancakeswap: {
    // PancakeSwap Router地址（BSC主网）
    routerAddress: '0x10ED43C718714eb63d5aA57B78B54704E256024E',

    // WBNB地址（BSC主网）
    wbnbAddress: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c',

    // USDT地址（BSC主网，用於查詢BNB價格）
    usdtAddress: '0x55d398326f99059fF775485246999027B3197955',

    // BSC RPC URL
    rpcUrl: process.env.BSC_RPC_URL || 'https://bsc-dataseed1.binance.org',
  },

  // ==================== 监控设置 ====================

  // 价格检查间隔（毫秒）
  priceCheckInterval: 3000, // 1秒检查一次

  // 是否启用自动交易（false时仅监控和记录，不实际交易）
  autoTrade: true,

  // 是否启用日志
  enableLogging: true,

  // ==================== 高级设置 ====================

  // 最小BNB余额（低于此值将停止交易）
  minBnbBalance: 0.01,

  // 最小代币交易数量
  minTokenAmount: 1000,
};

/**
 * 计算配置摘要（用于日志）
 */
export function getConfigSummary() {
  const config = MARTINGALE_CONFIG;

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

/**
 * 验证配置
 */
export function validateConfig() {
  const config = MARTINGALE_CONFIG;
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

export default MARTINGALE_CONFIG;
