import { ethers } from 'ethers';
import { Connection, PublicKey } from '@solana/web3.js';
import config from '../config/config.js';
import logger from '../utils/logger.js';

// ERC20 標準 ABI
const ERC20_ABI = [
  'function symbol() external view returns (string)',
  'function decimals() external view returns (uint8)',
  'function name() external view returns (string)',
];

// Factory ABI - 用於獲取 pair address
const FACTORY_ABI = [
  'function getPair(address tokenA, address tokenB) external view returns (address pair)',
];

class TokenMetadataService {
  constructor() {
    // 初始化 providers
    this.bscProvider = new ethers.JsonRpcProvider(config.rpc.bsc);
    this.solanaConnection = new Connection(config.rpc.solana, 'confirmed');
    this.baseProvider = new ethers.JsonRpcProvider(config.rpc.base);

    // DEX 配置
    this.dexConfig = {
      bsc: {
        factory: config.dex.bsc.factoryV2,
        wtoken: config.dex.bsc.wbnb, // WBNB
      },
      base: {
        factory: config.dex.base.factory,
        wtoken: config.dex.base.weth, // WETH
      },
    };
  }

  /**
   * 從 BSC 鏈上獲取 token metadata
   * @param {string} tokenAddress - Token 地址
   * @returns {Promise<Object>} { symbol, decimals, name, pairAddress }
   */
  async getBSCMetadata(tokenAddress) {
    try {
      logger.info(`正在從 BSC 鏈上獲取 token metadata: ${tokenAddress}`);

      // 創建 token 合約實例
      const tokenContract = new ethers.Contract(tokenAddress, ERC20_ABI, this.bscProvider);

      // 並行獲取 symbol, decimals, name
      const [symbol, decimals, name] = await Promise.all([
        tokenContract.symbol(),
        tokenContract.decimals(),
        tokenContract.name().catch(() => 'Unknown'), // name 可能不存在
      ]);

      // 獲取 pair address (與 WBNB 的交易對)
      const factory = new ethers.Contract(
        this.dexConfig.bsc.factory,
        FACTORY_ABI,
        this.bscProvider
      );
      const pairAddress = await factory.getPair(tokenAddress, this.dexConfig.bsc.wtoken);

      logger.success(`BSC Token: ${name} (${symbol}), Decimals: ${decimals}`);
      if (pairAddress !== ethers.ZeroAddress) {
        logger.info(`  Pair Address: ${pairAddress}`);
      }

      return {
        symbol,
        decimals: Number(decimals),
        name,
        pairAddress: pairAddress === ethers.ZeroAddress ? null : pairAddress,
      };
    } catch (error) {
      logger.error(`獲取 BSC metadata 失敗: ${error.message}`);
      throw new Error(`無法從 BSC 鏈上獲取 token 資訊: ${error.message}`);
    }
  }

