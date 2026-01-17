import { ethers } from 'ethers';

const POOL_ADDRESS = '0xA91c64e970b2c7A16A7b3Ce59cF653558326dBF4';
const TOKEN_ADDRESS = '0x69eaacbaa9c4fd8b5c9a18dc1e45aea6ca49b9f1'; // 基地人生
const WETH = '0x4200000000000000000000000000000000000006';

const provider = new ethers.JsonRpcProvider('https://base.llamarpc.com');

const POOL_V3_ABI = [
  'function slot0() external view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)',
  'function liquidity() external view returns (uint128)',
  'function token0() external view returns (address)',
  'function token1() external view returns (address)',
  'function fee() external view returns (uint24)',
];

async function analyzePool() {
  console.log('\n=== 直接讀取池子數據 ===\n');
  console.log(`Pool: ${POOL_ADDRESS}`);
  console.log(`Token: ${TOKEN_ADDRESS}`);
  console.log(`WETH: ${WETH}\n`);

  // 假設 ETH 價格
  const ethPrice = 2780;
  console.log(`假設 ETH/USD: $${ethPrice}\n`);

  const pool = new ethers.Contract(POOL_ADDRESS, POOL_V3_ABI, provider);

  try {
    const token0 = await pool.token0();
    const token1 = await pool.token1();
    const fee = await pool.fee();
    const slot0 = await pool.slot0();
    const sqrtPriceX96 = slot0[0];
    const tick = slot0[1];
    const liquidity = await pool.liquidity();

    const feeNum = Number(fee);
    const tickNum = Number(tick);

    console.log('📊 池子信息:');
    console.log(`   Token0: ${token0}`);
    console.log(`   Token1: ${token1}`);
    console.log(`   Fee: ${feeNum} (${feeNum/10000}%)`);
    console.log(`   Tick: ${tickNum}`);
    console.log(`   sqrtPriceX96: ${sqrtPriceX96.toString()}`);
    console.log(`   Liquidity: ${liquidity.toString()}\n`);

    const tokenIsToken0 = token0.toLowerCase() === TOKEN_ADDRESS.toLowerCase();
    const wethIsToken0 = token0.toLowerCase() === WETH.toLowerCase();

    console.log(`   基地人生 是 Token0: ${tokenIsToken0}`);
    console.log(`   WETH 是 Token0: ${wethIsToken0}\n`);

    // 計算價格
    console.log('💰 價格計算:');

    // sqrtPriceX96 represents sqrt(token1/token0) * 2^96
    const Q96 = BigInt(2) ** BigInt(96);
    const sqrtPriceBigInt = BigInt(sqrtPriceX96.toString());
    const sqrtPrice = Number(sqrtPriceBigInt) / Number(Q96);
    const price = sqrtPrice ** 2;

    console.log(`   sqrtPrice (normalized): ${sqrtPrice}`);
    console.log(`   price (token1/token0): ${price}\n`);

    if (wethIsToken0) {
      // WETH 是 token0，Token 是 token1
      // price = token1/token0 = Token/WETH
      const tokenPerWeth = price;
      const wethPerToken = 1 / price;

      console.log(`   解釋: price = Token/WETH`);
      console.log(`   1 WETH = ${tokenPerWeth.toFixed(2)} 基地人生`);
      console.log(`   1 基地人生 = ${wethPerToken.toExponential(6)} WETH`);
      console.log(`   1 基地人生 = ${wethPerToken * ethPrice} USD\n`);

      console.log(`🎯 最終價格:`);
      console.log(`   方法1 (直接): $${(wethPerToken * ethPrice).toFixed(10)}`);

      // 使用 tick 驗證
      const priceFromTick = 1.0001 ** tickNum;
      const wethPerTokenFromTick = wethIsToken0 ? priceFromTick : (1 / priceFromTick);
      console.log(`   方法2 (tick):  $${(wethPerTokenFromTick * ethPrice).toFixed(10)}`);

    } else {
      // Token 是 token0，WETH 是 token1
      // price = token1/token0 = WETH/Token
      const wethPerToken = price;
      const tokenPerWeth = 1 / price;

      console.log(`   解釋: price = WETH/Token`);
      console.log(`   1 基地人生 = ${wethPerToken.toExponential(6)} WETH`);
      console.log(`   1 WETH = ${tokenPerWeth.toFixed(2)} 基地人生`);
      console.log(`   1 基地人生 = ${wethPerToken * ethPrice} USD\n`);

      console.log(`🎯 最終價格:`);
      console.log(`   方法1 (直接): $${(wethPerToken * ethPrice).toFixed(10)}`);

      // 使用 tick 驗證
      const priceFromTick = 1.0001 ** tickNum;
      const wethPerTokenFromTick = wethIsToken0 ? (1 / priceFromTick) : priceFromTick;
      console.log(`   方法2 (tick):  $${(wethPerTokenFromTick * ethPrice).toFixed(10)}`);
    }

  } catch (error) {
    console.error('❌ 錯誤:', error.message);
  }

  console.log('\n✅ 完成\n');
}

analyzePool();
