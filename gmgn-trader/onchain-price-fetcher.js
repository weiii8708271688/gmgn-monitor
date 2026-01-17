/**
 * 鏈上價格查詢器
 *
 * 直接從 PancakeSwap 流動性池查詢代幣價格和 BNB 價格
 * 優點：
 * - 無 API rate limit
 * - 實時價格，無延遲
 * - 不依賴第三方服務
 */

import { ethers } from 'ethers';

// PancakeSwap Router ABI（用於查詢價格）
const PANCAKESWAP_ROUTER_ABI = [
  'function getAmountsOut(uint amountIn, address[] calldata path) external view returns (uint[] memory amounts)'
];

// ERC20 Token ABI
const ERC20_ABI = [
  'function decimals() external view returns (uint8)',
  'function symbol() external view returns (string)'
];

// Uniswap V2 Pair ABI
const PAIR_ABI = [
  'function token0() view returns (address)',
  'function token1() view returns (address)',
  'function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)'
];

// PancakeSwap V3 Pool ABI
const V3_POOL_ABI = [
  'function token0() external view returns (address)',
  'function token1() external view returns (address)',
  'function slot0() external view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint32 feeProtocol, bool unlocked)',
  'function liquidity() external view returns (uint128)',
  'function fee() external view returns (uint24)'
];

