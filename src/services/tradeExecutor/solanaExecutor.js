import {
  Connection,
  PublicKey,
  Transaction,
  SystemProgram,
  sendAndConfirmTransaction,
} from '@solana/web3.js';
import config from '../../config/config.js';
import logger from '../../utils/logger.js';
import walletManager from '../walletManager.js';

/**
 * Solana 鏈交易執行器
 * 注意：Raydium SDK 較為複雜，這裡提供基礎實現
 * 建議使用 Jupiter Aggregator API 進行實際交易
 */
class SolanaTradeExecutor {
  constructor() {
    this.connection = new Connection(config.rpc.solana, 'confirmed');
  }

  /**
   * 執行買入交易（使用 Jupiter API）
   * @param {Object} params - 交易參數
   * @returns {Promise<Object>} 交易結果
   */
  async executeBuy(params) {
    const {
      tokenMint, // 目標代幣 Mint 地址
      amountIn, // SOL 數量
      slippage = 2,
    } = params;

    try {
      logger.info(`執行 Solana 買入: ${tokenMint}`);

      // 獲取錢包
      const wallet = walletManager.getWallet('solana');

      // 使用 Jupiter API 獲取交易路由
      const quoteResponse = await this.getJupiterQuote({
        inputMint: 'So11111111111111111111111111111111111111112', // SOL
        outputMint: tokenMint,
        amount: amountIn * 1e9, // 轉換為 lamports
        slippage,
      });

      if (!quoteResponse) {
        throw new Error('無法獲取交易路由');
      }

      // 獲取交易數據
      const swapTransaction = await this.getJupiterSwapTransaction(
        quoteResponse,
        wallet.publicKey.toString()
      );

      if (!swapTransaction) {
        throw new Error('無法構建交易');
      }

      // 反序列化交易
      const transactionBuf = Buffer.from(swapTransaction, 'base64');
      const transaction = Transaction.from(transactionBuf);

      // 簽名並發送交易
      logger.info('正在發送交易...');
      const signature = await sendAndConfirmTransaction(
        this.connection,
        transaction,
        [wallet],
        {
          commitment: 'confirmed',
          skipPreflight: false,
        }
      );

      logger.success(`✅ Solana 買入成功! 簽名: ${signature}`);

      return {
        success: true,
        signature,
      };
    } catch (error) {
      logger.error('Solana 買入失敗:', error.message);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * 執行賣出交易
   * @param {Object} params - 交易參數
   * @returns {Promise<Object>} 交易結果
   */
  async executeSell(params) {
    const {
      tokenMint,
      amountIn, // Token 數量
      decimals = 6,
      slippage = 2,
    } = params;

    try {
      logger.info(`執行 Solana 賣出: ${tokenMint}`);

      const wallet = walletManager.getWallet('solana');

      // 使用 Jupiter API
      const quoteResponse = await this.getJupiterQuote({
        inputMint: tokenMint,
        outputMint: 'So11111111111111111111111111111111111111112', // SOL
        amount: amountIn * Math.pow(10, decimals),
        slippage,
      });

      if (!quoteResponse) {
        throw new Error('無法獲取交易路由');
      }

      const swapTransaction = await this.getJupiterSwapTransaction(
        quoteResponse,
        wallet.publicKey.toString()
      );

      if (!swapTransaction) {
        throw new Error('無法構建交易');
      }

      const transactionBuf = Buffer.from(swapTransaction, 'base64');
      const transaction = Transaction.from(transactionBuf);

      logger.info('正在發送交易...');
      const signature = await sendAndConfirmTransaction(
        this.connection,
        transaction,
        [wallet],
        {
          commitment: 'confirmed',
        }
      );

      logger.success(`✅ Solana 賣出成功! 簽名: ${signature}`);

      return {
        success: true,
        signature,
      };
    } catch (error) {
      logger.error('Solana 賣出失敗:', error.message);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * 從 Jupiter API 獲取交易路由
   * @param {Object} params - 查詢參數
   * @returns {Promise<Object>}
   */
  async getJupiterQuote(params) {
    try {
      const { inputMint, outputMint, amount, slippage } = params;

      const url = `https://quote-api.jup.ag/v6/quote?inputMint=${inputMint}&outputMint=${outputMint}&amount=${amount}&slippageBps=${slippage * 100}`;

      const response = await fetch(url);
      const data = await response.json();

      if (data.error) {
        throw new Error(data.error);
      }

      logger.info(`Jupiter 路由: 輸入 ${amount} -> 預期輸出 ${data.outAmount}`);

      return data;
    } catch (error) {
      logger.error('獲取 Jupiter 路由失敗:', error.message);
      return null;
    }
  }

  /**
   * 從 Jupiter API 獲取交易數據
   * @param {Object} quoteResponse - 路由響應
   * @param {string} userPublicKey - 用戶公鑰
   * @returns {Promise<string>}
   */
  async getJupiterSwapTransaction(quoteResponse, userPublicKey) {
    try {
      const response = await fetch('https://quote-api.jup.ag/v6/swap', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          quoteResponse,
          userPublicKey,
          wrapAndUnwrapSol: true,
          dynamicComputeUnitLimit: true,
          prioritizationFeeLamports: 'auto',
        }),
      });

      const data = await response.json();

      if (data.error) {
        throw new Error(data.error);
      }

      return data.swapTransaction;
    } catch (error) {
      logger.error('獲取 Jupiter 交易失敗:', error.message);
      return null;
    }
  }

  /**
   * 獲取 SOL 餘額
   * @param {string} walletAddress - 錢包地址
   * @returns {Promise<number>}
   */
  async getBalance(walletAddress) {
    try {
      const publicKey = new PublicKey(walletAddress);
      const balance = await this.connection.getBalance(publicKey);
      return balance / 1e9; // 轉換為 SOL
    } catch (error) {
      logger.error('獲取 SOL 餘額失敗:', error.message);
      throw error;
    }
  }

  /**
   * 獲取代幣餘額
   * @param {string} tokenMint - 代幣 Mint 地址
   * @param {string} walletAddress - 錢包地址
   * @returns {Promise<number>}
   */
  async getTokenBalance(tokenMint, walletAddress) {
    try {
      const publicKey = new PublicKey(walletAddress);
      const tokenAccounts = await this.connection.getParsedTokenAccountsByOwner(
        publicKey,
        { mint: new PublicKey(tokenMint) }
      );

      if (tokenAccounts.value.length === 0) {
        return 0;
      }

      const balance = tokenAccounts.value[0].account.data.parsed.info.tokenAmount.uiAmount;
      return balance;
    } catch (error) {
      logger.error('獲取代幣餘額失敗:', error.message);
      throw error;
    }
  }
}

export default SolanaTradeExecutor;
