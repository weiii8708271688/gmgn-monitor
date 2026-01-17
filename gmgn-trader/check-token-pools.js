import { ethers } from 'ethers';

const provider = new ethers.JsonRpcProvider('https://bsc-dataseed1.binance.org');
const factoryAbi = ['function getPair(address tokenA, address tokenB) external view returns (address pair)'];
const factory = new ethers.Contract('0xcA143Ce32Fe78f1f7019d7d551a6402fC5350c73', factoryAbi, provider);

const tokenAddress = '0xa7601a0e9779adcb01b12b1ec0496bceb3f04444';

const testPairs = [
  { name: 'WBNB', address: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c' },
  { name: 'USDT', address: '0x55d398326f99059fF775485246999027B3197955' },
  { name: 'BUSD', address: '0xe9e7CEA3DedcA5984780Bafc599bD69ADd087D56' },
  { name: 'USDC', address: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d' }
];

console.log(`檢查代幣: ${tokenAddress}\n`);

for (const base of testPairs) {
  try {
    const pair = await factory.getPair(tokenAddress, base.address);
    if (pair !== '0x0000000000000000000000000000000000000000') {
      console.log(`✅ 找到交易對: Token/${base.name} = ${pair}`);

      // 檢查流動性
      const pairAbi = [
        'function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)',
        'function token0() view returns (address)',
        'function token1() view returns (address)'
      ];
      const pairContract = new ethers.Contract(pair, pairAbi, provider);
      const [reserve0, reserve1] = await pairContract.getReserves();
      const token0 = await pairContract.token0();

      console.log(`   Reserve0: ${ethers.formatEther(reserve0)}`);
      console.log(`   Reserve1: ${ethers.formatEther(reserve1)}`);
    } else {
      console.log(`❌ 沒有 Token/${base.name} 交易對`);
    }
  } catch (error) {
    console.log(`❌ 檢查 Token/${base.name} 時出錯: ${error.message}`);
  }
}

process.exit(0);
