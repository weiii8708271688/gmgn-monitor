/**
 * GMGN.ai API 配置
 */

import dotenv from 'dotenv';
import TokenManager from './token-manager.js';

// 加载 .env 文件
dotenv.config();

// 初始化 Token 管理器
const tokenManager = new TokenManager();

export const GMGN_CONFIG = {
  // API 端点
  baseURL: 'https://gmgn.ai',

  // 认证信息 (优先使用 TokenManager，其次使用 .env)
  // 注意：不需要 "Bearer " 前缀！
  auth: {
    get token() {
      // 优先使用 TokenManager 中的 token
      const savedToken = tokenManager.getToken();
      if (savedToken) {
        return savedToken;
      }
      // 其次使用 .env 中的 token
      return process.env.GMGN_AUTH_TOKEN || '';
    },
  },

  // Token 管理器实例
  tokenManager: tokenManager,

  // 钱包地址
  walletAddress: process.env.GMGN_WALLET_ADDRESS || '0xe074e46aaa9d3588bed825881c9185a16f9a8555',

  // 查询参数
  queryParams: {
    device_id: '99aa3a4a-48cb-478f-810e-b76c89ea9900',
    fp_did: '7007dbff0da66412c0e06ee07b82413b',
    client_id: 'gmgn_web_20251108-6872-be2ed8c',
    from_app: 'gmgn',
    app_ver: '20251108-6872-be2ed8c',
    tz_name: 'Asia/Taipei',
    tz_offset: '28800',
    app_lang: 'zh-TW',
    os: 'web',
    worker: '0'
  },

  // 交易默认配置
  tradeDefaults: {
    chain: 'bsc',
    slippage: parseInt(process.env.DEFAULT_SLIPPAGE) || 40, // 4%
    autoSlippage: true,
    isAntiMev: true,
    expiresInterval: (parseInt(process.env.DEFAULT_EXPIRES_DAYS) || 3) * 86400, // 3天转秒
    gasPrice: '120000000', // 120 Gwei
    maxPriorityFeePerGas: '120000000',
    maxFeePerGas: '120000000',
    prioFee: '0.0002',
    fee: '0.0002',
    tipFee: '0.0001',
    priorityFee: '0.0001',
    source: 'limit_web'
  }
};

/**
 * 获取请求头
 */
export function getHeaders() {
  return {
    'authorization': `Bearer ${GMGN_CONFIG.auth.token}`,
    'content-type': 'application/json'
  };
}

/**
 * 获取查询参数
 */
export function getQueryParams() {
  return GMGN_CONFIG.queryParams;
}

export default GMGN_CONFIG;
