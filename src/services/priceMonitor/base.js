import { ethers } from 'ethers';
import config from '../../config/config.js';
import logger from '../../utils/logger.js';

// Uniswap V4 StateView ABI
const STATE_VIEW_ABI = [
  'function getSlot0(bytes32 poolId) external view returns (uint160 sqrtPriceX96, int24 tick, uint24 protocolFee, uint24 lpFee)',
  'function getLiquidity(bytes32 poolId) external view returns (uint128 liquidity)',
];

// Uniswap V3 Quoter V2 ABI
const QUOTER_V2_ABI = [
  'function quoteExactInputSingle((address tokenIn, address tokenOut, uint256 amountIn, uint24 fee, uint160 sqrtPriceLimitX96)) external returns (uint256 amountOut, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate)',
];

// Uniswap V3 Pool ABI
const POOL_V3_ABI = [
  'function slot0() external view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)',
  'function liquidity() external view returns (uint128)',
  'function token0() external view returns (address)',
  'function token1() external view returns (address)',
];

// Uniswap V2 Pair ABI
const PAIR_V2_ABI = [
  'function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)',
  'function token0() external view returns (address)',
  'function token1() external view returns (address)',
];

// Uniswap V2 Factory ABI
const FACTORY_V2_ABI = [
  'function getPair(address tokenA, address tokenB) external view returns (address pair)',
];

// ERC20 ABI
const ERC20_ABI = [
  'function totalSupply() external view returns (uint256)',
  'function decimals() external view returns (uint8)',
  'function symbol() external view returns (string)',
  'function balanceOf(address) external view returns (uint256)',
];

class BasePriceMonitor {
  constructor() {
    this.provider = new ethers.JsonRpcProvider(config.rpc.base);

    // 🔥 使用 Ethereum Mainnet 獲取 ETH 價格（更準確）
    this.mainnetProvider = new ethers.JsonRpcProvider('https://eth.llamarpc.com');

    // Uniswap V4 合約地址
    this.stateViewAddress = config.dex.base.stateView || '0x86e8631a016f9068c3f085faf484ee3f5fdee8f2';
    this.stateView = new ethers.Contract(this.stateViewAddress, STATE_VIEW_ABI, this.provider);

    // Uniswap V3 合約地址
    this.quoterV2Address = config.dex.base.quoterV2 || '0x3d4e44Eb1374240CE5F1B871ab261CD16335B76a';
    this.quoterV2 = new ethers.Contract(this.quoterV2Address, QUOTER_V2_ABI, this.provider);

    // 🔥 Mainnet Uniswap V3 Quoter (用於獲取準確的 ETH 價格)
    this.mainnetQuoterV2 = new ethers.Contract(
      '0x61fFE014bA17989E743c5F6cB21bF9697530B21e',
      QUOTER_V2_ABI,
      this.mainnetProvider
    );

    // Uniswap V2 Factory 地址（Base 上可能用 BaseSwap 或其他 V2 fork）
    this.factoryV2Address = config.dex.base.factoryV2 || '0x8909Dc15e40173Ff4699343b6eB8132c65e18eC6'; // BaseSwap Factory
    this.factoryV2 = new ethers.Contract(this.factoryV2Address, FACTORY_V2_ABI, this.provider);

    this.weth = config.dex.base.weth;
    this.usdc = config.dex.base.usdc;

    // Mainnet addresses
    this.mainnetWeth = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2';
    this.mainnetUsdc = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';

    this.ethPriceCache = { price: null, timestamp: 0 };
    this.cacheDuration = 60000; // 1分鐘緩存

    // V4 配置
    this.v4Configs = [
      { fee: 100, tickSpacing: 1 },
      { fee: 500, tickSpacing: 10 },
      { fee: 3000, tickSpacing: 60 },
      { fee: 10000, tickSpacing: 200 },
    ];

    // V3 Fee tiers
    this.v3Fees = [100, 500, 3000, 10000];

    this.zeroHooks = '0x0000000000000000000000000000000000000000';
  }

