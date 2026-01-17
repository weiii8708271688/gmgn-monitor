import { Connection, PublicKey } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { LIQUIDITY_STATE_LAYOUT_V4, MARKET_STATE_LAYOUT_V3, Token, SPL_ACCOUNT_LAYOUT, struct, publicKey, u64, u8 } from '@raydium-io/raydium-sdk';
import { blob, u16 } from '@solana/buffer-layout';
import config from '../../config/config.js';
import logger from '../../utils/logger.js';

class SolanaPriceMonitor {
  constructor() {
    this.connection = new Connection(config.rpc.solana, 'confirmed');
    this.wsol = new PublicKey(config.dex.solana.wsol);
    this.usdc = new PublicKey(config.dex.solana.usdc);
    this.solPriceCache = { price: null, timestamp: 0 };
    this.cacheDuration = 60000; // 1分鐘緩存 SOL 價格

    // 支援的 DEX 類型
    this.supportedDexes = ['raydium', 'jupiter'];

    // 🔥 Raydium 主要池子地址（SOL/USDC）
    // 來源: https://raydium.io/pools/
    this.raydiumSOLUSDCPool = new PublicKey('58oQChx4yWmvKdwLLZzBi4ChoCc2fqCUWBkwMihLYQo2');

    // Raydium Program IDs
    this.raydiumAMMProgramId = new PublicKey('675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8'); // AMM V4
    this.raydiumCPMMProgramId = new PublicKey('CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C'); // CPMM (CP-Swap)
  }

  /**
   * 使用 Raydium API 獲取池子信息（推薦方法）
   * @param {string} mint1 - Token mint 地址
   * @param {string} mint2 - Token mint 地址（可選）
   * @returns {Promise<Array>} 池子列表
   */
  async getRaydiumPoolsByMints(mint1, mint2 = null) {
    try {
      const baseUrl = 'https://api-v3.raydium.io';
      let url = `${baseUrl}/pools/info/mint?mint1=${mint1}`;
      if (mint2) {
        url += `&mint2=${mint2}`;
      }

      const response = await fetch(url);
      const data = await response.json();

      if (!data.success || !data.data) {
        throw new Error('Raydium API 返回失敗');
      }

      return data.data;
    } catch (error) {
      logger.error(`從 Raydium API 獲取池子失敗:`, error.message);
      throw error;
    }
  }

  /**
   * 從 Raydium 池子數據計算價格
   * @param {Object} pool - Raydium 池子數據
   * @param {string} targetMint - 目標代幣 mint
   * @returns {number} 價格
   */
  getPriceFromRaydiumPool(pool, targetMint) {
    try {
      const mintA = pool.mintA?.address || pool.mintA;
      const mintB = pool.mintB?.address || pool.mintB;

      // 確定目標代幣在哪個位置
      const targetIsA = mintA.toLowerCase() === targetMint.toLowerCase();

      // 獲取儲備量
      const reserveA = parseFloat(pool.mintAmountA || 0);
      const reserveB = parseFloat(pool.mintAmountB || 0);

      if (reserveA === 0 || reserveB === 0) {
        throw new Error('池子儲備量為 0');
      }

      // 計算價格：目標代幣以另一個代幣計價
      const price = targetIsA ? reserveB / reserveA : reserveA / reserveB;

      return price;
    } catch (error) {
      logger.error(`從 Raydium 池子計算價格失敗:`, error.message);
      throw error;
    }
  }

  /**
   * 🔥 NEW: 在鏈上查找代幣的 Raydium 池子（使用 memcmp 過濾器）
   * @param {string} tokenMint - 代幣 Mint 地址
   * @param {string} quoteMint - 報價代幣 Mint (default: USDC)
   * @returns {Promise<PublicKey|null>} 池子地址
   */
  async findRaydiumPoolOnChain(tokenMint, quoteMint = null) {
    try {
      const targetMint = new PublicKey(tokenMint);
      const pairMint = quoteMint ? new PublicKey(quoteMint) : this.usdc;

      logger.debug(`查找池子: ${tokenMint} / ${pairMint.toString()}`);

      // 🔥 方法 1: 嘗試查找 targetMint 作為 baseMint 的池子
      let accounts = await this.connection.getProgramAccounts(
        this.raydiumAMMProgramId,
        {
          filters: [
            { dataSize: LIQUIDITY_STATE_LAYOUT_V4.span }, // 只獲取 V4 池子
            {
              memcmp: {
                offset: LIQUIDITY_STATE_LAYOUT_V4.offsetOf('baseMint'), // baseMint 的偏移量
                bytes: targetMint.toBase58(),
              },
            },
          ],
        }
      );

      logger.debug(`找到 ${accounts.length} 個包含該代幣作為 base 的池子`);

      // 檢查是否有匹配 quoteMint 的池子
      for (const { pubkey, account } of accounts) {
        try {
          const poolState = LIQUIDITY_STATE_LAYOUT_V4.decode(account.data);
          const quoteMintStr = poolState.quoteMint.toString();

          if (quoteMintStr === pairMint.toString()) {
            logger.info(`✅ 找到池子: ${pubkey.toString()}`);
            logger.debug(`  Base: ${poolState.baseMint.toString()}`);
            logger.debug(`  Quote: ${quoteMintStr}`);
            return pubkey;
          }
        } catch (decodeError) {
          // 跳過無法解析的池子
          continue;
        }
      }

      // 🔥 方法 2: 嘗試查找 targetMint 作為 quoteMint 的池子
      accounts = await this.connection.getProgramAccounts(
        this.raydiumAMMProgramId,
        {
          filters: [
            { dataSize: LIQUIDITY_STATE_LAYOUT_V4.span },
            {
              memcmp: {
                offset: LIQUIDITY_STATE_LAYOUT_V4.offsetOf('quoteMint'), // quoteMint 的偏移量
                bytes: targetMint.toBase58(),
              },
            },
          ],
        }
      );

      logger.debug(`找到 ${accounts.length} 個包含該代幣作為 quote 的池子`);

      for (const { pubkey, account } of accounts) {
        try {
          const poolState = LIQUIDITY_STATE_LAYOUT_V4.decode(account.data);
          const baseMintStr = poolState.baseMint.toString();

          if (baseMintStr === pairMint.toString()) {
            logger.info(`✅ 找到池子: ${pubkey.toString()}`);
            logger.debug(`  Base: ${baseMintStr}`);
            logger.debug(`  Quote: ${poolState.quoteMint.toString()}`);
            return pubkey;
          }
        } catch (decodeError) {
          continue;
        }
      }

      logger.warn(`未找到 ${tokenMint} / ${pairMint.toString()} 的池子`);
      return null;
    } catch (error) {
      logger.error(`查找 Raydium 池子失敗:`, error.message);
      return null;
    }
  }

