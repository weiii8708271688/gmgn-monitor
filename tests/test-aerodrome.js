import { ethers } from 'ethers';

const provider = new ethers.JsonRpcProvider('https://base.llamarpc.com');

const WETH = '0x4200000000000000000000000000000000000006';
const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';

// Aerodrome Pool Factory
const AERODROME_FACTORY = '0x420DD381b31aEf6683db6B902084cB0FFECe40Da';

// Aerodrome Pool ABI (類似 Velodrome/Solidly)
const POOL_ABI = [
  'function getReserves() external view returns (uint256 reserve0, uint256 reserve1, uint256 timestamp)',
  'function token0() external view returns (address)',
  'function token1() external view returns (address)',
  'function stable() external view returns (bool)',
];

// Aerodrome Factory ABI
const FACTORY_ABI = [
  'function getPool(address tokenA, address tokenB, bool stable) external view returns (address)',
  'function allPools(uint256) external view returns (address)',
  'function allPoolsLength() external view returns (uint256)',
];

// Aerodrome Router ABI
const ROUTER_ABI = [
  'function getAmountOut(uint256 amountIn, address tokenIn, address tokenOut) external view returns (uint256 amount, bool stable)',
  'function getAmountsOut(uint256 amountIn, tuple(address from, address to, bool stable)[] routes) external view returns (uint256[] amounts)',
];

const AERODROME_ROUTER = '0xcF77a3Ba9A5CA399B7c97c74d54e5b1Beb874E43';

async function testAerodrome() {
  console.log('\n=== 測試 Aerodrome (Base 最大 DEX) ===\n');

  try {
    // 方法 1: 使用 Router 獲取報價
    console.log('1️⃣ 使用 Aerodrome Router');
    const router = new ethers.Contract(AERODROME_ROUTER, ROUTER_ABI, provider);

    try {
      const result = await router.getAmountOut.staticCall(
        ethers.parseEther('1'),
        WETH,
        USDC
      );
      const price = Number(ethers.formatUnits(result.amount || result[0], 6));
      console.log(`   ETH 價格: $${price.toFixed(2)}\n`);
    } catch (error) {
      console.log(`   錯誤: ${error.message}\n`);
    }

    // 方法 2: 直接從池子讀取
    console.log('2️⃣ 從 Factory 查找池子');
    const factory = new ethers.Contract(AERODROME_FACTORY, FACTORY_ABI, provider);

    // Aerodrome 有 stable 和 volatile 兩種池子
    for (const stable of [false, true]) {
      try {
        const poolAddress = await factory.getPool(WETH, USDC, stable);

        if (poolAddress === ethers.ZeroAddress) {
          console.log(`   ${stable ? 'Stable' : 'Volatile'} Pool: Not found`);
          continue;
        }

        const pool = new ethers.Contract(poolAddress, POOL_ABI, provider);
        const reserves = await pool.getReserves();
        const token0 = await pool.token0();

        const wethIsToken0 = token0.toLowerCase() === WETH.toLowerCase();
        const wethReserve = wethIsToken0
          ? Number(ethers.formatEther(reserves[0]))
          : Number(ethers.formatEther(reserves[1]));
        const usdcReserve = wethIsToken0
          ? Number(ethers.formatUnits(reserves[1], 6))
          : Number(ethers.formatUnits(reserves[0], 6));

        const ethPrice = usdcReserve / wethReserve;
        console.log(`   ${stable ? 'Stable' : 'Volatile'} Pool: $${ethPrice.toFixed(2)}`);
        console.log(`   WETH Reserve: ${wethReserve.toFixed(2)}, USDC Reserve: $${usdcReserve.toFixed(2)}`);
        console.log(`   Pool Address: ${poolAddress}\n`);
      } catch (error) {
        console.log(`   ${stable ? 'Stable' : 'Volatile'} Pool Error: ${error.message}\n`);
      }
    }

    // 方法 3: 列出所有池子（限制前 10 個）
    console.log('3️⃣ 掃描所有 Aerodrome 池子 (前 10 個)');
    try {
      const poolCount = await factory.allPoolsLength();
      console.log(`   總共 ${poolCount} 個池子\n`);

      const limit = Math.min(10, Number(poolCount));
      for (let i = 0; i < limit; i++) {
        try {
          const poolAddress = await factory.allPools(i);
          const pool = new ethers.Contract(poolAddress, POOL_ABI, provider);
          const token0 = await pool.token0();
          const token1 = await pool.token1();

          if (
            (token0.toLowerCase() === WETH.toLowerCase() && token1.toLowerCase() === USDC.toLowerCase()) ||
            (token1.toLowerCase() === WETH.toLowerCase() && token0.toLowerCase() === USDC.toLowerCase())
          ) {
            const reserves = await pool.getReserves();
            const stable = await pool.stable();

            const wethIsToken0 = token0.toLowerCase() === WETH.toLowerCase();
            const wethReserve = wethIsToken0
              ? Number(ethers.formatEther(reserves[0]))
              : Number(ethers.formatEther(reserves[1]));
            const usdcReserve = wethIsToken0
              ? Number(ethers.formatUnits(reserves[1], 6))
              : Number(ethers.formatUnits(reserves[0], 6));

            const ethPrice = usdcReserve / wethReserve;
            console.log(`   找到 WETH/USDC 池子 #${i}:`);
            console.log(`   Type: ${stable ? 'Stable' : 'Volatile'}`);
            console.log(`   ETH 價格: $${ethPrice.toFixed(2)}`);
            console.log(`   Pool: ${poolAddress}\n`);
          }
        } catch (error) {
          // Skip invalid pools
        }
      }
    } catch (error) {
      console.log(`   錯誤: ${error.message}`);
    }
  } catch (error) {
    console.error('測試失敗:', error);
  }

  console.log('✅ 測試完成\n');
}

testAerodrome();
