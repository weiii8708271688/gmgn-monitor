import { ethers } from 'ethers';
import config from '../../config/config.js';
import logger from '../../utils/logger.js';
import walletManager from '../walletManager.js';

// PancakeSwap Router V2 ABI (僅需要的函數)
const ROUTER_ABI = [
  'function swapExactTokensForTokens(uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline) external returns (uint[] memory amounts)',
  'function swapExactETHForTokens(uint amountOutMin, address[] calldata path, address to, uint deadline) external payable returns (uint[] memory amounts)',
  'function swapExactTokensForETH(uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline) external returns (uint[] memory amounts)',
  'function getAmountsOut(uint amountIn, address[] memory path) public view returns (uint[] memory amounts)',
];

// ERC20 Token ABI
const ERC20_ABI = [
  'function approve(address spender, uint256 amount) external returns (bool)',
  'function allowance(address owner, address spender) external view returns (uint256)',
  'function balanceOf(address account) external view returns (uint256)',
  'function decimals() external view returns (uint8)',
];

/**
 * BSC 鏈交易執行器 (PancakeSwap)
 */
class BSCTradeExecutor {
  constructor() {
    this.provider = new ethers.JsonRpcProvider(config.rpc.bsc);
    this.router = new ethers.Contract(
      config.dex.bsc.routerV2,
      ROUTER_ABI,
      this.provider
    );
    this.wbnb = config.dex.bsc.wbnb;
  }