  /**
   * 🔥 NEW: 智能查找最佳池子（同時搜索 AMM V4 和 CPMM）
   * @param {string} tokenMint - 代幣 Mint 地址
   * @param {string} quoteMint - 報價代幣 Mint (default: 先試 SOL，再試 USDC)
   * @returns {Promise<{poolAddress: PublicKey, type: string, pairMint: string}|null>}
   */
  async findBestPoolForToken(tokenMint) {
    try {
      const targetMint = new PublicKey(tokenMint);
      logger.info(`🔍 智能查找代幣池子: ${tokenMint}`);

      const pools = [];

      // 查找順序：SOL 配對 > USDC 配對
      const quoteTokens = [
        { mint: this.wsol, name: 'SOL' },
        { mint: this.usdc, name: 'USDC' }
      ];

      for (const quote of quoteTokens) {
        // 1. 查找 AMM V4 池子
        try {
          logger.debug(`查找 AMM V4 池子: ${tokenMint} / ${quote.name}`);

          // 查找 token 作為 base 的情況
          let accounts = await this.connection.getProgramAccounts(
            this.raydiumAMMProgramId,
            {
              filters: [
                { dataSize: LIQUIDITY_STATE_LAYOUT_V4.span },
                {
                  memcmp: {
                    offset: LIQUIDITY_STATE_LAYOUT_V4.offsetOf('baseMint'),
                    bytes: targetMint.toBase58(),
                  },
                },
              ],
            }
          );

          for (const { pubkey, account } of accounts) {
            try {
              const poolState = LIQUIDITY_STATE_LAYOUT_V4.decode(account.data);
              if (poolState.quoteMint.toString() === quote.mint.toString()) {
                // 獲取流動性
                const [baseBalance, quoteBalance] = await Promise.all([
                  this.connection.getTokenAccountBalance(poolState.baseVault),
                  this.connection.getTokenAccountBalance(poolState.quoteVault),
                ]);
                const liquidity = parseFloat(baseBalance.value.amount) + parseFloat(quoteBalance.value.amount);

                pools.push({
                  poolAddress: pubkey,
                  type: 'AMM_V4',
                  pairMint: quote.mint.toString(),
                  pairName: quote.name,
                  liquidity,
                });
                logger.debug(`  ✅ 找到 AMM V4: ${pubkey.toString()} (流動性: ${liquidity})`);
              }
            } catch (e) {
              continue;
            }
          }

          // 查找 token 作為 quote 的情況
          accounts = await this.connection.getProgramAccounts(
            this.raydiumAMMProgramId,
            {
              filters: [
                { dataSize: LIQUIDITY_STATE_LAYOUT_V4.span },
                {
                  memcmp: {
                    offset: LIQUIDITY_STATE_LAYOUT_V4.offsetOf('quoteMint'),
                    bytes: targetMint.toBase58(),
                  },
                },
              ],
            }
          );

          for (const { pubkey, account } of accounts) {
            try {
              const poolState = LIQUIDITY_STATE_LAYOUT_V4.decode(account.data);
              if (poolState.baseMint.toString() === quote.mint.toString()) {
                const [baseBalance, quoteBalance] = await Promise.all([
                  this.connection.getTokenAccountBalance(poolState.baseVault),
                  this.connection.getTokenAccountBalance(poolState.quoteVault),
                ]);
                const liquidity = parseFloat(baseBalance.value.amount) + parseFloat(quoteBalance.value.amount);

                pools.push({
                  poolAddress: pubkey,
                  type: 'AMM_V4',
                  pairMint: quote.mint.toString(),
                  pairName: quote.name,
                  liquidity,
                });
                logger.debug(`  ✅ 找到 AMM V4: ${pubkey.toString()} (流動性: ${liquidity})`);
              }
            } catch (e) {
              continue;
            }
          }
        } catch (error) {
          logger.warn(`查找 AMM V4 失敗: ${error.message}`);
        }

        // 2. 查找 CPMM 池子
        try {
          logger.debug(`查找 CPMM 池子: ${tokenMint} / ${quote.name}`);

          // CPMM 沒有 layout.offsetOf，需要手動計算或掃描所有
          // 為了性能，我們這裡只掃描較少的池子
          const cpmm_accounts = await this.connection.getProgramAccounts(
            this.raydiumCPMMProgramId,
            {
              filters: [
                { dataSize: 637 }, // CPMM 池子大小
              ],
            }
          );

          logger.debug(`  掃描 ${cpmm_accounts.length} 個 CPMM 池子...`);

          for (const { pubkey, account } of cpmm_accounts) {
            try {
              const poolData = this.parseCPMMPool(account.data);
              const token0 = poolData.token0Mint.toString();
              const token1 = poolData.token1Mint.toString();

              // 檢查是否匹配
              const match = (token0 === targetMint.toString() && token1 === quote.mint.toString()) ||
                           (token1 === targetMint.toString() && token0 === quote.mint.toString());

              if (match) {
                // 獲取流動性
                const [vault0Balance, vault1Balance] = await Promise.all([
                  this.connection.getTokenAccountBalance(poolData.token0Vault),
                  this.connection.getTokenAccountBalance(poolData.token1Vault),
                ]);
                const liquidity = parseFloat(vault0Balance.value.amount) + parseFloat(vault1Balance.value.amount);

                pools.push({
                  poolAddress: pubkey,
                  type: 'CPMM',
                  pairMint: quote.mint.toString(),
                  pairName: quote.name,
                  liquidity,
                });
                logger.debug(`  ✅ 找到 CPMM: ${pubkey.toString()} (流動性: ${liquidity})`);
              }
            } catch (e) {
              continue;
            }
          }
        } catch (error) {
          logger.warn(`查找 CPMM 失敗: ${error.message}`);
        }
      }

      if (pools.length === 0) {
        logger.warn(`未找到任何池子: ${tokenMint}`);
        return null;
      }

      // 選擇流動性最高的池子
      const bestPool = pools.reduce((prev, current) =>
        current.liquidity > prev.liquidity ? current : prev
      );

      logger.info(`🎯 找到最佳池子: ${bestPool.type} (${bestPool.pairName})`);
      logger.info(`   地址: ${bestPool.poolAddress.toString()}`);
      logger.info(`   流動性: ${bestPool.liquidity.toLocaleString()}`);

      return bestPool;
    } catch (error) {
      logger.error(`智能查找池子失敗:`, error.message);
      return null;
    }
  }

