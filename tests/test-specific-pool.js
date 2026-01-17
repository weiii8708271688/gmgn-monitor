import { ethers } from 'ethers';

const POOL_ADDRESS = '0xA91c64e970b2c7A16A7b3Ce59cF653558326dBF4';
const TOKEN_ADDRESS = '0x69eaacbaa9c4fd8b5c9a18dc1e45aea6ca49b9f1'; // 基地人生
const WETH = '0x4200000000000000000000000000000000000006';
const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';

const provider = new ethers.JsonRpcProvider('https://base.llamarpc.com');
const mainnetProvider = new ethers.JsonRpcProvider('https://eth.llamarpc.com');

const POOL_V3_ABI = [
  'function slot0() external view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)',
  'function liquidity() external view returns (uint128)',
  'function token0() external view returns (address)',
  'function token1() external view returns (address)',
  'function fee() external view returns (uint24)',
];

const QUOTER_V2_ABI = [
  'function quoteExactInputSingle((address tokenIn, address tokenOut, uint256 amountIn, uint24 fee, uint160 sqrtPriceLimitX96)) external returns (uint256 amountOut)',
];

async function analyzePool() {
  console.log('\n=== 分析池子 0xA91c64e970b2c7A16A7b3Ce59cF653558326dBF4 ===\n');

  // 1. 獲取 ETH/USD 價格
  console.log('1️⃣ 獲取 ETH/USD 價格 (Mainnet)');
  const mainnetQuoter = new ethers.Contract(
    '0x61fFE014bA17989E743c5F6cB21bF9697530B21e',
    QUOTER_V2_ABI,
    mainnetProvider
  );

  const ethUsdcParams = {
    tokenIn: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', // WETH
    tokenOut: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', // USDC
    amountIn: ethers.parseEther('1'),
    fee: 500,
    sqrtPriceLimitX96: 0,
  };

  const ethResult = await mainnetQuoter.quoteExactInputSingle.staticCall(ethUsdcParams);
  const ethPrice = Number(ethers.formatUnits(ethResult[0], 6));
  console.log(`   ETH/USD: $${ethPrice.toFixed(2)}\n`);

  // 2. 讀取池子詳細信息
  console.log('2️⃣ 讀取池子詳細信息');
  const pool = new ethers.Contract(POOL_ADDRESS, POOL_V3_ABI, provider);

  const token0 = await pool.token0();
  const token1 = await pool.token1();
  const fee = await pool.fee();
  const [sqrtPriceX96, tick] = await pool.slot0();
  const liquidity = await pool.liquidity();

  console.log(`   Token0: ${token0}`);
  console.log(`   Token1: ${token1}`);
  console.log(`   Fee: ${fee} (${fee/10000}%)`);
  console.log(`   Tick: ${tick}`);
  console.log(`   sqrtPriceX96: ${sqrtPriceX96.toString()}`);
  console.log(`   Liquidity: ${liquidity.toString()}\n`);

  const tokenIsToken0 = token0.toLowerCase() === TOKEN_ADDRESS.toLowerCase();
  console.log(`   基地人生 是 Token0: ${tokenIsToken0}\n`);

  // 3. 方法 A: 使用 sqrtPriceX96 直接計算
  console.log('3️⃣ 方法 A: 使用 sqrtPriceX96 計算');

  const Q96 = 2n ** 96n;
  const priceRaw = (Number(sqrtPriceX96) / Number(Q96)) ** 2;

  console.log(`   Raw price (token1/token0): ${priceRaw}`);

  let tokenPerWeth, wethPerToken;
  if (tokenIsToken0) {
    // Token 是 token0，WETH 是 token1
    // price = token1/token0 = WETH/Token
    wethPerToken = priceRaw;
    tokenPerWeth = 1 / priceRaw;
  } else {
    // WETH 是 token0，Token 是 token1
    // price = token1/token0 = Token/WETH
    tokenPerWeth = priceRaw;
    wethPerToken = 1 / priceRaw;
  }

  console.log(`   1 WETH = ${tokenPerWeth.toFixed(2)} Token`);
  console.log(`   1 Token = ${wethPerToken.toFixed(15)} WETH`);

  const priceInUSD_A = wethPerToken * ethPrice;
  console.log(`   Token/USD: $${priceInUSD_A.toFixed(10)}\n`);

  // 4. 方法 B: 使用 Quoter (模擬交易)
  console.log('4️⃣ 方法 B: 使用 Quoter V2 (模擬賣 1000 個 Token)');

  const baseQuoter = new ethers.Contract(
    '0x3d4e44Eb1374240CE5F1B871ab261CD16335B76a',
    QUOTER_V2_ABI,
    provider
  );

  try {
    const amounts = [
      { amount: '1', label: '1 Token' },
      { amount: '1000', label: '1000 Token' },
      { amount: '10000', label: '10000 Token' },
    ];

    for (const { amount, label } of amounts) {
      try {
        const params = {
          tokenIn: TOKEN_ADDRESS,
          tokenOut: WETH,
          amountIn: ethers.parseEther(amount),
          fee: fee,
          sqrtPriceLimitX96: 0,
        };

        const result = await baseQuoter.quoteExactInputSingle.staticCall(params);
        const wethOut = Number(ethers.formatEther(result[0]));
        const pricePerToken = wethOut / parseFloat(amount);
        const usdPerToken = pricePerToken * ethPrice;

        console.log(`   賣 ${label}:`);
        console.log(`     得到: ${wethOut.toFixed(10)} WETH`);
        console.log(`     單價: ${pricePerToken.toFixed(15)} WETH/Token`);
        console.log(`     USD: $${usdPerToken.toFixed(10)}`);
      } catch (e) {
        console.log(`   賣 ${label}: ❌ ${e.message.slice(0, 50)}`);
      }
    }
  } catch (error) {
    console.log(`   Quoter 失敗: ${error.message}`);
  }

  // 5. 方法 C: 反向計算（買入 Token）
  console.log('\n5️⃣ 方法 C: 使用 Quoter 反向（用 0.001 WETH 買 Token）');

  try {
    const amounts = [
      { amount: '0.001', label: '0.001 WETH' },
      { amount: '0.01', label: '0.01 WETH' },
    ];

    for (const { amount, label } of amounts) {
      try {
        const params = {
          tokenIn: WETH,
          tokenOut: TOKEN_ADDRESS,
          amountIn: ethers.parseEther(amount),
          fee: fee,
          sqrtPriceLimitX96: 0,
        };

        const result = await baseQuoter.quoteExactInputSingle.staticCall(params);
        const tokenOut = Number(ethers.formatEther(result[0]));
        const tokensPerWeth = tokenOut / parseFloat(amount);
        const wethPerToken = 1 / tokensPerWeth;
        const usdPerToken = wethPerToken * ethPrice;

        console.log(`   用 ${label} 買入:`);
        console.log(`     得到: ${tokenOut.toFixed(2)} Token`);
        console.log(`     匯率: ${tokensPerWeth.toFixed(2)} Token/WETH`);
        console.log(`     單價: ${wethPerToken.toFixed(15)} WETH/Token`);
        console.log(`     USD: $${usdPerToken.toFixed(10)}`);
      } catch (e) {
        console.log(`   用 ${label}: ❌ ${e.message.slice(0, 50)}`);
      }
    }
  } catch (error) {
    console.log(`   反向 Quoter 失敗: ${error.message}`);
  }

  console.log('\n✅ 分析完成\n');
}

analyzePool();