class OnchainPriceFetcher {
  constructor(rpcUrl, routerAddress, wbnbAddress, usdtAddress) {
    this.provider = new ethers.JsonRpcProvider(rpcUrl);
    this.routerAddress = routerAddress;
    this.wbnbAddress = wbnbAddress;
    this.usdtAddress = usdtAddress;

    this.routerContract = new ethers.Contract(
      routerAddress,
      PANCAKESWAP_ROUTER_ABI,
      this.provider
    );

    // PancakeSwap V2 Factory 地址
    this.factoryV2Address = '0xcA143Ce32Fe78f1f7019d7d551a6402fC5350c73';
    this.factoryV2Contract = new ethers.Contract(
      this.factoryV2Address,
      ['function getPair(address tokenA, address tokenB) external view returns (address pair)'],
      this.provider
    );

    // PancakeSwap V3 Factory 地址
    this.factoryV3Address = '0x0BFbCF9fa4f9C56B0F40a671Ad40E0805A091865';
    this.factoryV3Contract = new ethers.Contract(
      this.factoryV3Address,
      ['function getPool(address tokenA, address tokenB, uint24 fee) external view returns (address pool)'],
      this.provider
    );

    // V3 常見的 fee tiers (0.01%, 0.05%, 0.25%, 1%)
    this.v3FeeTiers = [100, 500, 2500, 10000];

    // 常見穩定幣地址（優先順序）
    this.stablecoins = [
      { symbol: 'USDT', address: '0x55d398326f99059fF775485246999027B3197955', decimals: 18 },
      { symbol: 'USDC', address: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d', decimals: 18 },
      { symbol: 'BUSD', address: '0xe9e7CEA3DedcA5984780Bafc599bD69ADd087D56', decimals: 18 },
      { symbol: 'USD1', address: '0x8d0D000Ee44948FC98c9B98A4FA4921476f08B0d', decimals: 18 }
    ];

    // 緩存
    this.bnbPriceCache = null;
    this.bnbPriceTimestamp = 0;
    this.bnbPriceUpdateInterval = 1 * 60 * 1000; // 1分鐘更新一次
    this.poolCache = new Map(); // 緩存已找到的池子
  }

  /**
   * 從幣安 API 獲取 BNB 價格（最準確）
   */
  async getBNBPriceFromBinance() {
    try {
      const response = await fetch('https://api.binance.com/api/v3/ticker/price?symbol=BNBUSDT');
      const data = await response.json();
      return parseFloat(data.price);
    } catch (error) {
      console.error('⚠️  幣安 API 獲取失敗:', error.message);
      return null;
    }
  }

  /**
   * 從鏈上獲取 BNB 價格（備用）
   */
  async getBNBPriceFromChain() {
    try {
      const amountIn = ethers.parseEther('1');
      const path = [this.wbnbAddress, this.usdtAddress];
      const amounts = await this.routerContract.getAmountsOut(amountIn, path);
      return parseFloat(ethers.formatUnits(amounts[1], 18));
    } catch (error) {
      console.error('⚠️  鏈上查詢失敗:', error.message);
      return null;
    }
  }

  /**
   * 獲取 BNB 價格（USD）
   * 優先使用幣安 API，失敗則使用鏈上查詢
   * 每1分鐘更新一次，其他時候使用緩存
   */
  async getBNBPrice() {
    const now = Date.now();

    // 如果緩存有效，直接返回
    if (this.bnbPriceCache && (now - this.bnbPriceTimestamp) < this.bnbPriceUpdateInterval) {
      return this.bnbPriceCache;
    }

    try {
      // 優先使用幣安 API
      let bnbPrice = await this.getBNBPriceFromBinance();

      // 如果幣安 API 失敗，使用鏈上查詢
      if (!bnbPrice) {
        console.log('⚠️  幣安 API 失敗，使用鏈上查詢...');
        bnbPrice = await this.getBNBPriceFromChain();
      }

      if (!bnbPrice) {
        throw new Error('所有價格源都失敗');
      }

      // 更新緩存
      this.bnbPriceCache = bnbPrice;
      this.bnbPriceTimestamp = now;

      console.log(`🔄 BNB 價格已更新: $${bnbPrice.toFixed(2)} (來源: 幣安 API)`);

      return bnbPrice;
    } catch (error) {
      console.error('❌ 獲取 BNB 價格失敗:', error.message);

      // 如果有舊緩存，返回舊緩存
      if (this.bnbPriceCache) {
        console.log('⚠️  使用緩存的 BNB 價格');
        return this.bnbPriceCache;
      }

      throw error;
    }
  }

  /**
   * 直接從指定的 V3 池子地址獲取代幣價格
   * @param {string} poolAddress - V3 流動性池合約地址
   * @param {string} tokenAddress - 要查詢的代幣地址
   * @returns {Promise<Object>} { price, baseToken, baseSymbol }
   */
  async getPriceFromV3Pool(poolAddress, tokenAddress) {
    try {
      const poolContract = new ethers.Contract(poolAddress, V3_POOL_ABI, this.provider);

      // 獲取池子資訊
      const [token0Address, token1Address, slot0] = await Promise.all([
        poolContract.token0(),
        poolContract.token1(),
        poolContract.slot0()
      ]);

      // 確定哪個是目標代幣，哪個是基礎代幣
      const isToken0 = token0Address.toLowerCase() === tokenAddress.toLowerCase();
      const baseTokenAddress = isToken0 ? token1Address : token0Address;

      // 獲取代幣信息
      const [tokenContract, baseContract] = await Promise.all([
        new ethers.Contract(tokenAddress, ERC20_ABI, this.provider),
        new ethers.Contract(baseTokenAddress, ERC20_ABI, this.provider)
      ]);

      const [tokenDecimals, baseDecimals, baseSymbol] = await Promise.all([
        tokenContract.decimals(),
        baseContract.decimals(),
        baseContract.symbol()
      ]);

      // V3 價格計算：price = (sqrtPriceX96 / 2^96)^2
      // sqrtPriceX96 表示 sqrt(token1/token0) * 2^96
      const sqrtPriceX96 = slot0.sqrtPriceX96;
      const Q96 = 2n ** 96n;

      // 計算價格（token1 / token0）
      const price = (Number(sqrtPriceX96) / Number(Q96)) ** 2;

      // 調整 decimals
      const decimalAdjustment = 10 ** (Number(baseDecimals) - Number(tokenDecimals));
      let priceInBase;

      if (isToken0) {
        // 如果查詢的是 token0，價格就是 token1/token0
        priceInBase = price * decimalAdjustment;
      } else {
        // 如果查詢的是 token1，價格是 token0/token1 = 1/price
        priceInBase = (1 / price) * decimalAdjustment;
      }

      console.log(`✅ 從 V3 池子 ${poolAddress} 獲取價格: 1 Token = ${priceInBase.toFixed(8)} ${baseSymbol}`);

      return {
        pairAddress: poolAddress,
        baseToken: baseTokenAddress,
        baseSymbol,
        baseDecimals: Number(baseDecimals),
        priceInBase,
        isV3: true
      };
    } catch (error) {
      throw new Error(`從 V3 池子 ${poolAddress} 獲取價格失敗: ${error.message}`);
    }
  }

  /**
   * 直接從指定的池子地址獲取代幣價格（V2 池子）
   * @param {string} pairAddress - 流動性池合約地址
   * @param {string} tokenAddress - 要查詢的代幣地址
   * @returns {Promise<Object>} { price, baseToken, baseSymbol }
   */
  async getPriceFromPair(pairAddress, tokenAddress) {
    try {
      const pairContract = new ethers.Contract(pairAddress, PAIR_ABI, this.provider);

      // 獲取池子的兩個代幣
      const [token0Address, token1Address, reserves] = await Promise.all([
        pairContract.token0(),
        pairContract.token1(),
        pairContract.getReserves()
      ]);

      // 確定哪個是目標代幣，哪個是基礎代幣
      const isToken0 = token0Address.toLowerCase() === tokenAddress.toLowerCase();
      const baseTokenAddress = isToken0 ? token1Address : token0Address;
      const tokenReserve = isToken0 ? reserves[0] : reserves[1];
      const baseReserve = isToken0 ? reserves[1] : reserves[0];

      // 獲取代幣信息
      const [tokenContract, baseContract] = await Promise.all([
        new ethers.Contract(tokenAddress, ERC20_ABI, this.provider),
        new ethers.Contract(baseTokenAddress, ERC20_ABI, this.provider)
      ]);

      const [tokenDecimals, baseDecimals, baseSymbol] = await Promise.all([
        tokenContract.decimals(),
        baseContract.decimals(),
        baseContract.symbol()
      ]);

      // 計算價格：1 個代幣 = ? 個基礎代幣
      const tokenReserveFloat = parseFloat(ethers.formatUnits(tokenReserve, tokenDecimals));
      const baseReserveFloat = parseFloat(ethers.formatUnits(baseReserve, baseDecimals));
      const priceInBase = baseReserveFloat / tokenReserveFloat;

      console.log(`✅ 從 V2 池子 ${pairAddress} 獲取價格: 1 Token = ${priceInBase.toFixed(8)} ${baseSymbol}`);

      return {
        pairAddress,
        baseToken: baseTokenAddress,
        baseSymbol,
        baseDecimals: Number(baseDecimals),
        priceInBase,
        isV3: false
      };
    } catch (error) {
      throw new Error(`從 V2 池子 ${pairAddress} 獲取價格失敗: ${error.message}`);
    }
  }

  /**
   * 尋找代幣的最佳交易對
   * 優先順序：WBNB > USDT > USDC > BUSD > USD1
   * @param {string} tokenAddress - 代幣合約地址
   * @param {string} customPairAddress - 可選：自定義池子地址，如果提供則直接使用
   * @returns {Promise<Object>} { pairAddress, baseToken, baseSymbol, isV3 } (不包含價格數據)
   */
  async findBestPair(tokenAddress, customPairAddress = null) {
    // 檢查緩存（只緩存池子地址和元數據，不緩存價格）
    if (this.poolCache.has(tokenAddress)) {
      return this.poolCache.get(tokenAddress);
    }

    // 如果提供了自定義池子地址，先嘗試 V2，再嘗試 V3
    if (customPairAddress) {
      // 先嘗試 V2（大部分池子都是 V2）
      try {
        const pairInfo = await this.getPriceFromPair(customPairAddress, tokenAddress);
        // 只緩存池子元數據，不緩存價格
        const cacheInfo = {
          pairAddress: pairInfo.pairAddress,
          baseToken: pairInfo.baseToken,
          baseSymbol: pairInfo.baseSymbol,
          baseDecimals: pairInfo.baseDecimals,
          isV3: false
        };
        this.poolCache.set(tokenAddress, cacheInfo);
        return pairInfo;
      } catch (v2Error) {
        // V2 失敗，嘗試 V3
        try {
          const pairInfo = await this.getPriceFromV3Pool(customPairAddress, tokenAddress);
          // 只緩存池子元數據，不緩存價格
          const cacheInfo = {
            pairAddress: pairInfo.pairAddress,
            baseToken: pairInfo.baseToken,
            baseSymbol: pairInfo.baseSymbol,
            baseDecimals: pairInfo.baseDecimals,
            isV3: true
          };
          this.poolCache.set(tokenAddress, cacheInfo);
          return pairInfo;
        } catch (v3Error) {
          console.log(`⚠️  自定義池子查詢失敗，嘗試自動搜尋...`);
        }
      }
    }

    // 自動搜尋順序：
    // 1. V2 WBNB 池
    // 2. V2 穩定幣池（USDT, USDC, BUSD, USD1）
    // 3. V3 WBNB 池（所有 fee tiers）
    // 4. V3 穩定幣池（所有 fee tiers）

    console.log(`🔍 自動搜尋 ${tokenAddress} 的流動性池...`);

    // ========== 檢查 V2 池子 ==========
    // 先檢查 V2 WBNB 池
    try {
      const bnbPair = await this.factoryV2Contract.getPair(tokenAddress, this.wbnbAddress);
      if (bnbPair !== '0x0000000000000000000000000000000000000000') {
        console.log(`✅ 找到 V2 Token/WBNB 池: ${bnbPair}`);
        const pairInfo = await this.getPriceFromPair(bnbPair, tokenAddress);
        // 只緩存元數據
        const cacheInfo = {
          pairAddress: pairInfo.pairAddress,
          baseToken: pairInfo.baseToken,
          baseSymbol: pairInfo.baseSymbol,
          baseDecimals: pairInfo.baseDecimals,
          isV3: false
        };
        this.poolCache.set(tokenAddress, cacheInfo);
        return pairInfo;
      }
    } catch (error) {
      // 忽略錯誤，繼續搜尋
    }

    // 檢查 V2 穩定幣池
    for (const stablecoin of this.stablecoins) {
      try {
        const pair = await this.factoryV2Contract.getPair(tokenAddress, stablecoin.address);
        if (pair !== '0x0000000000000000000000000000000000000000') {
          console.log(`✅ 找到 V2 Token/${stablecoin.symbol} 池: ${pair}`);
          const pairInfo = await this.getPriceFromPair(pair, tokenAddress);
          // 只緩存元數據
          const cacheInfo = {
            pairAddress: pairInfo.pairAddress,
            baseToken: pairInfo.baseToken,
            baseSymbol: pairInfo.baseSymbol,
            baseDecimals: pairInfo.baseDecimals,
            isV3: false
          };
          this.poolCache.set(tokenAddress, cacheInfo);
          return pairInfo;
        }
      } catch (error) {
        // 忽略錯誤，繼續搜尋
      }
    }

    // ========== 檢查 V3 池子 ==========
    console.log('⚠️  未找到 V2 池子，搜尋 V3 池子...');

    // 檢查 V3 WBNB 池（所有 fee tiers）
    for (const fee of this.v3FeeTiers) {
      try {
        const pool = await this.factoryV3Contract.getPool(tokenAddress, this.wbnbAddress, fee);
        if (pool !== '0x0000000000000000000000000000000000000000') {
          console.log(`✅ 找到 V3 Token/WBNB 池 (fee=${fee/10000}%): ${pool}`);
          const pairInfo = await this.getPriceFromV3Pool(pool, tokenAddress);
          // 只緩存元數據
          const cacheInfo = {
            pairAddress: pairInfo.pairAddress,
            baseToken: pairInfo.baseToken,
            baseSymbol: pairInfo.baseSymbol,
            baseDecimals: pairInfo.baseDecimals,
            isV3: true
          };
          this.poolCache.set(tokenAddress, cacheInfo);
          return pairInfo;
        }
      } catch (error) {
        // 忽略錯誤，繼續搜尋
      }
    }

    // 檢查 V3 穩定幣池（所有 fee tiers）
    for (const stablecoin of this.stablecoins) {
      for (const fee of this.v3FeeTiers) {
        try {
          const pool = await this.factoryV3Contract.getPool(tokenAddress, stablecoin.address, fee);
          if (pool !== '0x0000000000000000000000000000000000000000') {
            console.log(`✅ 找到 V3 Token/${stablecoin.symbol} 池 (fee=${fee/10000}%): ${pool}`);
            const pairInfo = await this.getPriceFromV3Pool(pool, tokenAddress);
            // 只緩存元數據
            const cacheInfo = {
              pairAddress: pairInfo.pairAddress,
              baseToken: pairInfo.baseToken,
              baseSymbol: pairInfo.baseSymbol,
              baseDecimals: pairInfo.baseDecimals,
              isV3: true
            };
            this.poolCache.set(tokenAddress, cacheInfo);
            return pairInfo;
          }
        } catch (error) {
          // 忽略錯誤，繼續搜尋
        }
      }
    }

    throw new Error('找不到任何流動性池（已檢查 V2 和 V3 的 WBNB, USDT, USDC, BUSD, USD1 池）');
  }

  /**
   * 獲取代幣價格（BNB）
   * 自動尋找最佳交易對
   * @param {string} tokenAddress - 代幣合約地址
   * @param {string} customPairAddress - 可選：自定義池子地址
   * @returns {Promise<number>} 以 BNB 計價的價格
   */
  async getTokenPriceInBNB(tokenAddress, customPairAddress = null) {
    try {
      // 尋找最佳交易對（如果提供了自定義池子，會優先使用）
      const pairInfo = await this.findBestPair(tokenAddress, customPairAddress);

      // 如果從緩存讀取，pairInfo 只有元數據，需要重新查詢價格
      if (pairInfo.priceInBase === undefined) {
        // 根據是否為 V3 池子，調用對應的價格查詢方法
        let freshPairInfo;
        if (pairInfo.isV3) {
          freshPairInfo = await this.getPriceFromV3Pool(pairInfo.pairAddress, tokenAddress);
        } else {
          freshPairInfo = await this.getPriceFromPair(pairInfo.pairAddress, tokenAddress);
        }

        const baseAmount = freshPairInfo.priceInBase;

        // 如果 base token 不是 WBNB，需要轉換成 BNB
        if (freshPairInfo.baseSymbol !== 'WBNB') {
          const bnbPrice = await this.getBNBPrice();
          const tokenUSDPrice = baseAmount;
          const tokenBNBPrice = tokenUSDPrice / bnbPrice;
          return tokenBNBPrice;
        }

        return baseAmount;
      }

      // 如果已經從 findBestPair 獲得價格（首次查詢），直接使用
      const baseAmount = pairInfo.priceInBase;

      // 如果 base token 不是 WBNB，需要轉換成 BNB
      if (pairInfo.baseSymbol !== 'WBNB') {
        // 穩定幣 -> BNB
        const bnbPrice = await this.getBNBPrice(); // BNB的USD價格
        const tokenUSDPrice = baseAmount; // 假設穩定幣 = 1 USD
        const tokenBNBPrice = tokenUSDPrice / bnbPrice;
        return tokenBNBPrice;
      }

      return baseAmount;
    } catch (error) {
      console.error('❌ 獲取代幣 BNB 價格失敗:', error.message);
      throw error;
    }
  }

  /**
   * 獲取代幣價格（USD）- 通過 BNB
   * 先查詢 Token/BNB 價格，再乘以 BNB/USD 價格
   * @param {string} tokenAddress - 代幣合約地址
   * @param {string} customPairAddress - 可選：自定義池子地址
   * @returns {Promise<number>} 以 USD 計價的價格
   */
  async getTokenPriceInUSD(tokenAddress, customPairAddress = null) {
    try {
      const [tokenPriceInBNB, bnbPriceInUSD] = await Promise.all([
        this.getTokenPriceInBNB(tokenAddress, customPairAddress),
        this.getBNBPrice()
      ]);

      const tokenPriceInUSD = tokenPriceInBNB * bnbPriceInUSD;

      return tokenPriceInUSD;
    } catch (error) {
      console.error('❌ 獲取代幣 USD 價格失敗:', error.message);
      throw error;
    }
  }

  /**
   * 獲取代幣價格（USD）- 直接通過 USDT 池
   * 直接查詢 Token/USDT 交易對，可能更準確
   * @param {string} tokenAddress - 代幣合約地址
   * @returns {Promise<number>} 以 USD 計價的價格
   */
  async getTokenPriceInUSDDirect(tokenAddress) {
    try {
      // 獲取代幣 decimals
      const tokenContract = new ethers.Contract(tokenAddress, ERC20_ABI, this.provider);
      const decimals = await tokenContract.decimals();

      // 查詢 1 個代幣能換多少 USDT
      const amountIn = ethers.parseUnits('1', decimals);
      const path = [tokenAddress, this.usdtAddress];

      const amounts = await this.routerContract.getAmountsOut(amountIn, path);
      const usdtAmount = parseFloat(ethers.formatUnits(amounts[1], 18)); // USDT 是 18 decimals

      return usdtAmount;
    } catch (error) {
      // 如果沒有 Token/USDT 池，返回 null
      return null;
    }
  }

  /**
   * 獲取代幣最佳價格
   * 同時查詢 Token/BNB/USD 和 Token/USDT，選擇較優的
   * @param {string} tokenAddress - 代幣合約地址
   * @returns {Promise<Object>} 價格和路徑資訊
   */
  async getTokenBestPrice(tokenAddress) {
    try {
      // 同時查詢兩種方式
      const [priceViaBNB, priceDirectUSDT] = await Promise.all([
        this.getTokenPriceInUSD(tokenAddress),
        this.getTokenPriceInUSDDirect(tokenAddress)
      ]);

      // 如果有直接 USDT 池，比較兩者
      if (priceDirectUSDT) {
        const diff = Math.abs(priceViaBNB - priceDirectUSDT);
        const diffPercent = (diff / priceViaBNB) * 100;

        return {
          priceViaBNB,
          priceDirectUSDT,
          difference: diff,
          differencePercent: diffPercent,
          recommended: priceDirectUSDT, // 直接 USDT 池通常更準確
          path: 'Token/USDT'
        };
      } else {
        // 沒有直接 USDT 池，使用 BNB 路徑
        return {
          priceViaBNB,
          priceDirectUSDT: null,
          difference: 0,
          differencePercent: 0,
          recommended: priceViaBNB,
          path: 'Token/BNB/USD'
        };
      }
    } catch (error) {
      console.error('❌ 獲取最佳價格失敗:', error.message);
      throw error;
    }
  }

  /**
   * 獲取詳細價格資訊
   * @param {string} tokenAddress - 代幣合約地址
   * @param {string} customPairAddress - 可選：自定義池子地址
   * @returns {Promise<Object>} 包含 BNB 價格、代幣價格等資訊
   */
  async getTokenPriceDetail(tokenAddress, customPairAddress = null) {
    try {
      const tokenContract = new ethers.Contract(tokenAddress, ERC20_ABI, this.provider);
      const [symbol, tokenPriceInBNB, bnbPriceInUSD] = await Promise.all([
        tokenContract.symbol(),
        this.getTokenPriceInBNB(tokenAddress, customPairAddress),
        this.getBNBPrice()
      ]);

      const tokenPriceInUSD = tokenPriceInBNB * bnbPriceInUSD;

      return {
        success: true,
        data: {
          symbol,
          price: tokenPriceInUSD,
          priceInBNB: tokenPriceInBNB,
          bnbPrice: bnbPriceInUSD,
          timestamp: Date.now(),
          source: 'onchain'
        }
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }
}

export default OnchainPriceFetcher;