  /**
   * 🔥 NEW: 檢測並獲取池子類型
   * @param {string} poolAddress - 池子地址
   * @returns {Promise<{type: string, poolState: any}>}
   */
  async detectPoolType(poolAddress) {
    try {
      const poolPubkey = new PublicKey(poolAddress);
      const accountInfo = await this.connection.getAccountInfo(poolPubkey);

      if (!accountInfo) {
        throw new Error('池子不存在');
      }

      const owner = accountInfo.owner.toString();

      if (owner === this.raydiumAMMProgramId.toString()) {
        return { type: 'AMM_V4', accountInfo };
      } else if (owner === this.raydiumCPMMProgramId.toString()) {
        return { type: 'CPMM', accountInfo };
      } else {
        return { type: 'UNKNOWN', accountInfo };
      }
    } catch (error) {
      logger.error(`檢測池子類型失敗:`, error.message);
      throw error;
    }
  }

  /**
   * 🔥 NEW: 讀取 CPMM 池子數據（簡化版）
   * @param {Buffer} data - 池子賬戶數據
   * @returns {Object} {token0Vault, token1Vault, token0Mint, token1Mint}
   */
  parseCPMMPool(data) {
    try {
      // 根據 Raydium CPMM 結構手動解析關鍵字段
      // 參考: https://github.com/raydium-io/raydium-cp-swap/blob/master/programs/cp-swap/src/states/pool.rs

      let offset = 8; // 跳過 discriminator

      // amm_config: Pubkey (32 bytes)
      offset += 32;

      // pool_creator: Pubkey (32 bytes)
      offset += 32;

      // token_0_vault: Pubkey (32 bytes)
      const token0Vault = new PublicKey(data.slice(offset, offset + 32));
      offset += 32;

      // token_1_vault: Pubkey (32 bytes)
      const token1Vault = new PublicKey(data.slice(offset, offset + 32));
      offset += 32;

      // lp_mint: Pubkey (32 bytes)
      offset += 32;

      // token_0_mint: Pubkey (32 bytes)
      const token0Mint = new PublicKey(data.slice(offset, offset + 32));
      offset += 32;

      // token_1_mint: Pubkey (32 bytes)
      const token1Mint = new PublicKey(data.slice(offset, offset + 32));

      logger.debug(`CPMM 池子解析:`);
      logger.debug(`  Token 0 Mint: ${token0Mint.toString()}`);
      logger.debug(`  Token 1 Mint: ${token1Mint.toString()}`);
      logger.debug(`  Token 0 Vault: ${token0Vault.toString()}`);
      logger.debug(`  Token 1 Vault: ${token1Vault.toString()}`);

      return { token0Vault, token1Vault, token0Mint, token1Mint };
    } catch (error) {
      logger.error(`解析 CPMM 池子失敗:`, error.message);
      throw error;
    }
  }