  /**
   * 計算 Uniswap V4 Pool ID
   * @param {string} token0 - Token0 地址
   * @param {string} token1 - Token1 地址
   * @param {number} fee - 手續費
   * @param {number} tickSpacing - Tick spacing
   * @param {string} hooks - Hooks 地址
   * @returns {string} Pool ID (bytes32)
   */
  getPoolId(token0, token1, fee, tickSpacing, hooks = this.zeroHooks) {
    // 確保 token0 < token1
    const [sortedToken0, sortedToken1] = token0.toLowerCase() < token1.toLowerCase()
      ? [token0, token1]
      : [token1, token0];

    // 編碼 pool key
    const poolKey = ethers.AbiCoder.defaultAbiCoder().encode(
      ['address', 'address', 'uint24', 'int24', 'address'],
      [sortedToken0, sortedToken1, fee, tickSpacing, hooks]
    );

    // 計算 keccak256 hash 作為 pool ID
    return ethers.keccak256(poolKey);
  }

  /**
   * 從 sqrtPriceX96 計算價格
   * @param {bigint} sqrtPriceX96 - Sqrt price in X96 format
   * @param {number} decimals0 - Token0 decimals
   * @param {number} decimals1 - Token1 decimals
   * @returns {number} Token1/Token0 價格
   */
  sqrtPriceX96ToPrice(sqrtPriceX96, decimals0 = 18, decimals1 = 18) {
    const Q96 = 2n ** 96n;
    const price = (Number(sqrtPriceX96) / Number(Q96)) ** 2;
    const decimalAdjustment = 10 ** (decimals0 - decimals1);
    return price * decimalAdjustment;
  }

  /**
   * 獲取 ETH/USD 價格（使用 Ethereum Mainnet 價格，更準確）
   * @returns {Promise<number>} ETH 的 USD 價格
   */
  async getETHPrice() {
    try {
      // 檢查緩存
      const now = Date.now();
      if (this.ethPriceCache.price && (now - this.ethPriceCache.timestamp) < this.cacheDuration) {
        logger.debug(`使用快取的 ETH 價格: $${this.ethPriceCache.price.toFixed(2)}`);
        return this.ethPriceCache.price;
      }

      let ethPrice = null;

      // 🔥 方法 1: 從 Ethereum Mainnet 獲取價格（最準確）
      logger.debug('從 Ethereum Mainnet 獲取 ETH 價格...');
      try {
        for (const fee of [500, 3000, 100, 10000]) {
          try {
            const params = {
              tokenIn: this.mainnetWeth,
              tokenOut: this.mainnetUsdc,
              amountIn: ethers.parseEther('1'),
              fee: fee,
              sqrtPriceLimitX96: 0,
            };

            const result = await this.mainnetQuoterV2.quoteExactInputSingle.staticCall(params);
            const price = Number(ethers.formatUnits(result[0], 6));

            if (price > 0) {
              ethPrice = price;
              logger.debug(`ETH 價格 (Mainnet V3 fee=${fee/10000}%): $${ethPrice.toFixed(2)}`);
              break;
            }
          } catch (error) {
            continue;
          }
        }
      } catch (mainnetError) {
        logger.warn(`Mainnet 查詢失敗: ${mainnetError.message}，fallback 到 Base 鏈`);
      }

      // 🔥 Fallback 方法 2: 如果 Mainnet 失敗，使用 Base 鏈的 V3
      if (!ethPrice) {
        logger.debug('Mainnet 失敗，使用 Base 鏈價格...');
        try {
          for (const fee of this.v3Fees) {
            try {
              const amountIn = ethers.parseEther('1');
              const params = {
                tokenIn: this.weth,
                tokenOut: this.usdc,
                amountIn: amountIn,
                fee: fee,
                sqrtPriceLimitX96: 0,
              };

              const result = await this.quoterV2.quoteExactInputSingle.staticCall(params);
              const amountOut = result[0];
              const price = Number(ethers.formatUnits(amountOut, 6));

              if (price > 0) {
                ethPrice = price;
                logger.debug(`ETH 價格 (Base V3): $${ethPrice.toFixed(2)}`);
                break;
              }
            } catch (error) {
              continue;
            }
          }
        } catch (v3Error) {
          logger.warn(`Base V3 失敗: ${v3Error.message}`);
        }
      }

      // Fallback 方法 3: 如果 V3 失敗，嘗試 Base V2
      if (!ethPrice) {
        try {
          const pairAddress = await this.factoryV2.getPair(this.weth, this.usdc);
          if (pairAddress !== ethers.ZeroAddress) {
            const pair = new ethers.Contract(pairAddress, PAIR_V2_ABI, this.provider);
            const reserves = await pair.getReserves();
            const token0 = await pair.token0();

            const wethIsToken0 = token0.toLowerCase() === this.weth.toLowerCase();
            const wethReserve = wethIsToken0 ? Number(ethers.formatEther(reserves[0])) : Number(ethers.formatEther(reserves[1]));
            const usdcReserve = wethIsToken0 ? Number(ethers.formatUnits(reserves[1], 6)) : Number(ethers.formatUnits(reserves[0], 6));

            ethPrice = usdcReserve / wethReserve;
            logger.debug(`ETH 價格 (Base V2): $${ethPrice.toFixed(2)}`);
          }
        } catch (v2Error) {
          logger.warn(`Base V2 失敗: ${v2Error.message}`);
        }
      }

      if (!ethPrice) {
        throw new Error('無法從任何來源獲取 ETH 價格');
      }

      // 更新緩存
      this.ethPriceCache = { price: ethPrice, timestamp: now };
      logger.info(`✅ ETH 價格更新: $${ethPrice.toFixed(2)}`);
      return ethPrice;
    } catch (error) {
      logger.error(`獲取 ETH 價格失敗:`, error.message);
      throw error;
    }
  }