  /**
   * 執行買入交易
   * @param {Object} params - 交易參數
   * @returns {Promise<Object>} 交易結果
   */
  async executeBuy(params) {
    const {
      tokenAddress,
      amountIn, // BNB 數量
      slippage = 2, // 滑點 (%)
      deadline = 20, // 截止時間 (分鐘)
    } = params;

    try {
      logger.info(`執行 BSC 買入: ${tokenAddress}`);

      // 獲取錢包
      const wallet = walletManager.getWallet('bsc');

      // 構建交易路徑 (BNB -> Token)
      const path = [this.wbnb, tokenAddress];

      // 計算預期輸出
      const amountsOut = await this.router.getAmountsOut(
        ethers.parseEther(amountIn.toString()),
        path
      );
      const expectedOut = amountsOut[1];

      // 計算最小輸出 (考慮滑點)
      const amountOutMin = (expectedOut * BigInt(100 - slippage)) / BigInt(100);

      // 設定截止時間
      const deadlineTimestamp = Math.floor(Date.now() / 1000) + deadline * 60;

      // 連接錢包到 Router
      const routerWithSigner = this.router.connect(wallet);

      logger.info(`買入金額: ${amountIn} BNB`);
      logger.info(`預期獲得: ${ethers.formatUnits(expectedOut, 18)} tokens`);
      logger.info(`最小獲得: ${ethers.formatUnits(amountOutMin, 18)} tokens (滑點 ${slippage}%)`);

      // 執行交易
      const tx = await routerWithSigner.swapExactETHForTokens(
        amountOutMin,
        path,
        wallet.address,
        deadlineTimestamp,
        {
          value: ethers.parseEther(amountIn.toString()),
          gasLimit: 300000, // 設定 gas limit
        }
      );

      logger.info(`交易已發送: ${tx.hash}`);
      logger.info('等待交易確認...');

      // 等待交易確認
      const receipt = await tx.wait();

      logger.success(`✅ 買入成功! Gas 使用: ${receipt.gasUsed.toString()}`);

      return {
        success: true,
        txHash: receipt.hash,
        gasUsed: receipt.gasUsed.toString(),
        blockNumber: receipt.blockNumber,
      };
    } catch (error) {
      logger.error('BSC 買入失敗:', error.message);
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
      tokenAddress,
      amountIn, // Token 數量
      decimals = 18,
      slippage = 2,
      deadline = 20,
    } = params;

    try {
      logger.info(`執行 BSC 賣出: ${tokenAddress}`);

      // 獲取錢包
      const wallet = walletManager.getWallet('bsc');

      // 創建 Token 合約實例
      const token = new ethers.Contract(tokenAddress, ERC20_ABI, wallet);

      // 檢查並批准 Router
      await this.approveToken(token, wallet, amountIn, decimals);

      // 構建交易路徑 (Token -> BNB)
      const path = [tokenAddress, this.wbnb];

      // 計算預期輸出
      const amountInWei = ethers.parseUnits(amountIn.toString(), decimals);
      const amountsOut = await this.router.getAmountsOut(amountInWei, path);
      const expectedOut = amountsOut[1];

      // 計算最小輸出
      const amountOutMin = (expectedOut * BigInt(100 - slippage)) / BigInt(100);

      // 設定截止時間
      const deadlineTimestamp = Math.floor(Date.now() / 1000) + deadline * 60;

      // 連接錢包到 Router
      const routerWithSigner = this.router.connect(wallet);

      logger.info(`賣出數量: ${amountIn} tokens`);
      logger.info(`預期獲得: ${ethers.formatEther(expectedOut)} BNB`);
      logger.info(`最小獲得: ${ethers.formatEther(amountOutMin)} BNB (滑點 ${slippage}%)`);

      // 執行交易
      const tx = await routerWithSigner.swapExactTokensForETH(
        amountInWei,
        amountOutMin,
        path,
        wallet.address,
        deadlineTimestamp,
        {
          gasLimit: 300000,
        }
      );

      logger.info(`交易已發送: ${tx.hash}`);
      logger.info('等待交易確認...');

      // 等待交易確認
      const receipt = await tx.wait();

      logger.success(`✅ 賣出成功! Gas 使用: ${receipt.gasUsed.toString()}`);

      return {
        success: true,
        txHash: receipt.hash,
        gasUsed: receipt.gasUsed.toString(),
        blockNumber: receipt.blockNumber,
      };
    } catch (error) {
      logger.error('BSC 賣出失敗:', error.message);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * 批准 Token 給 Router
   * @param {Contract} token - Token 合約
   * @param {Wallet} wallet - 錢包
   * @param {number} amount - 數量
   * @param {number} decimals - 精度
   */
  async approveToken(token, wallet, amount, decimals) {
    try {
      const amountWei = ethers.parseUnits(amount.toString(), decimals);
      const routerAddress = config.dex.bsc.routerV2;

      // 檢查當前授權額度
      const currentAllowance = await token.allowance(wallet.address, routerAddress);

      if (currentAllowance >= amountWei) {
        logger.info('Token 已授權，無需重複授權');
        return;
      }

      logger.info('正在授權 Token...');

      // 授權最大額度（避免頻繁授權）
      const maxApproval = ethers.MaxUint256;
      const approveTx = await token.approve(routerAddress, maxApproval, {
        gasLimit: 100000,
      });

      logger.info(`授權交易已發送: ${approveTx.hash}`);
      await approveTx.wait();

      logger.success('Token 授權成功');
    } catch (error) {
      logger.error('Token 授權失敗:', error.message);
      throw error;
    }
  }

  /**
   * 估算交易 Gas 費用
   * @param {Object} params - 交易參數
   * @returns {Promise<Object>} Gas 估算
   */
  async estimateGas(params) {
    try {
      const { type, tokenAddress, amountIn, decimals = 18 } = params;
      const wallet = walletManager.getWallet('bsc');
      const routerWithSigner = this.router.connect(wallet);

      let gasEstimate;

      if (type === 'buy') {
        const path = [this.wbnb, tokenAddress];
        const deadlineTimestamp = Math.floor(Date.now() / 1000) + 1200;

        gasEstimate = await routerWithSigner.swapExactETHForTokens.estimateGas(
          0, // amountOutMin
          path,
          wallet.address,
          deadlineTimestamp,
          {
            value: ethers.parseEther(amountIn.toString()),
          }
        );
      } else {
        const path = [tokenAddress, this.wbnb];
        const deadlineTimestamp = Math.floor(Date.now() / 1000) + 1200;
        const amountInWei = ethers.parseUnits(amountIn.toString(), decimals);

        gasEstimate = await routerWithSigner.swapExactTokensForETH.estimateGas(
          amountInWei,
          0,
          path,
          wallet.address,
          deadlineTimestamp
        );
      }

      // 獲取當前 Gas Price
      const feeData = await this.provider.getFeeData();
      const gasPrice = feeData.gasPrice;

      const gasCost = gasEstimate * gasPrice;

      return {
        gasLimit: gasEstimate.toString(),
        gasPrice: ethers.formatUnits(gasPrice, 'gwei'),
        estimatedCost: ethers.formatEther(gasCost),
      };
    } catch (error) {
      logger.error('估算 Gas 失敗:', error.message);
      throw error;
    }
  }

  /**
   * 獲取代幣餘額
   * @param {string} tokenAddress - 代幣地址
   * @param {string} walletAddress - 錢包地址
   * @returns {Promise<string>} 餘額
   */
  async getTokenBalance(tokenAddress, walletAddress) {
    try {
      const token = new ethers.Contract(tokenAddress, ERC20_ABI, this.provider);
      const balance = await token.balanceOf(walletAddress);
      const decimals = await token.decimals();

      return ethers.formatUnits(balance, decimals);
    } catch (error) {
      logger.error('獲取代幣餘額失敗:', error.message);
      throw error;
    }
  }
}

export default BSCTradeExecutor;
