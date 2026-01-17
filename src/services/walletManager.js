import { ethers } from 'ethers';
import { Keypair } from '@solana/web3.js';
import crypto from 'crypto';
import config from '../config/config.js';
import logger from '../utils/logger.js';
import db from '../database/db.js';

/**
 * 錢包管理器 - 安全管理私鑰和簽名者
 * ⚠️ 警告：私鑰管理涉及高風險，請謹慎使用
 */
class WalletManager {
  constructor() {
    this.wallets = {
      bsc: null,
      solana: null,
      base: null,
    };
    this.initialized = false;
  }

  /**
   * 初始化錢包
   * 從環境變數或資料庫載入私鑰
   */
  async initialize() {
    try {
      logger.info('初始化錢包管理器...');

      // 從環境變數載入私鑰
      if (process.env.BSC_PRIVATE_KEY) {
        this.wallets.bsc = this.createEVMWallet('bsc', process.env.BSC_PRIVATE_KEY);
        logger.success(`BSC 錢包已載入: ${this.wallets.bsc.address}`);
      }

      if (process.env.SOLANA_PRIVATE_KEY) {
        this.wallets.solana = this.createSolanaWallet(process.env.SOLANA_PRIVATE_KEY);
        logger.success(`Solana 錢包已載入: ${this.wallets.solana.publicKey.toString()}`);
      }

      if (process.env.BASE_PRIVATE_KEY) {
        this.wallets.base = this.createEVMWallet('base', process.env.BASE_PRIVATE_KEY);
        logger.success(`Base 錢包已載入: ${this.wallets.base.address}`);
      }

      this.initialized = true;

      // 檢查是否有任何錢包被載入
      const hasWallet = Object.values(this.wallets).some(w => w !== null);
      if (!hasWallet) {
        logger.warn('⚠️  未載入任何錢包，自動交易功能將無法使用');
        logger.warn('請在 .env 中設定私鑰: BSC_PRIVATE_KEY, SOLANA_PRIVATE_KEY, BASE_PRIVATE_KEY');
      }

      return this.initialized;
    } catch (error) {
      logger.error('初始化錢包失敗:', error.message);
      throw error;
    }
  }

  /**
   * 創建 EVM 錢包 (BSC/Base)
   * @param {string} chain - 鏈名稱
   * @param {string} privateKey - 私鑰
   * @returns {ethers.Wallet} 錢包實例
   */
  createEVMWallet(chain, privateKey) {
    try {
      // 確保私鑰格式正確
      if (!privateKey.startsWith('0x')) {
        privateKey = '0x' + privateKey;
      }

      const provider = new ethers.JsonRpcProvider(config.rpc[chain]);
      const wallet = new ethers.Wallet(privateKey, provider);

      return wallet;
    } catch (error) {
      logger.error(`創建 ${chain} 錢包失敗:`, error.message);
      throw error;
    }
  }

  /**
   * 創建 Solana 錢包
   * @param {string} privateKey - Base58 編碼的私鑰或 JSON 字串
   * @returns {Keypair} Keypair 實例
   */
  createSolanaWallet(privateKey) {
    try {
      let secretKey;

      // 支援多種格式的私鑰
      if (privateKey.startsWith('[')) {
        // JSON 陣列格式
        secretKey = new Uint8Array(JSON.parse(privateKey));
      } else if (privateKey.length === 88) {
        // Base58 格式 (標準)
        // 需要安裝 bs58 或使用其他方式解碼
        logger.warn('Base58 私鑰格式需要額外處理');
        throw new Error('請使用 JSON 陣列格式的私鑰');
      } else {
        // 假設是 Uint8Array
        secretKey = new Uint8Array(Buffer.from(privateKey, 'hex'));
      }

      const keypair = Keypair.fromSecretKey(secretKey);
      return keypair;
    } catch (error) {
      logger.error('創建 Solana 錢包失敗:', error.message);
      throw error;
    }
  }

  /**
   * 獲取錢包
   * @param {string} chain - 鏈名稱
   * @returns {Object} 錢包實例
   */
  getWallet(chain) {
    if (!this.initialized) {
      throw new Error('錢包管理器未初始化');
    }

    const wallet = this.wallets[chain.toLowerCase()];
    if (!wallet) {
      throw new Error(`${chain} 鏈的錢包未配置`);
    }

    return wallet;
  }

  /**
   * 檢查錢包是否可用
   * @param {string} chain - 鏈名稱
   * @returns {boolean}
   */
  hasWallet(chain) {
    return this.wallets[chain.toLowerCase()] !== null;
  }

  /**
   * 獲取錢包地址
   * @param {string} chain - 鏈名稱
   * @returns {string}
   */
  getAddress(chain) {
    const wallet = this.getWallet(chain);

    if (chain === 'solana') {
      return wallet.publicKey.toString();
    } else {
      return wallet.address;
    }
  }

  /**
   * 獲取錢包餘額
   * @param {string} chain - 鏈名稱
   * @returns {Promise<string>}
   */
  async getBalance(chain) {
    try {
      const wallet = this.getWallet(chain);

      if (chain === 'solana') {
        const connection = wallet.connection;
        const balance = await connection.getBalance(wallet.publicKey);
        return (balance / 1e9).toString(); // 轉換為 SOL
      } else {
        const balance = await wallet.provider.getBalance(wallet.address);
        return ethers.formatEther(balance);
      }
    } catch (error) {
      logger.error(`獲取 ${chain} 餘額失敗:`, error.message);
      throw error;
    }
  }

  /**
   * 加密私鑰（用於資料庫存儲）
   * @param {string} privateKey - 私鑰
   * @param {string} password - 加密密碼
   * @returns {string} 加密後的私鑰
   */
  encryptPrivateKey(privateKey, password) {
    const algorithm = 'aes-256-cbc';
    const key = crypto.scryptSync(password, 'salt', 32);
    const iv = crypto.randomBytes(16);

    const cipher = crypto.createCipheriv(algorithm, key, iv);
    let encrypted = cipher.update(privateKey, 'utf8', 'hex');
    encrypted += cipher.final('hex');

    return iv.toString('hex') + ':' + encrypted;
  }

  /**
   * 解密私鑰
   * @param {string} encryptedKey - 加密的私鑰
   * @param {string} password - 解密密碼
   * @returns {string} 解密後的私鑰
   */
  decryptPrivateKey(encryptedKey, password) {
    const algorithm = 'aes-256-cbc';
    const key = crypto.scryptSync(password, 'salt', 32);

    const parts = encryptedKey.split(':');
    const iv = Buffer.from(parts[0], 'hex');
    const encrypted = parts[1];

    const decipher = crypto.createDecipheriv(algorithm, key, iv);
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
  }

  /**
   * 生成新錢包
   * @param {string} chain - 鏈名稱
   * @returns {Object} 錢包資訊
   */
  static generateWallet(chain) {
    if (chain === 'solana') {
      const keypair = Keypair.generate();
      return {
        publicKey: keypair.publicKey.toString(),
        privateKey: JSON.stringify(Array.from(keypair.secretKey)),
      };
    } else {
      const wallet = ethers.Wallet.createRandom();
      return {
        address: wallet.address,
        privateKey: wallet.privateKey,
        mnemonic: wallet.mnemonic?.phrase,
      };
    }
  }
}

// 創建單例
const walletManager = new WalletManager();

export default walletManager;
