import { ethers } from 'ethers';

const provider = new ethers.JsonRpcProvider('https://bsc-dataseed1.binance.org');
const poolAddress = '0xFf737FBe326a85a4f088BDAdc0f3A651b654AAd2';

console.log('檢查池子地址:', poolAddress);

// 檢查是否為合約
const code = await provider.getCode(poolAddress);
console.log('\nBytecode 長度:', code.length);
console.log('是否為合約:', code !== '0x' ? '✅ 是' : '❌ 否');

if (code === '0x') {
  console.log('\n❌ 這不是一個合約地址，可能地址有誤');
  process.exit(1);
}

// 嘗試標準 Uniswap V2 Pair 接口
const v2PairAbi = [
  'function token0() view returns (address)',
  'function token1() view returns (address)',
  'function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)',
  'function factory() view returns (address)'
];

const pair = new ethers.Contract(poolAddress, v2PairAbi, provider);

try {
  console.log('\n嘗試讀取 Uniswap V2 Pair 資訊...');
  const token0 = await pair.token0();
  const token1 = await pair.token1();
  const factory = await pair.factory();
  const [reserve0, reserve1] = await pair.getReserves();

  console.log('✅ 這是一個 Uniswap V2 風格的池子');
  console.log('Token0:', token0);
  console.log('Token1:', token1);
  console.log('Factory:', factory);
  console.log('Reserve0:', ethers.formatEther(reserve0));
  console.log('Reserve1:', ethers.formatEther(reserve1));
} catch (error) {
  console.log('❌ 不是標準 Uniswap V2 Pair:', error.message);
  console.log('\n這可能是:');
  console.log('1. PancakeSwap V3 池子');
  console.log('2. 其他 DEX 的池子');
  console.log('3. 地址錯誤');
}

process.exit(0);