  /**
   * 獲取代幣價格（以 ETH 計價）- 自動嘗試 V4 → V3 → V2
   * @param {string} tokenAddress - 代幣地址
   * @param {number} decimals - 代幣精度
   * @returns {Promise<number>} 以 ETH 計價的價格
   */
  async getPrice(tokenAddress, decimals = 18) {
    try {
      if (tokenAddress.toLowerCase() === this.weth.toLowerCase()) {
        return 1;
      }

      let priceInETH = null;

      // 方法 1: 嘗試 Uniswap V4
      for (const config of this.v4Configs) {
        try {
          const poolId = this.getPoolId(tokenAddress, this.weth, config.fee, config.tickSpacing);
          const slot0 = await this.stateView.getSlot0(poolId);
          const sqrtPriceX96 = slot0[0];

          if (sqrtPriceX96 === 0n) continue;

          const tokenIsToken0 = tokenAddress.toLowerCase() < this.weth.toLowerCase();
          priceInETH = tokenIsToken0
            ? this.sqrtPriceX96ToPrice(sqrtPriceX96, decimals, 18)
            : 1 / this.sqrtPriceX96ToPrice(sqrtPriceX96, 18, decimals);

          if (priceInETH > 0) {
            logger.debug(`Base 價格 (V4): ${tokenAddress} = ${priceInETH} ETH`);
            return priceInETH;
          }
        } catch (error) {
          continue;
        }
      }

      // 方法 2: V4 失敗，嘗試 V3
      if (!priceInETH) {
        logger.warn(`V4 未找到池子，嘗試 V3: ${tokenAddress}`);
        for (const fee of this.v3Fees) {
          try {
            const amountIn = ethers.parseUnits('1', decimals);
            const params = {
              tokenIn: tokenAddress,
              tokenOut: this.weth,
              amountIn: amountIn,
              fee: fee,
              sqrtPriceLimitX96: 0,
            };

            const result = await this.quoterV2.quoteExactInputSingle.staticCall(params);
            const amountOut = result[0];
            priceInETH = Number(ethers.formatEther(amountOut));

            if (priceInETH > 0) {
              logger.debug(`Base 價格 (V3): ${tokenAddress} = ${priceInETH} ETH`);
              return priceInETH;
            }
          } catch (error) {
            continue;
          }
        }
      }

      // 方法 3: V3 失敗，嘗試 V2
      if (!priceInETH) {
        logger.warn(`V3 未找到池子，嘗試 V2: ${tokenAddress}`);
        try {
          const pairAddress = await this.factoryV2.getPair(tokenAddress, this.weth);
          if (pairAddress !== ethers.ZeroAddress) {
            const pair = new ethers.Contract(pairAddress, PAIR_V2_ABI, this.provider);
            const reserves = await pair.getReserves();
            const token0 = await pair.token0();

            const tokenIsToken0 = token0.toLowerCase() === tokenAddress.toLowerCase();
            const tokenReserve = tokenIsToken0
              ? Number(ethers.formatUnits(reserves[0], decimals))
              : Number(ethers.formatUnits(reserves[1], decimals));
            const wethReserve = tokenIsToken0
              ? Number(ethers.formatEther(reserves[1]))
              : Number(ethers.formatEther(reserves[0]));

            priceInETH = wethReserve / tokenReserve;
            logger.debug(`Base 價格 (V2): ${tokenAddress} = ${priceInETH} ETH`);
            return priceInETH;
          }
        } catch (v2Error) {
          logger.warn(`V2 失敗: ${v2Error.message}`);
        }
      }

      throw new Error(`未找到 ${tokenAddress} 的任何 Uniswap 池子 (V4/V3/V2)`);
    } catch (error) {
      logger.error(`獲取 Base 價格失敗:`, error.message);
      throw error;
    }
  }

