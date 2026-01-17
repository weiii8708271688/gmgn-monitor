import { ethers } from 'ethers';

// Ethereum Mainnet
const mainnetProvider = new ethers.JsonRpcProvider('https://eth.llamarpc.com');

const WETH_MAINNET = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2';
const USDC_MAINNET = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';

const QUOTER_V2_MAINNET = '0x61fFE014bA17989E743c5F6cB21bF9697530B21e'; // Uniswap V3 Quoter V2

const QUOTER_ABI = [
  'function quoteExactInputSingle((address tokenIn, address tokenOut, uint256 amountIn, uint24 fee, uint160 sqrtPriceLimitX96)) external returns (uint256 amountOut, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate)',
];

async function testMainnetETH() {
  console.log('\n=== 測試 Ethereum Mainnet ETH 價格 ===\n');

  const quoter = new ethers.Contract(QUOTER_V2_MAINNET, QUOTER_ABI, mainnetProvider);

  for (const fee of [100, 500, 3000, 10000]) {
    try {
      const params = {
        tokenIn: WETH_MAINNET,
        tokenOut: USDC_MAINNET,
        amountIn: ethers.parseEther('1'),
        fee: fee,
        sqrtPriceLimitX96: 0,
      };

      const result = await quoter.quoteExactInputSingle.staticCall(params);
      const price = Number(ethers.formatUnits(result[0], 6));
      console.log(`Fee ${fee/10000}%: $${price.toFixed(2)}`);
    } catch (error) {
      console.log(`Fee ${fee/10000}%: Pool not found`);
    }
  }

  console.log('\n✅ 測試完成\n');
}

testMainnetETH();