  /**
   * 從 Solana 鏈上獲取 token metadata
   * @param {string} tokenAddress - Token Mint 地址
   * @returns {Promise<Object>} { symbol, decimals, name }
   */
  async getSolanaMetadata(tokenAddress) {
    try {
      logger.info(`正在從 Solana 鏈上獲取 token metadata: ${tokenAddress}`);

      const mintPubkey = new PublicKey(tokenAddress);
      const accountInfo = await this.solanaConnection.getParsedAccountInfo(mintPubkey);

      if (!accountInfo.value || !accountInfo.value.data.parsed) {
        throw new Error('無法獲取 token 資訊');
      }

      const { decimals } = accountInfo.value.data.parsed.info;

      // Solana 的 symbol 和 name 需要從 metadata account 獲取
      // Metadata account 地址通過 PDA 計算得出
      const TOKEN_METADATA_PROGRAM_ID = new PublicKey(
        'metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s'
      );

      // 計算 metadata PDA
      const [metadataPDA] = PublicKey.findProgramAddressSync(
        [Buffer.from('metadata'), TOKEN_METADATA_PROGRAM_ID.toBuffer(), mintPubkey.toBuffer()],
        TOKEN_METADATA_PROGRAM_ID
      );

      let symbol = 'UNKNOWN';
      let name = 'Unknown Token';

      try {
        const metadataAccount = await this.solanaConnection.getAccountInfo(metadataPDA);
        if (metadataAccount && metadataAccount.data) {
          // Metaplex Token Metadata 結構解析
          // 參考: https://docs.metaplex.com/programs/token-metadata/accounts
          const data = metadataAccount.data;

          // 跳過前面的固定字段
          let offset = 1 + 32 + 32; // key(1) + update_authority(32) + mint(32)

          // 讀取 name (String 類型: 4 bytes length + data)
          const nameLength = data.readUInt32LE(offset);
          offset += 4;
          if (nameLength > 0 && nameLength < 100) {
            const nameBytes = data.slice(offset, offset + nameLength);
            name = nameBytes.toString('utf8').replace(/\0/g, '').trim();
            offset += nameLength;
          } else {
            offset += 32; // 固定長度
          }

          // 讀取 symbol (String 類型: 4 bytes length + data)
          const symbolLength = data.readUInt32LE(offset);
          offset += 4;
          if (symbolLength > 0 && symbolLength < 20) {
            const symbolBytes = data.slice(offset, offset + symbolLength);
            symbol = symbolBytes.toString('utf8').replace(/\0/g, '').trim();
          }

          // 如果解析失敗，嘗試簡單的字符串搜索
          if (symbol === 'UNKNOWN' || !symbol) {
            const dataStr = data.toString('utf8');
            // 尋找可能的 symbol 和 name
            const parts = dataStr.split('\0').filter(s => s.length > 0 && s.length < 20);
            if (parts.length >= 2) {
              name = parts[0].trim();
              symbol = parts[1].trim();
            }
          }
        }
      } catch (metaError) {
        logger.warn(`無法獲取 Solana metadata account: ${metaError.message}`);
      }

      logger.success(`Solana Token: ${name} (${symbol}), Decimals: ${decimals}`);

      return {
        symbol: symbol || 'UNKNOWN',
        decimals,
        name: name || 'Unknown Token',
        pairAddress: null, // Solana 使用 pool address，不需要在這裡獲取
      };
    } catch (error) {
      logger.error(`獲取 Solana metadata 失敗: ${error.message}`);
      throw new Error(`無法從 Solana 鏈上獲取 token 資訊: ${error.message}`);
    }
  }

  /**
   * 從 Base 鏈上獲取 token metadata
   * @param {string} tokenAddress - Token 地址
   * @returns {Promise<Object>} { symbol, decimals, name, pairAddress }
   */
  async getBaseMetadata(tokenAddress) {
    try {
      logger.info(`正在從 Base 鏈上獲取 token metadata: ${tokenAddress}`);

      // 創建 token 合約實例
      const tokenContract = new ethers.Contract(tokenAddress, ERC20_ABI, this.baseProvider);

      // 並行獲取 symbol, decimals, name
      const [symbol, decimals, name] = await Promise.all([
        tokenContract.symbol(),
        tokenContract.decimals(),
        tokenContract.name().catch(() => 'Unknown'), // name 可能不存在
      ]);

      // 嘗試獲取 pair address (與 WETH 的交易對)
      let pairAddress = null;
      try {
        const factory = new ethers.Contract(
          this.dexConfig.base.factory,
          FACTORY_ABI,
          this.baseProvider
        );
        const pair = await factory.getPair(tokenAddress, this.dexConfig.base.wtoken);
        if (pair !== ethers.ZeroAddress) {
          pairAddress = pair;
          logger.info(`  Pair Address: ${pairAddress}`);
        } else {
          logger.warn(`  警告: 該 token 沒有與 WETH 的 Uniswap V2 交易對`);
        }
      } catch (pairError) {
        logger.warn(`  無法獲取 pair address: ${pairError.message}`);
        logger.warn(`  將繼續返回 token 基本資訊，但沒有 pair address`);
      }

      logger.success(`Base Token: ${name} (${symbol}), Decimals: ${decimals}`);

      return {
        symbol,
        decimals: Number(decimals),
        name,
        pairAddress,
      };
    } catch (error) {
      logger.error(`獲取 Base metadata 失敗: ${error.message}`);
      throw new Error(`無法從 Base 鏈上獲取 token 資訊: ${error.message}`);
    }
  }

  /**
   * 自動獲取 token metadata（根據鏈類型）
   * @param {string} chain - 鏈名稱 (bsc/solana/base)
   * @param {string} address - Token 地址
   * @returns {Promise<Object>} { symbol, decimals, name, pairAddress }
   */
  async getMetadata(chain, address) {
    try {
      const chainLower = chain.toLowerCase();

      switch (chainLower) {
        case 'bsc':
          return await this.getBSCMetadata(address);

        case 'solana':
          return await this.getSolanaMetadata(address);

        case 'base':
          return await this.getBaseMetadata(address);

        default:
          throw new Error(`不支援的鏈: ${chain}`);
      }
    } catch (error) {
      logger.error(`獲取 ${chain} metadata 失敗:`, error.message);
      throw error;
    }
  }
}

export default new TokenMetadataService();