  /**
   * 使用指定配置獲取價格（V4 版本）
   * @param {string} tokenAddress - 代幣地址
   * @param {number} decimals - 代幣精度
   * @param {number} fee - 手續費等級 (100, 500, 3000, 10000)
   * @param {number} tickSpacing - Tick spacing（可選，會根據 fee 自動選擇）
   * @returns {Promise<number>} 價格
   */
  async getPriceWithFee(tokenAddress, decimals = 18, fee = 3000, tickSpacing = null) {
    try {
      // 檢查是否為 WETH
      if (tokenAddress.toLowerCase() === this.weth.toLowerCase()) {
        return 1;
      }

      // 如果沒有提供 tickSpacing，根據 fee 自動選擇
      if (!tickSpacing) {
        const config = this.poolConfigs.find(c => c.fee === fee);
        tickSpacing = config ? config.tickSpacing : 60; // 默認使用 60
      }

      const poolId = this.getPoolId(tokenAddress, this.weth, fee, tickSpacing);
      const slot0 = await this.stateView.getSlot0(poolId);
      const sqrtPriceX96 = slot0[0];

      if (sqrtPriceX96 === 0n) {
        throw new Error(`未找到 fee=${fee} 的池子`);
      }

      const tokenIsToken0 = tokenAddress.toLowerCase() < this.weth.toLowerCase();
      const priceInETH = tokenIsToken0
        ? this.sqrtPriceX96ToPrice(sqrtPriceX96, decimals, 18)
        : 1 / this.sqrtPriceX96ToPrice(sqrtPriceX96, 18, decimals);

      logger.debug(`Base 價格 (V4 fee=${fee/10000}%): ${tokenAddress} = ${priceInETH} ETH`);
      return priceInETH;
    } catch (error) {
      logger.error(`獲取 Base 價格失敗 (fee=${fee}):`, error.message);
      throw error;
    }
  }

