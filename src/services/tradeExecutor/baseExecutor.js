import { ethers } from 'ethers';
import config from '../../config/config.js';
import logger from '../../utils/logger.js';
import walletManager from '../walletManager.js';

// Aerodrome/Uniswap V2 Router ABI
const ROUTER_ABI = [
  'function swapExactTokensForTokens(uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline) external returns (uint[] memory amounts)',
  'function swapExactETHForTokens(uint amountOutMin, address[] calldata path, address to, uint deadline) external payable returns (uint[] memory amounts)',
  'function swapExactTokensForETH(uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline) external returns (uint[] memory amounts)',
  'function getAmountsOut(uint amountIn, address[] memory path) public view returns (uint[] memory amounts)',
];

// ERC20 ABI
const ERC20_ABI = [
  'function approve(address spender, uint256 amount) external returns (bool)',
  'function allowance(address owner, address spender) external view returns (uint256)',
  'function balanceOf(address account) external view returns (uint256)',
  'function decimals() external view returns (uint8)',
];

/**
 * Base 鏈交易執行器
 * 使用 Aerodrome 或 Uniswap V2 compatible DEX
 */
class BaseTradeExecutor {
  constructor() {
    this.provider = new ethers.JsonRpcProvider(config.rpc.base);
    // 注意：如果要使用 Uniswap V3 进行交易，需要使用 SwapRouter
    // 这里暂时注释掉，因为配置中已经没有 routerV2
    // 如果需要交易功能，需要添加 V3 SwapRouter 地址到配置
    this.routerAddress = '0x2626664c2603336E57B271c5C0b26F421741e481'; // Uniswap V3 SwapRouter on Base
    this.router = new ethers.Contract(
      this.routerAddress,
      ROUTER_ABI,
      this.provider
    );
    this.weth = config.dex.base.weth;
  }

  /**
   * 執行買入交易
   * @param {Object} params - 交易參數
   * @returns {Promise<Object>} 交易結果
   */
  async executeBuy(params) {
    const {
      tokenAddress,
      amountIn, // ETH 數量
      slippage = 2,
      deadline = 20,
    } = params;

    try {
      logger.info(`執行 Base 買入: ${tokenAddress}`);

      const wallet = walletManager.getWallet('base');
      const path = [this.weth, tokenAddress];

      // 計算預期輸出
      const amountsOut = await this.router.getAmountsOut(
        ethers.parseEther(amountIn.toString()),
        path
      );
      const expectedOut = amountsOut[1];
      const amountOutMin = (expectedOut * BigInt(100 - slippage)) / BigInt(100);

      const deadlineTimestamp = Math.floor(Date.now() / 1000) + deadline * 60;
      const routerWithSigner = this.router.connect(wallet);

      logger.info(`買入金額: ${amountIn} ETH`);
      logger.info(`預期獲得: ${ethers.formatUnits(expectedOut, 18)} tokens`);

      const tx = await routerWithSigner.swapExactETHForTokens(
        amountOutMin,
        path,
        wallet.address,
        deadlineTimestamp,
        {
          value: ethers.parseEther(amountIn.toString()),
          gasLimit: 300000,
        }
      );

      logger.info(`交易已發送: ${tx.hash}`);
      const receipt = await tx.wait();

      logger.success(`✅ Base 買入成功! Gas: ${receipt.gasUsed.toString()}`);

      return {
        success: true,
        txHash: receipt.hash,
        gasUsed: receipt.gasUsed.toString(),
        blockNumber: receipt.blockNumber,
      };
    } catch (error) {
      logger.error('Base 買入失敗:', error.message);
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
      amountIn,
      decimals = 18,
      slippage = 2,
      deadline = 20,
    } = params;

    try {
      logger.info(`執行 Base 賣出: ${tokenAddress}`);

      const wallet = walletManager.getWallet('base');
      const token = new ethers.Contract(tokenAddress, ERC20_ABI, wallet);

      // 授權
      await this.approveToken(token, wallet, amountIn, decimals);

      const path = [tokenAddress, this.weth];
      const amountInWei = ethers.parseUnits(amountIn.toString(), decimals);

      const amountsOut = await this.router.getAmountsOut(amountInWei, path);
      const expectedOut = amountsOut[1];
      const amountOutMin = (expectedOut * BigInt(100 - slippage)) / BigInt(100);

      const deadlineTimestamp = Math.floor(Date.now() / 1000) + deadline * 60;
      const routerWithSigner = this.router.connect(wallet);

      logger.info(`賣出數量: ${amountIn} tokens`);
      logger.info(`預期獲得: ${ethers.formatEther(expectedOut)} ETH`);

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
      const receipt = await tx.wait();

      logger.success(`✅ Base 賣出成功! Gas: ${receipt.gasUsed.toString()}`);

      return {
        success: true,
        txHash: receipt.hash,
        gasUsed: receipt.gasUsed.toString(),
        blockNumber: receipt.blockNumber,
      };
    } catch (error) {
      logger.error('Base 賣出失敗:', error.message);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * 批准 Token
   */
  async approveToken(token, wallet, amount, decimals) {
    try {
      const amountWei = ethers.parseUnits(amount.toString(), decimals);
      const routerAddress = this.routerAddress;

      const currentAllowance = await token.allowance(wallet.address, routerAddress);

      if (currentAllowance >= amountWei) {
        logger.info('Token 已授權');
        return;
      }

      logger.info('正在授權 Token...');
      const approveTx = await token.approve(routerAddress, ethers.MaxUint256, {
        gasLimit: 100000,
      });

      await approveTx.wait();
      logger.success('Token 授權成功');
    } catch (error) {
      logger.error('Token 授權失敗:', error.message);
      throw error;
    }
  }
}

export default BaseTradeExecutor;
