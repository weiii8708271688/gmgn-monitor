import { ethers } from 'ethers';

const provider = new ethers.JsonRpcProvider('https://bsc-dataseed1.binance.org');
const poolAddress = '0x41ff9AA7e16B8B1a8a8dc4f0eFacd93D02d071c9';
const tokenAddress = '0xa7601a0e9779adcb01b12b1ec0496bceb3f04444';

console.log('測試 PancakeSwap V3 池子...');
console.log('池子地址:', poolAddress);
console.log('');

// PancakeSwap V3 Pool ABI
const v3PoolAbi = [
  'function token0() external view returns (address)',
  'function token1() external view returns (address)',
  'function slot0() external view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)',
  'function liquidity() external view returns (uint128)',
  'function fee() external view returns (uint24)'
];

const erc20Abi = [
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)'
];

try {
  const pool = new ethers.Contract(poolAddress, v3PoolAbi, provider);

  // 獲取池子資訊
  const [token0Address, token1Address, slot0, liquidity, fee] = await Promise.all([
    pool.token0(),
    pool.token1(),
    pool.slot0(),
    pool.liquidity(),
    pool.fee()
  ]);

  console.log('✅ 成功讀取 V3 池子資訊:');
  console.log('Token0:', token0Address);
  console.log('Token1:', token1Address);
  console.log('Fee Tier:', Number(fee) / 10000 + '%');
  console.log('Liquidity:', liquidity.toString());
  console.log('Current Tick:', slot0.tick.toString());
  console.log('sqrtPriceX96:', slot0.sqrtPriceX96.toString());

  // 獲取代幣資訊
  const token0 = new ethers.Contract(token0Address, erc20Abi, provider);
  const token1 = new ethers.Contract(token1Address, erc20Abi, provider);

  const [symbol0, symbol1, decimals0, decimals1] = await Promise.all([
    token0.symbol(),
    token1.symbol(),
    token0.decimals(),
    token1.decimals()
  ]);

  console.log('\n代幣資訊:');
  console.log(`Token0: ${symbol0} (${decimals0} decimals)`);
  console.log(`Token1: ${symbol1} (${decimals1} decimals)`);

  // 計算價格
  // V3 使用 sqrtPriceX96 來表示價格
  // price = (sqrtPriceX96 / 2^96)^2
  const sqrtPriceX96 = slot0.sqrtPriceX96;
  const Q96 = 2n ** 96n;

  // 計算價格（token1 / token0）
  const price = (Number(sqrtPriceX96) / Number(Q96)) ** 2;

  // 調整 decimals
  const decimalAdjustment = 10 ** (Number(decimals1) - Number(decimals0));
  const adjustedPrice = price * decimalAdjustment;

  console.log('\n價格計算:');
  console.log(`1 ${symbol0} = ${adjustedPrice.toFixed(18)} ${symbol1}`);
  console.log(`1 ${symbol1} = ${(1 / adjustedPrice).toFixed(18)} ${symbol0}`);

  // 確定我們要查詢的代幣是 token0 還是 token1
  const isToken0 = token0Address.toLowerCase() === tokenAddress.toLowerCase();

  if (isToken0) {
    console.log(`\n✅ ${symbol0} (查詢代幣) = ${adjustedPrice.toFixed(18)} ${symbol1}`);
  } else {
    console.log(`\n✅ ${symbol1} (查詢代幣) = ${(1 / adjustedPrice).toFixed(18)} ${symbol0}`);
  }

} catch (error) {
  console.log('❌ 錯誤:', error.message);
}

process.exit(0);