  /**
   * 🔥 NEW: 使用 LIQUIDITY_STATE_LAYOUT_V4 完全鏈上讀取池子數據
   * @param {string} poolAddress - Raydium AMM V4 池子地址
   * @returns {Promise<Object>} 完整池子狀態
   */
  async getRaydiumPoolStateOnChain(poolAddress) {
    try {
      const poolPubkey = new PublicKey(poolAddress);
      const accountInfo = await this.connection.getAccountInfo(poolPubkey);

      if (!accountInfo || accountInfo.data.length === 0) {
        throw new Error('池子不存在或數據為空');
      }

      // 使用 Raydium SDK 的官方 layout 解析
      const poolState = LIQUIDITY_STATE_LAYOUT_V4.decode(accountInfo.data);

      logger.debug(`Raydium 池子狀態 (${poolAddress}):`);
      logger.debug(`  baseMint: ${poolState.baseMint.toString()}`);
      logger.debug(`  quoteMint: ${poolState.quoteMint.toString()}`);
      logger.debug(`  baseVault: ${poolState.baseVault.toString()}`);
      logger.debug(`  quoteVault: ${poolState.quoteVault.toString()}`);
      logger.debug(`  poolOpenTime: ${poolState.poolOpenTime.toString()}`);

      return poolState;
    } catch (error) {
      logger.error(`解析 Raydium 池子狀態失敗:`, error.message);
      throw error;
    }
  }

  /**
   * 🔥 NEW: 完全鏈上獲取價格（支持 AMM V4 和 CPMM）
   * @param {string} poolAddress - Raydium 池子地址
   * @param {string} targetMint - 目標代幣 mint（返回該代幣的價格）
   * @returns {Promise<number>} 價格（以另一個代幣計價）
   */
  async getPriceFromPoolOnChain(poolAddress, targetMint) {
    try {
      // 1. 檢測池子類型
      const { type, accountInfo } = await this.detectPoolType(poolAddress);
      logger.info(`🔍 池子類型: ${type}`);

      let baseMintStr, quoteMintStr, baseVault, quoteVault;

      if (type === 'AMM_V4') {
        // AMM V4 池子
        const poolState = LIQUIDITY_STATE_LAYOUT_V4.decode(accountInfo.data);
        baseMintStr = poolState.baseMint.toString();
        quoteMintStr = poolState.quoteMint.toString();
        baseVault = poolState.baseVault;
        quoteVault = poolState.quoteVault;
      } else if (type === 'CPMM') {
        // CPMM 池子
        const poolData = this.parseCPMMPool(accountInfo.data);
        baseMintStr = poolData.token0Mint.toString();
        quoteMintStr = poolData.token1Mint.toString();
        baseVault = poolData.token0Vault;
        quoteVault = poolData.token1Vault;
      } else {
        throw new Error(`不支持的池子類型: ${type}`);
      }

      // 2. 確定目標代幣是 base 還是 quote
      const targetIsBase = baseMintStr.toLowerCase() === targetMint.toLowerCase();

      logger.debug(`  Base Mint: ${baseMintStr}`);
      logger.debug(`  Quote Mint: ${quoteMintStr}`);
      logger.debug(`  Target is Base: ${targetIsBase}`);

      // 3. 獲取 vault 餘額
      const [baseBalance, quoteBalance] = await Promise.all([
        this.connection.getTokenAccountBalance(baseVault),
        this.connection.getTokenAccountBalance(quoteVault),
      ]);

      const baseReserve = parseFloat(baseBalance.value.amount) / Math.pow(10, baseBalance.value.decimals);
      const quoteReserve = parseFloat(quoteBalance.value.amount) / Math.pow(10, quoteBalance.value.decimals);

      logger.debug(`  Base Reserve: ${baseReserve.toFixed(6)}`);
      logger.debug(`  Quote Reserve: ${quoteReserve.toFixed(6)}`);

      // 4. 計算價格
      const price = targetIsBase ? quoteReserve / baseReserve : baseReserve / quoteReserve;

      logger.info(`✅ ${type} 池子價格: ${price.toFixed(8)}`);

      return price;
    } catch (error) {
      logger.error(`從鏈上池子獲取價格失敗:`, error.message);
      throw error;
    }
  }

  /**
   * 從 Raydium 池子獲取儲備量（直接方法，用於自定義地址）
   * @param {string} poolAddress - Raydium 池子地址
   * @returns {Promise<{baseReserve: number, quoteReserve: number}>}
   */
  async getRaydiumPoolReserves(poolAddress) {
    try {
      const poolPubkey = new PublicKey(poolAddress);
      const accountInfo = await this.connection.getAccountInfo(poolPubkey);

      if (!accountInfo || accountInfo.data.length === 0) {
        throw new Error('池子不存在或數據為空');
      }

      // Raydium V4 AMM 池子結構解析
      const data = accountInfo.data;
      const baseVaultOffset = 64 + 32 * 3;
      const quoteVaultOffset = 64 + 32 * 4;

      const baseVault = new PublicKey(data.slice(baseVaultOffset, baseVaultOffset + 32));
      const quoteVault = new PublicKey(data.slice(quoteVaultOffset, quoteVaultOffset + 32));

      const [baseAccountInfo, quoteAccountInfo] = await Promise.all([
        this.connection.getTokenAccountBalance(baseVault),
        this.connection.getTokenAccountBalance(quoteVault),
      ]);

      const baseReserve = parseFloat(baseAccountInfo.value.amount);
      const quoteReserve = parseFloat(quoteAccountInfo.value.amount);

      return { baseReserve, quoteReserve };
    } catch (error) {
      logger.error(`獲取 Raydium 池子儲備量失敗:`, error.message);
      throw error;
    }
  }