  /**
   * 🔥 NEW: 使用已緩存的池子信息快速獲取價格
   * @param {string} tokenAddress - 代幣地址
   * @param {number} decimals - 代幣精度
   * @param {Object} poolInfo - 池子信息 { poolAddress, version, pairToken }
   * @returns {Promise<number>} USD 價格
   */
  async getPriceWithCachedPool(tokenAddress, decimals, poolInfo) {
    try {
      const { poolAddress, version, pairToken } = poolInfo;

      logger.debug(`使用緩存池子獲取價格:`);
      logger.debug(`  池子地址/ID: ${poolAddress}`);
      logger.debug(`  版本: ${version}`);
      logger.debug(`  配對: ${pairToken}`);

      let priceInETH;

      if (version === 'V4') {
        // V4 使用 poolId 直接獲取價格
        const slot0 = await this.stateView.getSlot0(poolAddress);
        const sqrtPriceX96 = slot0[0];

        if (sqrtPriceX96 === 0n) {
          throw new Error('池子無效');
        }

        const tokenIsToken0 = tokenAddress.toLowerCase() < this.weth.toLowerCase();
        priceInETH = tokenIsToken0
          ? this.sqrtPriceX96ToPrice(sqrtPriceX96, decimals, 18)
          : 1 / this.sqrtPriceX96ToPrice(sqrtPriceX96, 18, decimals);
      } else if (version === 'V3') {
        // 🔥 V3: 從 poolAddress 解析 fee，並使用 Factory 查找實際池子地址
        logger.debug(`解析 V3 池子配置: ${poolAddress}`);

        // poolAddress 格式: "V3-fee10000" -> fee = 10000
        const fee = parseInt(poolAddress.replace('V3-fee', ''));

        if (isNaN(fee)) {
          throw new Error(`無效的 V3 池子格式: ${poolAddress}`);
        }

        logger.debug(`V3 fee: ${fee} (${fee/10000}%)`);

        // 🔥 方法 1: 使用 Factory 查找實際池子地址，然後直接讀取 slot0
        try {
          const FACTORY_V3_ABI = [
            'function getPool(address tokenA, address tokenB, uint24 fee) external view returns (address pool)',
          ];
          const factoryV3 = new ethers.Contract(
            '0x33128a8fC17869897dcE68Ed026d694621f6FDfD', // Uniswap V3 Factory on Base
            FACTORY_V3_ABI,
            this.provider
          );

          const poolAddr = await factoryV3.getPool(tokenAddress, this.weth, fee);

          if (poolAddr === ethers.ZeroAddress) {
            throw new Error(`V3 池子不存在 (fee=${fee})`);
          }

          logger.debug(`V3 池子地址: ${poolAddr}`);

          // 直接讀取池子的 slot0
          const pool = new ethers.Contract(poolAddr, POOL_V3_ABI, this.provider);
          const slot0 = await pool.slot0();
          const sqrtPriceX96 = slot0[0];
          const token0 = await pool.token0();

          if (sqrtPriceX96 === 0n) {
            throw new Error('池子無效 (sqrtPrice = 0)');
          }

          // 計算價格
          const Q96 = 2n ** 96n;
          const price = (Number(sqrtPriceX96) / Number(Q96)) ** 2;

          const tokenIsToken0 = token0.toLowerCase() === tokenAddress.toLowerCase();
          priceInETH = tokenIsToken0
            ? price * (10 ** (18 - decimals))
            : (1 / price) * (10 ** (decimals - 18));

          logger.debug(`V3 價格計算: token0=${token0.slice(0,8)}, tokenIsToken0=${tokenIsToken0}, priceInETH=${priceInETH}`);
        } catch (directError) {
          logger.warn(`V3 直接讀取失敗: ${directError.message}，嘗試 Quoter`);

          // 🔥 Fallback: 使用 Quoter（可能在某些 RPC 上不工作）
          try {
            const amountIn = ethers.parseUnits('1', decimals);
            const params = {
              tokenIn: tokenAddress,
              tokenOut: this.weth,
              amountIn: amountIn,
              fee: fee,
              sqrtPriceLimitX96: 0,
            };

            const result = await this.quoterV2.quoteExactInputSingle.staticCall(params);
            priceInETH = Number(ethers.formatEther(result[0]));
          } catch (quoterError) {
            logger.error(`Quoter 也失敗: ${quoterError.message}`);
            throw directError; // 拋出第一個錯誤
          }
        }
      } else if (version === 'V2') {
        // V2 使用 pair 地址
        const pair = new ethers.Contract(poolAddress, PAIR_V2_ABI, this.provider);
        const reserves = await pair.getReserves();
        const token0 = await pair.token0();

        const tokenIsToken0 = token0.toLowerCase() === tokenAddress.toLowerCase();
        const tokenReserve = tokenIsToken0
          ? Number(ethers.formatUnits(reserves[0], decimals))
          : Number(ethers.formatUnits(reserves[1], decimals));
        const wethReserve = tokenIsToken0
          ? Number(ethers.formatEther(reserves[1]))
          : Number(ethers.formatEther(reserves[0]));

        priceInETH = wethReserve / tokenReserve;
      } else {
        throw new Error(`不支援的版本: ${version}`);
      }

      const ethPrice = await this.getETHPrice();
      const priceInUSD = priceInETH * ethPrice;

      logger.info(`✅ 快速價格查詢 (緩存池子 ${version}): $${priceInUSD.toFixed(8)}`);
      return priceInUSD;
    } catch (error) {
      logger.error(`使用緩存池子獲取價格失敗: ${error.message}`);
      throw error;
    }
  }

  /**
   * 獲取代幣 USD 價格 - 使用 V4 自動查找最佳池子
   * @param {string} tokenAddress - 代幣地址
   * @param {number} decimals - 代幣精度
   * @param {Object} cachedPoolInfo - 已緩存的池子信息（可選）
   * @returns {Promise<number>} USD 價格
   */
  async getPriceInUSD(tokenAddress, decimals = 18, cachedPoolInfo = null) {
    try {
      if (tokenAddress.toLowerCase() === this.weth.toLowerCase()) {
        return await this.getETHPrice();
      }

      // 🔥 優先使用緩存的池子信息（最快）
      if (cachedPoolInfo && cachedPoolInfo.poolAddress) {
        return await this.getPriceWithCachedPool(tokenAddress, decimals, cachedPoolInfo);
      }

      const priceInETH = await this.getPrice(tokenAddress, decimals);
      const ethPrice = await this.getETHPrice();
      const priceInUSD = priceInETH * ethPrice;

      logger.debug(`Base USD 價格 (自動查找): ${tokenAddress} = $${priceInUSD}`);
      return priceInUSD;
    } catch (error) {
      logger.error(`獲取 Base USD 價格失敗:`, error.message);
      throw error;
    }
  }

