import dotenv from 'dotenv';
dotenv.config();

export default {
  server: {
    port: process.env.PORT || 3000,
  },

  rpc: {
    bsc: process.env.BSC_RPC_URL || 'https://bsc-dataseed1.binance.org',
    solana: process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com',
    base: process.env.BASE_RPC_URL || 'https://mainnet.base.org',
  },

  telegram: {
    botToken: process.env.TELEGRAM_BOT_TOKEN,
    chatId: process.env.TELEGRAM_CHAT_ID,
    // 選擇 Telegram 通知模式: 'bot' (直接使用 Bot API) 或 'webhook' (使用 Flask 服務器)
    mode: process.env.TELEGRAM_MODE || 'bot',
  },

  // Telegram Webhook (Flask 服務器)
  telegramWebhook: {
    serverUrl: process.env.TELEGRAM_WEBHOOK_SERVER_URL, // 例如: http://localhost:8443
    chatId: process.env.TELEGRAM_WEBHOOK_CHAT_ID, // 你的 Chat ID
  },

  line: {
    channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
    channelSecret: process.env.LINE_CHANNEL_SECRET,
  },

  database: {
    path: process.env.DB_PATH || './data/trading.db',
  },

  priceUpdateInterval: parseInt(process.env.PRICE_UPDATE_INTERVAL) || 30000,

  // GMGN 監控設定
  gmgn: {
    // 是否啟用推特 SUB 監控 (監控 cz_binance / heyibinance 的推特)
    enableTwitterMonitor: process.env.GMGN_ENABLE_TWITTER_MONITOR === 'true',
  },

  // DEX Router 地址
  dex: {
    bsc: {
      // PancakeSwap V2 Router
      routerV2: '0x10ED43C718714eb63d5aA57B78B54704E256024E',
      // PancakeSwap V2 Factory
      factoryV2: '0xcA143Ce32Fe78f1f7019d7d551a6402fC5350c73',
      // WBNB
      wbnb: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c',
      // USDT (BSC)
      usdt: '0x55d398326f99059fF775485246999027B3197955',
      // BUSD (backup if USDT pair doesn't exist)
      busd: '0xe9e7CEA3DedcA5984780Bafc599bD69ADd087D56',
    },
    solana: {
      // USDC on Solana
      usdc: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
      // Wrapped SOL
      wsol: 'So11111111111111111111111111111111111111112',
    },
    base: {
      // Uniswap V4 on Base (主網地址)
      stateView: '0x86e8631a016f9068c3f085faf484ee3f5fdee8f2', // Uniswap V4 StateView
      poolManager: '0x7Da1D65F8B249183667cdE74C5CBD46dD38AA829', // Uniswap V4 PoolManager
      // WETH on Base
      weth: '0x4200000000000000000000000000000000000006',
      // USDC on Base
      usdc: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
      // 向後兼容：保留 V3 地址（如有需要）
      quoterV2: '0x3d4e44Eb1374240CE5F1B871ab261CD16335B76a', // Uniswap V3 Quoter V2
      factory: '0x33128a8fC17869897dcE68Ed026d694621f6FDfD', // Uniswap V3 Factory
    },
  },

  // Raydium 配置
  raydium: {
    // Raydium AMM Program ID
    ammProgramId: '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8',
  },
};