  /**
   * 使用简化方法：直接读取 LP token accounts
   * @param {string} baseTokenAccount - Base token 账户
   * @param {string} quoteTokenAccount - Quote token 账户
   * @returns {Promise<number>} 价格
   */
  async getPriceFromTokenAccounts(baseTokenAccount, quoteTokenAccount) {
    try {
      const basePubkey = new PublicKey(baseTokenAccount);
      const quotePubkey = new PublicKey(quoteTokenAccount);

      const [baseBalance, quoteBalance] = await Promise.all([
        this.connection.getTokenAccountBalance(basePubkey),
        this.connection.getTokenAccountBalance(quotePubkey),
      ]);

      const baseReserve = parseFloat(baseBalance.value.amount) / Math.pow(10, baseBalance.value.decimals);
      const quoteReserve = parseFloat(quoteBalance.value.amount) / Math.pow(10, quoteBalance.value.decimals);

      // 计算价格 (quote / base)
      const price = quoteReserve / baseReserve;

      return price;
    } catch (error) {
      logger.error(`从 token accounts 获取价格失败:`, error.message);
      throw error;
    }
  }

  /**
   * 🔥 NEW: 獲取 SOL/USD 價格（完全鏈上：直接讀取 Raydium 池子）
   * @returns {Promise<number>} SOL 的 USD 價格
   */
  async getSOLPrice() {
    try {
      // 檢查緩存
      const now = Date.now();
      if (this.solPriceCache.price && (now - this.solPriceCache.timestamp) < this.cacheDuration) {
        return this.solPriceCache.price;
      }

      let solPrice = null;
      let source = null;

      // 🔥 方法 1: 完全鏈上讀取（最優先，無防火牆問題）
      try {
        logger.debug('嘗試方法 1: 鏈上讀取 Raydium SOL/USDC 池子...');
        solPrice = await this.getPriceFromPoolOnChain(
          this.raydiumSOLUSDCPool.toString(),
          this.wsol.toString()
        );
        source = 'raydium-onchain';
        logger.info(`✅ SOL 價格 (鏈上 Raydium): $${solPrice.toFixed(2)}`);
      } catch (onChainError) {
        logger.warn(`鏈上讀取失敗: ${onChainError.message}`);

        // 方法 2: 使用 Jupiter API（DEX 聚合器，作為備用）
        try {
          logger.debug('嘗試方法 2: Jupiter API...');
          const response = await fetch(`https://price.jup.ag/v6/price?ids=${this.wsol.toString()}`);
          const data = await response.json();

          if (data.data && data.data[this.wsol.toString()]) {
            solPrice = data.data[this.wsol.toString()].price;
            source = 'jupiter-api';
            logger.info(`✅ SOL 價格 (Jupiter API): $${solPrice.toFixed(2)}`);
          } else {
            throw new Error('Jupiter API 未返回 SOL 價格');
          }
        } catch (jupiterError) {
          logger.warn(`Jupiter API 失敗: ${jupiterError.message}`);

          // 方法 3: 使用 Raydium API（Solana 最大 DEX，最後備用）
          try {
            logger.debug('嘗試方法 3: Raydium API...');
            const pools = await this.getRaydiumPoolsByMints(
              this.wsol.toString(),
              this.usdc.toString()
            );

            if (!pools || pools.length === 0) {
              throw new Error('未找到 SOL/USDC Raydium 池子');
            }

            const bestPool = pools.reduce((prev, current) => {
              const prevLiquidity = parseFloat(prev.tvl || 0);
              const currentLiquidity = parseFloat(current.tvl || 0);
              return currentLiquidity > prevLiquidity ? current : prev;
            });

            solPrice = this.getPriceFromRaydiumPool(bestPool, this.wsol.toString());
            source = 'raydium-api';
            logger.info(`✅ SOL 價格 (Raydium API): $${solPrice.toFixed(2)}`);
          } catch (raydiumError) {
            logger.error(`Raydium API 也失敗: ${raydiumError.message}`);
            throw new Error(`所有價格來源都失敗 (鏈上 + Jupiter + Raydium)`);
          }
        }
      }

      if (!solPrice) {
        throw new Error('無法獲取 SOL 價格');
      }

      // 更新緩存
      this.solPriceCache = { price: solPrice, timestamp: now, source };
      logger.info(`💾 SOL 價格已緩存: $${solPrice.toFixed(2)} (來源: ${source})`);
      return solPrice;
    } catch (error) {
      logger.error(`獲取 SOL 價格失敗:`, error.message);
      throw error;
    }
  }

