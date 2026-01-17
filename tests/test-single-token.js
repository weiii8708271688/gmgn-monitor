import { ethers } from 'ethers';

// 基地人生
const TOKEN_ADDRESS = '0x69eaacbaa9c4fd8b5c9a18dc1e45aea6ca49b9f1';
const TOKEN_DECIMALS = 18;

const WETH = '0x4200000000000000000000000000000000000006';
const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';

// 測試兩個 RPC
const BASE_RPC = 'https://base.llamarpc.com';
const MAINNET_RPC = 'https://eth.llamarpc.com';

const baseProvider = new ethers.JsonRpcProvider(BASE_RPC);
const mainnetProvider = new ethers.JsonRpcProvider(MAINNET_RPC);

const POOL_V3_ABI = [
  'function slot0() external view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)',
  'function token0() external view returns (address)',
  'function token1() external view returns (address)',
];

const FACTORY_V3_ABI = [
  'function getPool(address tokenA, address tokenB, uint24 fee) external view returns (address pool)',
];

const QUOTER_V2_ABI = [
  'function quoteExactInputSingle((address tokenIn, address tokenOut, uint256 amountIn, uint24 fee, uint160 sqrtPriceLimitX96)) external returns (uint256 amountOut, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate)',
];

async function testTokenPrice() {
  console.log('\n=== 測試基地人生價格 ===\n');
  console.log(`Token: ${TOKEN_ADDRESS}`);
  console.log(`Decimals: ${TOKEN_DECIMALS}\n`);

  // 1. 獲取 ETH 價格 (Mainnet)
  console.log('1️⃣ 獲取 ETH/USD 價格 (Ethereum Mainnet)');
  const mainnetQuoter = new ethers.Contract(
    '0x61fFE014bA17989E743c5F6cB21bF9697530B21e',
    QUOTER_V2_ABI,
    mainnetProvider
  );

  let ethPrice = null;
  for (const fee of [500, 3000]) {
    try {
      const params = {
        tokenIn: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', // WETH mainnet
        tokenOut: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', // USDC mainnet
        amountIn: ethers.parseEther('1'),
        fee: fee,
        sqrtPriceLimitX96: 0,
      };
      const result = await mainnetQuoter.quoteExactInputSingle.staticCall(params);
      ethPrice = Number(ethers.formatUnits(result[0], 6));
      console.log(`   ETH 價格: $${ethPrice.toFixed(2)} (fee ${fee/10000}%)\n`);
      break;
    } catch (e) {
      continue;
    }
  }

  // 2. 測試 Base 鏈上的 Token/WETH 價格 (所有 fee tiers)
  console.log('2️⃣ 測試 Token/WETH 價格 (Base 鏈 - 所有 fee tiers)');

  const factory = new ethers.Contract(
    '0x33128a8fC17869897dcE68Ed026d694621f6FDfD',
    FACTORY_V3_ABI,
    baseProvider
  );

  const fees = [100, 500, 3000, 10000];

  for (const fee of fees) {
    try {
      console.log(`\n   Fee ${fee/10000}% (${fee}):`);

      // 查找池子
      const poolAddr = await factory.getPool(TOKEN_ADDRESS, WETH, fee);

      if (poolAddr === ethers.ZeroAddress) {
        console.log(`   ❌ 池子不存在`);
        continue;
      }

      console.log(`   Pool: ${poolAddr}`);

      // 讀取池子數據
      const pool = new ethers.Contract(poolAddr, POOL_V3_ABI, baseProvider);
      const [sqrtPriceX96, tick] = await pool.slot0();
      const token0 = await pool.token0();

      console.log(`   Tick: ${tick}`);
      console.log(`   sqrtPriceX96: ${sqrtPriceX96.toString()}`);
      console.log(`   Token0: ${token0.slice(0, 10)}...`);

      // 計算價格
      const Q96 = 2n ** 96n;
      const price = (Number(sqrtPriceX96) / Number(Q96)) ** 2;

      const tokenIsToken0 = token0.toLowerCase() === TOKEN_ADDRESS.toLowerCase();
      console.log(`   Token 是 Token0: ${tokenIsToken0}`);

      let priceInETH;
      if (tokenIsToken0) {
        // Token/WETH 價格 = price * 10^(18-decimals)
        priceInETH = price * (10 ** (18 - TOKEN_DECIMALS));
      } else {
        // WETH/Token 價格 = 1/price * 10^(decimals-18)
        priceInETH = (1 / price) * (10 ** (TOKEN_DECIMALS - 18));
      }

      const priceInUSD = priceInETH * ethPrice;

      console.log(`   Token/ETH 價格: ${priceInETH.toFixed(10)} ETH`);
      console.log(`   Token/USD 價格: $${priceInUSD.toFixed(10)}`);

    } catch (error) {
      console.log(`   ❌ 錯誤: ${error.message.slice(0, 60)}`);
    }
  }

  // 3. 測試使用 Quoter (Base 鏈)
  console.log('\n\n3️⃣ 測試使用 Quoter V2 (Base 鏈)');

  const baseQuoter = new ethers.Contract(
    '0x3d4e44Eb1374240CE5F1B871ab261CD16335B76a',
    QUOTER_V2_ABI,
    baseProvider
  );

  for (const fee of fees) {
    try {
      console.log(`\n   Fee ${fee/10000}%:`);

      const params = {
        tokenIn: TOKEN_ADDRESS,
        tokenOut: WETH,
        amountIn: ethers.parseUnits('1', TOKEN_DECIMALS),
        fee: fee,
        sqrtPriceLimitX96: 0,
      };

      const result = await baseQuoter.quoteExactInputSingle.staticCall(params);
      const priceInETH = Number(ethers.formatEther(result[0]));
      const priceInUSD = priceInETH * ethPrice;

      console.log(`   Token/ETH: ${priceInETH.toFixed(10)} ETH`);
      console.log(`   Token/USD: $${priceInUSD.toFixed(10)}`);

    } catch (error) {
      console.log(`   ❌ ${error.message.slice(0, 40)}`);
    }
  }

  console.log('\n✅ 測試完成\n');
}

testTokenPrice();
