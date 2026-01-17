import { ethers } from 'ethers';

const TOKEN_ADDRESS = '0x69eaacbaa9c4fd8b5c9a18dc1e45aea6ca49b9f1'; // 基地人生
const WETH = '0x4200000000000000000000000000000000000006';

const provider = new ethers.JsonRpcProvider('https://base.llamarpc.com');
const mainnetProvider = new ethers.JsonRpcProvider('https://eth.llamarpc.com');

// Aerodrome Factory & Pool
const AERODROME_FACTORY = '0x420DD381b31aEf6683db6B902084cB0FFECe40Da';

const FACTORY_ABI = [
  'function getPool(address tokenA, address tokenB, bool stable) external view returns (address)',
];

const POOL_ABI = [
  'function getReserves() external view returns (uint256 reserve0, uint256 reserve1, uint256 timestamp)',
  'function token0() external view returns (address)',
  'function token1() external view returns (address)',
  'function stable() external view returns (bool)',
];

const QUOTER_V2_ABI = [
  'function quoteExactInputSingle((address tokenIn, address tokenOut, uint256 amountIn, uint24 fee, uint160 sqrtPriceLimitX96)) external returns (uint256 amountOut)',
];

async function testAerodromePrice() {
  console.log('\n=== 測試基地人生價格 (Aerodrome) ===\n');

  // 1. 獲取 ETH 價格
  console.log('1️⃣ 獲取 ETH 價格 (Mainnet)');
  const mainnetQuoter = new ethers.Contract(
    '0x61fFE014bA17989E743c5F6cB21bF9697530B21e',
    QUOTER_V2_ABI,
    mainnetProvider
  );

  const params = {
    tokenIn: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
    tokenOut: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
    amountIn: ethers.parseEther('1'),
    fee: 500,
    sqrtPriceLimitX96: 0,
  };

  const result = await mainnetQuoter.quoteExactInputSingle.staticCall(params);
  const ethPrice = Number(ethers.formatUnits(result[0], 6));
  console.log(`   ETH: $${ethPrice.toFixed(2)}\n`);

  // 2. 檢查 Aerodrome 池子
  console.log('2️⃣ 檢查 Aerodrome 池子');
  const factory = new ethers.Contract(AERODROME_FACTORY, FACTORY_ABI, provider);

  for (const stable of [false, true]) {
    try {
      const poolAddr = await factory.getPool(TOKEN_ADDRESS, WETH, stable);

      if (poolAddr === ethers.ZeroAddress) {
        console.log(`   ${stable ? 'Stable' : 'Volatile'}: 池子不存在`);
        continue;
      }

      console.log(`\n   ${stable ? '🔵 Stable' : '🟣 Volatile'} Pool: ${poolAddr}`);

      const pool = new ethers.Contract(poolAddr, POOL_ABI, provider);
      const reserves = await pool.getReserves();
      const token0 = await pool.token0();

      const tokenIsToken0 = token0.toLowerCase() === TOKEN_ADDRESS.toLowerCase();

      const tokenReserve = tokenIsToken0
        ? Number(ethers.formatEther(reserves[0]))
        : Number(ethers.formatEther(reserves[1]));
      const wethReserve = tokenIsToken0
        ? Number(ethers.formatEther(reserves[1]))
        : Number(ethers.formatEther(reserves[0]));

      console.log(`   Token Reserve: ${tokenReserve.toFixed(2)}`);
      console.log(`   WETH Reserve: ${wethReserve.toFixed(6)}`);

      const priceInETH = wethReserve / tokenReserve;
      const priceInUSD = priceInETH * ethPrice;

      console.log(`   Token/ETH: ${priceInETH.toFixed(10)} ETH`);
      console.log(`   Token/USD: $${priceInUSD.toFixed(10)}`);

    } catch (error) {
      console.log(`   ${stable ? 'Stable' : 'Volatile'}: 錯誤 - ${error.message.slice(0, 50)}`);
    }
  }

  // 3. 檢查 BaseSwap (V2)
  console.log('\n\n3️⃣ 檢查 BaseSwap V2');
  const BASESWAP_FACTORY = '0x8909Dc15e40173Ff4699343b6eB8132c65e18eC6';
  const FACTORY_V2_ABI = [
    'function getPair(address tokenA, address tokenB) external view returns (address pair)',
  ];

  const PAIR_ABI = [
    'function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)',
    'function token0() external view returns (address)',
  ];

  try {
    const factoryV2 = new ethers.Contract(BASESWAP_FACTORY, FACTORY_V2_ABI, provider);
    const pairAddr = await factoryV2.getPair(TOKEN_ADDRESS, WETH);

    if (pairAddr === ethers.ZeroAddress) {
      console.log('   池子不存在');
    } else {
      console.log(`   Pair: ${pairAddr}`);

      const pair = new ethers.Contract(pairAddr, PAIR_ABI, provider);
      const reserves = await pair.getReserves();
      const token0 = await pair.token0();

      const tokenIsToken0 = token0.toLowerCase() === TOKEN_ADDRESS.toLowerCase();

      const tokenReserve = tokenIsToken0
        ? Number(ethers.formatEther(reserves[0]))
        : Number(ethers.formatEther(reserves[1]));
      const wethReserve = tokenIsToken0
        ? Number(ethers.formatEther(reserves[1]))
        : Number(ethers.formatEther(reserves[0]));

      console.log(`   Token Reserve: ${tokenReserve.toFixed(2)}`);
      console.log(`   WETH Reserve: ${wethReserve.toFixed(6)}`);

      const priceInETH = wethReserve / tokenReserve;
      const priceInUSD = priceInETH * ethPrice;

      console.log(`   Token/ETH: ${priceInETH.toFixed(10)} ETH`);
      console.log(`   Token/USD: $${priceInUSD.toFixed(10)}`);
    }
  } catch (error) {
    console.log(`   錯誤: ${error.message}`);
  }

  console.log('\n✅ 測試完成\n');
}

testAerodromePrice();