  /**
   * 获取代币价格（以 SOL 计价）- 从 Raydium 池子
   * @param {string} poolAddress - Raydium 池子地址或使用 token accounts
   * @param {string} baseTokenAccount - Base token 账户（可选）
   * @param {string} quoteTokenAccount - Quote token 账户（可选）
   * @returns {Promise<number>} 以 SOL 计价的价格
   */
  async getPriceInSOL(poolAddress, baseTokenAccount = null, quoteTokenAccount = null) {
    try {
      let priceInSOL;

      if (baseTokenAccount && quoteTokenAccount) {
        // 使用 token accounts 方法（推荐）
        priceInSOL = await this.getPriceFromTokenAccounts(baseTokenAccount, quoteTokenAccount);
      } else {
        // 使用池子地址方法
        const { baseReserve, quoteReserve } = await this.getRaydiumPoolReserves(poolAddress);
        priceInSOL = quoteReserve / baseReserve;
      }

      logger.debug(`Solana 价格: ${poolAddress} = ${priceInSOL} SOL`);
      return priceInSOL;
    } catch (error) {
      logger.error(`获取 Solana SOL 价格失败:`, error.message);
      throw error;
    }
  }

  /**
   * 获取代币 USD 价格（从 Raydium 池子）
   * @param {string} poolAddress - Token/SOL 池子地址
   * @param {string} baseTokenAccount - Base token 账户（可选）
   * @param {string} quoteTokenAccount - Quote token 账户（可选）
   * @returns {Promise<number>} USD 价格
   */
  async getPriceInUSD(poolAddress, baseTokenAccount = null, quoteTokenAccount = null) {
    try {
      // 获取代币的 SOL 价格
      const priceInSOL = await this.getPriceInSOL(poolAddress, baseTokenAccount, quoteTokenAccount);

      // 获取 SOL 的 USD 价格
      const solPriceUSD = await this.getSOLPrice();

      // 计算 USD 价格
      const priceInUSD = priceInSOL * solPriceUSD;

      logger.debug(`Solana USD 价格: ${poolAddress} = $${priceInUSD}`);
      return priceInUSD;
    } catch (error) {
      logger.error(`获取 Solana USD 价格失败:`, error.message);
      throw error;
    }
  }

  /**
   * 从链上获取代币总供应量
   * @param {string} tokenMint - 代币 Mint 地址
   * @returns {Promise<number>} 总供应量（已格式化）
   */
  async getTotalSupply(tokenMint) {
    try {
      const mintPubkey = new PublicKey(tokenMint);
      const mintInfo = await this.connection.getParsedAccountInfo(mintPubkey);

      if (!mintInfo.value || !mintInfo.value.data.parsed) {
        throw new Error('无法获取代币信息');
      }

      const { decimals, supply } = mintInfo.value.data.parsed.info;
      const totalSupply = Number(supply) / Math.pow(10, decimals);

      return totalSupply;
    } catch (error) {
      logger.error(`获取 Solana 总供应量失败:`, error.message);
      throw error;
    }
  }

  /**
   * 使用 Jupiter API 獲取代幣價格
   * @param {string} tokenMint - 代幣 Mint 地址
   * @returns {Promise<number>} USD 價格
   */
  async getPriceFromJupiterAPI(tokenMint) {
    try {
      const response = await fetch(`https://price.jup.ag/v6/price?ids=${tokenMint}`);
      const data = await response.json();

      if (!data.data || !data.data[tokenMint]) {
        throw new Error(`Jupiter API 未找到代幣 ${tokenMint} 的價格`);
      }

      const priceUSD = data.data[tokenMint].price;
      logger.debug(`Jupiter API 價格: ${tokenMint} = $${priceUSD}`);
      return priceUSD;
    } catch (error) {
      logger.error(`從 Jupiter API 獲取價格失敗:`, error.message);
      throw error;
    }
  }

  /**
   * 使用 Raydium API 獲取代幣價格（以 SOL 計價）
   * @param {string} tokenMint - 代幣 Mint 地址
   * @returns {Promise<number>} 以 SOL 計價的價格
   */
  async getPriceFromRaydiumAPI(tokenMint) {
    try {
      // 查找 token/SOL 池子
      const pools = await this.getRaydiumPoolsByMints(tokenMint, this.wsol.toString());

      if (!pools || pools.length === 0) {
        throw new Error(`未找到 ${tokenMint} 的 Raydium 池子`);
      }

      // 選擇流動性最高的池子
      const bestPool = pools.reduce((prev, current) => {
        const prevLiquidity = parseFloat(prev.tvl || 0);
        const currentLiquidity = parseFloat(current.tvl || 0);
        return currentLiquidity > prevLiquidity ? current : prev;
      });

      logger.debug(`使用 Raydium 池子: ${bestPool.id} (TVL: ${bestPool.tvl})`);

      // 計算價格
      const priceInSOL = this.getPriceFromRaydiumPool(bestPool, tokenMint);

      logger.debug(`Raydium API 價格: ${tokenMint} = ${priceInSOL} SOL`);
      return priceInSOL;
    } catch (error) {
      logger.error(`從 Raydium API 獲取價格失敗:`, error.message);
      throw error;
    }
  }

