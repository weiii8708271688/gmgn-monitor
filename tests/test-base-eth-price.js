import { ethers } from 'ethers';

const provider = new ethers.JsonRpcProvider('https://base.llamarpc.com');

const WETH = '0x4200000000000000000000000000000000000006';
const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';

// Uniswap V3 Pool ABI
const POOL_V3_ABI = [
  'function slot0() external view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)',
  'function liquidity() external view returns (uint128)',
  'function token0() external view returns (address)',
  'function token1() external view returns (address)',
];

// Uniswap V3 Factory ABI
const FACTORY_V3_ABI = [
  'function getPool(address tokenA, address tokenB, uint24 fee) external view returns (address pool)',
];

// Uniswap V2 Pair ABI
const PAIR_V2_ABI = [
  'function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)',
  'function token0() external view returns (address)',
  'function token1() external view returns (address)',
];

const FACTORY_V2_ABI = [
  'function getPair(address tokenA, address tokenB) external view returns (address pair)',
];

const QUOTER_V2_ABI = [
  'function quoteExactInputSingle((address tokenIn, address tokenOut, uint256 amountIn, uint24 fee, uint160 sqrtPriceLimitX96)) external returns (uint256 amountOut, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate)',
];

// Base 上的 DEX 合約地址
const UNISWAP_V3_FACTORY = '0x33128a8fC17869897dcE68Ed026d694621f6FDfD'; // Uniswap V3 on Base
const BASESWAP_V2_FACTORY = '0x8909Dc15e40173Ff4699343b6eB8132c65e18eC6'; // BaseSwap
const AERODROME_FACTORY = '0x420DD381b31aEf6683db6B902084cB0FFECe40Da'; // Aerodrome (主要 DEX on Base)
const QUOTER_V2 = '0x3d4e44Eb1374240CE5F1B871ab261CD16335B76a'; // Uniswap V3 Quoter V2

async function testETHPrice() {
  console.log('\n=== 測試 Base 鏈上不同 DEX 的 ETH 價格 ===\n');
  console.log(`WETH: ${WETH}`);
  console.log(`USDC: ${USDC}\n`);

  // 1. Uniswap V3 - 使用 Quoter
  console.log('1️⃣ Uniswap V3 (Quoter)');
  const quoter = new ethers.Contract(QUOTER_V2, QUOTER_V2_ABI, provider);

  for (const fee of [100, 500, 3000, 10000]) {
    try {
      const params = {
        tokenIn: WETH,
        tokenOut: USDC,
        amountIn: ethers.parseEther('1'),
        fee: fee,
        sqrtPriceLimitX96: 0,
      };

      const result = await quoter.quoteExactInputSingle.staticCall(params);
      const price = Number(ethers.formatUnits(result[0], 6));
      console.log(`   Fee ${fee/10000}%: $${price.toFixed(2)}`);
    } catch (error) {
      console.log(`   Fee ${fee/10000}%: Pool not found or error`);
    }
  }

  // 2. Uniswap V3 - 直接讀取池子
  console.log('\n2️⃣ Uniswap V3 (Direct Pool)');
  const factoryV3 = new ethers.Contract(UNISWAP_V3_FACTORY, FACTORY_V3_ABI, provider);

  for (const fee of [100, 500, 3000, 10000]) {
    try {
      const poolAddress = await factoryV3.getPool(WETH, USDC, fee);

      if (poolAddress === ethers.ZeroAddress) {
        console.log(`   Fee ${fee/10000}%: Pool not found`);
        continue;
      }

      const pool = new ethers.Contract(poolAddress, POOL_V3_ABI, provider);
      const [sqrtPriceX96, tick] = await pool.slot0();
      const liquidity = await pool.liquidity();
      const token0 = await pool.token0();

      const Q96 = 2n ** 96n;
      const price = (Number(sqrtPriceX96) / Number(Q96)) ** 2;

      const wethIsToken0 = token0.toLowerCase() === WETH.toLowerCase();
      const ethPrice = wethIsToken0 ? price * (10 ** 12) : (1 / price) / (10 ** 12);

      console.log(`   Fee ${fee/10000}%: $${ethPrice.toFixed(2)} | Liquidity: ${liquidity.toString()}`);
      console.log(`   Pool: ${poolAddress}`);
    } catch (error) {
      console.log(`   Fee ${fee/10000}%: Error - ${error.message.slice(0, 50)}`);
    }
  }

  // 3. BaseSwap V2
  console.log('\n3️⃣ BaseSwap V2');
  try {
    const factoryV2 = new ethers.Contract(BASESWAP_V2_FACTORY, FACTORY_V2_ABI, provider);
    const pairAddress = await factoryV2.getPair(WETH, USDC);

    if (pairAddress !== ethers.ZeroAddress) {
      const pair = new ethers.Contract(pairAddress, PAIR_V2_ABI, provider);
      const reserves = await pair.getReserves();
      const token0 = await pair.token0();

      const wethIsToken0 = token0.toLowerCase() === WETH.toLowerCase();
      const wethReserve = wethIsToken0
        ? Number(ethers.formatEther(reserves[0]))
        : Number(ethers.formatEther(reserves[1]));
      const usdcReserve = wethIsToken0
        ? Number(ethers.formatUnits(reserves[1], 6))
        : Number(ethers.formatUnits(reserves[0], 6));

      const ethPrice = usdcReserve / wethReserve;
      console.log(`   Price: $${ethPrice.toFixed(2)}`);
      console.log(`   WETH Reserve: ${wethReserve.toFixed(2)}, USDC Reserve: $${usdcReserve.toFixed(2)}`);
      console.log(`   Pair: ${pairAddress}`);
    } else {
      console.log('   Pool not found');
    }
  } catch (error) {
    console.log(`   Error: ${error.message}`);
  }

  // 4. 檢查 Aerodrome (Base 上最大的 DEX)
  console.log('\n4️⃣ Aerodrome');
  console.log('   (需要 Aerodrome 專用 ABI，暫時跳過)');

  console.log('\n✅ 測試完成\n');
}

testETHPrice();