  /**
   * 使用指定配置獲取 USD 價格
   */
  async getPriceInUSDWithFee(tokenAddress, decimals = 18, fee = 3000, tickSpacing = null) {
    try {
      if (tokenAddress.toLowerCase() === this.weth.toLowerCase()) {
        return await this.getETHPrice();
      }

      const priceInETH = await this.getPriceWithFee(tokenAddress, decimals, fee, tickSpacing);
      const ethPrice = await this.getETHPrice();
      const priceInUSD = priceInETH * ethPrice;

      logger.debug(`Base USD 價格 (V4 fee=${fee/10000}%): ${tokenAddress} = $${priceInUSD}`);
      return priceInUSD;
    } catch (error) {
      logger.error(`獲取 Base USD 價格失敗 (fee=${fee}):`, error.message);
      throw error;
    }
  }

  /**
   * 獲取代幣市值 - 使用 V4 自動查找最佳池子
   * @param {string} tokenAddress - 代幣合約地址
   * @param {number} decimals - 代幣精度
   * @returns {Promise<Object>} { priceUSD, marketCap, marketCapFormatted, totalSupply }
   */
  async getTokenInfo(tokenAddress, decimals = 18) {
    try {
      const priceUSD = await this.getPriceInUSD(tokenAddress, decimals);
      const tokenContract = new ethers.Contract(tokenAddress, ERC20_ABI, this.provider);
      const totalSupply = await tokenContract.totalSupply();
      const totalSupplyFormatted = Number(ethers.formatUnits(totalSupply, decimals));
      const marketCap = priceUSD * totalSupplyFormatted;

      let marketCapFormatted;
      if (marketCap >= 1_000_000) {
        marketCapFormatted = `$${(marketCap / 1_000_000).toFixed(2)}M`;
      } else if (marketCap >= 1_000) {
        marketCapFormatted = `$${(marketCap / 1_000).toFixed(2)}K`;
      } else {
        marketCapFormatted = `$${marketCap.toFixed(2)}`;
      }

      logger.info(`Base 代幣信息 (Uniswap V4): ${tokenAddress}`);
      logger.info(`  價格: $${priceUSD.toFixed(8)}`);
      logger.info(`  市值: ${marketCapFormatted}`);

      return { priceUSD, marketCap, marketCapFormatted, totalSupply: totalSupplyFormatted };
    } catch (error) {
      logger.error(`獲取 Base 代幣信息失敗:`, error.message);
      throw error;
    }
  }

  /**
   * 使用指定配置獲取代幣市值
   */
  async getTokenInfoWithFee(tokenAddress, decimals = 18, fee = 3000, tickSpacing = null) {
    try {
      const priceUSD = await this.getPriceInUSDWithFee(tokenAddress, decimals, fee, tickSpacing);
      const tokenContract = new ethers.Contract(tokenAddress, ERC20_ABI, this.provider);
      const totalSupply = await tokenContract.totalSupply();
      const totalSupplyFormatted = Number(ethers.formatUnits(totalSupply, decimals));
      const marketCap = priceUSD * totalSupplyFormatted;

      let marketCapFormatted;
      if (marketCap >= 1_000_000) {
        marketCapFormatted = `$${(marketCap / 1_000_000).toFixed(2)}M`;
      } else if (marketCap >= 1_000) {
        marketCapFormatted = `$${(marketCap / 1_000).toFixed(2)}K`;
      } else {
        marketCapFormatted = `$${marketCap.toFixed(2)}`;
      }

      logger.info(`Base 代幣信息 (V4 fee=${fee/10000}%): ${tokenAddress}`);
      logger.info(`  價格: $${priceUSD.toFixed(8)}, 市值: ${marketCapFormatted}`);

      return { priceUSD, marketCap, marketCapFormatted, totalSupply: totalSupplyFormatted };
    } catch (error) {
      logger.error(`獲取 Base 代幣信息失敗:`, error.message);
      throw error;
    }
  }

  // 向後兼容方法
  async getTokenInfoWithPair(pairAddress, tokenAddress, decimals = 18) {
    logger.warn('Uniswap V4 不使用 pairAddress，將自動查找最佳池子配置');
    return await this.getTokenInfo(tokenAddress, decimals);
  }

  async getPriceInUSDWithPair(pairAddress, tokenAddress, decimals = 18) {
    logger.warn('Uniswap V4 不使用 pairAddress，將自動查找最佳池子配置');
    return await this.getPriceInUSD(tokenAddress, decimals);
  }
}

export default BasePriceMonitor;