  /**
   * 🔥 NEW: 智能價格獲取（優先鏈上，然後 API）
   * @param {string} tokenMint - 代幣 Mint 地址
   * @param {string} preferredDex - 優先使用的 DEX ('raydium' 或 'jupiter' 或 'onchain')
   * @returns {Promise<{price: number, source: string}>} 價格和來源
   */
  async getSmartPrice(tokenMint, preferredDex = 'onchain') {
    try {
      // 如果是 WSOL，直接返回 SOL 價格
      if (tokenMint === this.wsol.toString()) {
        const solPrice = await this.getSOLPrice();
        return { price: solPrice, source: this.solPriceCache.source || 'sol-usdc-pool' };
      }

      // 🔥 方法 1: 優先嘗試鏈上讀取（無防火牆問題）
      if (preferredDex === 'onchain' || preferredDex === 'raydium') {
        try {
          logger.debug(`嘗試鏈上查找 ${tokenMint} 的池子...`);

          // 先嘗試 SOL 配對
          let poolAddress = await this.findRaydiumPoolOnChain(tokenMint, this.wsol.toString());

          // 如果沒有 SOL 配對，嘗試 USDC 配對
          if (!poolAddress) {
            logger.debug(`未找到 SOL 配對，嘗試 USDC 配對...`);
            poolAddress = await this.findRaydiumPoolOnChain(tokenMint, this.usdc.toString());
          }

          if (poolAddress) {
            const price = await this.getPriceFromPoolOnChain(poolAddress.toString(), tokenMint);

            // 判斷價格是 SOL 還是 USDC 計價
            const poolState = await this.getRaydiumPoolStateOnChain(poolAddress.toString());
            const isPairedWithSOL = poolState.quoteMint.toString() === this.wsol.toString() ||
                                     poolState.baseMint.toString() === this.wsol.toString();

            let priceUSD;
            if (isPairedWithSOL) {
              const solPriceUSD = await this.getSOLPrice();
              priceUSD = price * solPriceUSD;
            } else {
              // 已經是 USDC 計價
              priceUSD = price;
            }

            logger.info(`✅ 鏈上價格: $${priceUSD.toFixed(8)} (池子: ${poolAddress.toString()})`);
            return { price: priceUSD, source: 'raydium-onchain' };
          }
        } catch (onChainError) {
          logger.warn(`鏈上讀取失敗: ${onChainError.message}`);
        }
      }

      // 方法 2 & 3: 使用 API（作為備用）
      const dexOrder = preferredDex === 'jupiter'
        ? ['jupiter', 'raydium']
        : ['raydium', 'jupiter'];

      for (const dex of dexOrder) {
        try {
          if (dex === 'raydium') {
            const priceInSOL = await this.getPriceFromRaydiumAPI(tokenMint);
            const solPriceUSD = await this.getSOLPrice();
            const priceUSD = priceInSOL * solPriceUSD;
            return { price: priceUSD, source: 'raydium-api' };
          } else if (dex === 'jupiter') {
            const priceUSD = await this.getPriceFromJupiterAPI(tokenMint);
            return { price: priceUSD, source: 'jupiter-api' };
          }
        } catch (error) {
          logger.warn(`${dex} 獲取價格失敗，嘗試下一個來源...`);
          continue;
        }
      }

      throw new Error(`所有價格來源都失敗`);
    } catch (error) {
      logger.error(`智能價格獲取失敗:`, error.message);
      throw error;
    }
  }

  /**
   * 🔥 NEW: 使用已緩存的池子信息快速獲取價格
   * @param {string} tokenMint - 代幣 Mint 地址
   * @param {Object} poolInfo - 池子信息 { poolAddress, version, pairToken }
   * @returns {Promise<number>} USD 價格
   */
  async getPriceWithCachedPool(tokenMint, poolInfo) {
    try {
      const { poolAddress, version, pairToken } = poolInfo;

      logger.debug(`使用緩存池子獲取價格:`);
      logger.debug(`  池子地址: ${poolAddress}`);
      logger.debug(`  版本: ${version}`);
      logger.debug(`  配對: ${pairToken}`);

      // 從鏈上獲取價格
      const price = await this.getPriceFromPoolOnChain(poolAddress, tokenMint);

      // 判斷價格是 SOL 還是 USDC 計價
      let priceUSD;
      if (pairToken === 'SOL') {
        const solPriceUSD = await this.getSOLPrice();
        priceUSD = price * solPriceUSD;
      } else if (pairToken === 'USDC') {
        priceUSD = price;
      } else {
        throw new Error(`不支援的配對代幣: ${pairToken}`);
      }

      logger.info(`✅ 快速價格查詢 (緩存池子): $${priceUSD.toFixed(8)}`);
      return priceUSD;
    } catch (error) {
      logger.error(`使用緩存池子獲取價格失敗: ${error.message}`);
      throw error;
    }
  }

  /**
   * 獲取代幣完整信息（價格 + 市值）- 智能選擇價格來源
   * @param {string} tokenMint - 代幣 Mint 地址
   * @param {string} poolAddress - Raydium 池子地址（可選，向後兼容）
   * @param {string} baseTokenAccount - Base token 帳戶（可選，向後兼容）
   * @param {string} quoteTokenAccount - Quote token 帳戶（可選，向後兼容）
   * @param {string} preferredDex - 優先使用的 DEX ('raydium' 或 'jupiter')
   * @param {Object} cachedPoolInfo - 已緩存的池子信息（可選）
   * @returns {Promise<Object>} { priceUSD, marketCap, marketCapFormatted, totalSupply, source }
   */
  async getTokenInfo(tokenMint, poolAddress = null, baseTokenAccount = null, quoteTokenAccount = null, preferredDex = 'raydium', cachedPoolInfo = null) {
    try {
      let priceUSD;
      let source;

      if (tokenMint === this.wsol.toString()) {
        // WSOL 直接使用 SOL 價格
        priceUSD = await this.getSOLPrice();
        source = 'sol-usdc-pool';
      } else if (cachedPoolInfo && cachedPoolInfo.poolAddress) {
        // 🔥 優先使用緩存的池子信息（最快）
        priceUSD = await this.getPriceWithCachedPool(tokenMint, cachedPoolInfo);
        source = 'cached-pool';
      } else if (poolAddress || (baseTokenAccount && quoteTokenAccount)) {
        // 向後兼容：使用舊方法
        priceUSD = await this.getPriceInUSD(poolAddress, baseTokenAccount, quoteTokenAccount);
        source = 'raydium-legacy';
      } else {
        // 使用智能價格獲取（新方法）
        const result = await this.getSmartPrice(tokenMint, preferredDex);
        priceUSD = result.price;
        source = result.source;
      }

      const totalSupply = await this.getTotalSupply(tokenMint);
      const marketCap = priceUSD * totalSupply;

      let marketCapFormatted;
      if (marketCap >= 1_000_000) {
        marketCapFormatted = `$${(marketCap / 1_000_000).toFixed(2)}M`;
      } else if (marketCap >= 1_000) {
        marketCapFormatted = `$${(marketCap / 1_000).toFixed(2)}K`;
      } else {
        marketCapFormatted = `$${marketCap.toFixed(2)}`;
      }

      logger.info(`Solana 代幣信息 (來源: ${source}): ${tokenMint}`);
      logger.info(`  價格: $${priceUSD.toFixed(8)}`);
      logger.info(`  市值: ${marketCapFormatted}`);

      return {
        priceUSD,
        marketCap,
        marketCapFormatted,
        totalSupply,
        source,
      };
    } catch (error) {
      logger.error(`獲取 Solana 代幣信息失敗:`, error.message);
      throw error;
    }
  }

  /**
   * 获取代币余额
   * @param {string} tokenAddress - 代币地址
   * @param {string} walletAddress - 钱包地址
   * @returns {Promise<number>} 余额
   */
  async getTokenBalance(tokenAddress, walletAddress) {
    try {
      const tokenPubkey = new PublicKey(tokenAddress);
      const walletPubkey = new PublicKey(walletAddress);

      const balance = await this.connection.getTokenAccountBalance(tokenPubkey);
      return balance.value.uiAmount;
    } catch (error) {
      logger.error(`获取 Solana 代币余额失败:`, error.message);
      throw error;
    }
  }

  /**
   * 获取池子信息
   * @param {string} poolAddress - 池子地址
   * @returns {Promise<Object>} 池子信息
   */
  async getPoolInfo(poolAddress) {
    try {
      const poolPubkey = new PublicKey(poolAddress);
      const accountInfo = await this.connection.getAccountInfo(poolPubkey);

      if (!accountInfo) {
        throw new Error('池子不存在');
      }

      logger.debug('Solana 池子资讯:', accountInfo);
      return accountInfo;
    } catch (error) {
      logger.error(`获取 Solana 池子资讯失败:`, error.message);
      throw error;
    }
  }

  /**
   * 別名方法：獲取價格（以 SOL 計價）- 向後兼容
   */
  async getPrice(poolAddress, baseTokenAccount = null, quoteTokenAccount = null) {
    return await this.getPriceInSOL(poolAddress, baseTokenAccount, quoteTokenAccount);
  }

  /**
   * 別名方法：使用智能價格獲取（USD）
   */
  async getPriceFromJupiter(tokenMint) {
    const result = await this.getSmartPrice(tokenMint, 'jupiter');
    return result.price;
  }

  /**
   * 便捷方法：只獲取 USD 價格（不含市值等信息）
   * @param {string} tokenMint - 代幣 Mint 地址
   * @param {string} preferredDex - 優先使用的 DEX
   * @returns {Promise<number>} USD 價格
   */
  async getPriceInUSDByMint(tokenMint, preferredDex = 'raydium') {
    const result = await this.getSmartPrice(tokenMint, preferredDex);
    return result.price;
  }

  /**
   * 便捷方法：獲取多個代幣的價格
   * @param {string[]} tokenMints - 代幣 Mint 地址數組
   * @param {string} preferredDex - 優先使用的 DEX
   * @returns {Promise<Object>} { tokenMint: { price, source }, ... }
   */
  async getBatchPrices(tokenMints, preferredDex = 'raydium') {
    const results = {};

    for (const mint of tokenMints) {
      try {
        const result = await this.getSmartPrice(mint, preferredDex);
        results[mint] = result;
      } catch (error) {
        logger.error(`獲取 ${mint} 價格失敗:`, error.message);
        results[mint] = { price: null, source: 'error', error: error.message };
      }
    }

    return results;
  }
}

export default SolanaPriceMonitor;
